import base64
import copy
import io
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from pdf_fixture import make_pdf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/pdf-to-epub/scripts"))


class ServerTests(unittest.TestCase):
    def setUp(self):
        from pdf_epub.server import make_server

        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.server = make_server(
            self.root / "projects",
            port=0,
            token="test-session-token",
            allowed_origins=["https://editor.example"],
            epubcheck_jar=os.environ.get("EPUBCHECK_JAR"),
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"
        self.client = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(
        self, path, method="GET", value=None, auth=True, origin="https://editor.example", **headers
    ):
        headers = {"Origin": origin, **headers} if origin else headers
        if auth:
            headers["Authorization"] = "Bearer test-session-token"
        data = json.dumps(value).encode() if value is not None else None
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            self.base + path, data=data, headers=headers, method=method
        )
        try:
            response = self.client.open(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read()
            result = (
                json.loads(body)
                if body and "application/json" in response.headers.get("Content-Type", "")
                else body
            )
            return response.status, result, response.headers

    def test_private_api_requires_token_and_rejects_untrusted_origins_and_hosts(self):
        self.assertEqual(self.request("/api/projects", auth=False)[0], 401)
        self.assertEqual(self.request("/api/projects", origin="https://untrusted.example")[0], 403)
        self.assertEqual(self.request("/api/projects", Host="untrusted.example")[0], 403)
        status, body, _ = self.request("/api/projects")
        self.assertEqual(status, 200, body)
        self.assertEqual(body["projects"], [])

    def test_preflight_and_local_pairing_do_not_expose_credentials_to_remote_pages(self):
        status, _, headers = self.request("/api/projects", "OPTIONS", auth=False)
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://editor.example")
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")
        self.assertEqual(self.request("/api/session", auth=False)[0], 403)
        status, data, _ = self.request(
            "/api/session", auth=False, origin=self.base, **{"Sec-Fetch-Site": "same-origin"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(data["token"], "test-session-token")
        self.assertEqual(
            self.request("/connect?returnTo=https://untrusted.example", auth=False, origin=None)[0],
            403,
        )
        self.assertNotIn("test-session-token", str(self.request("/api/health", auth=False)[1]))

    def import_book(self, **kwargs):
        make_pdf(self.root / "sample.pdf", **kwargs)
        status, result, _ = self.request(
            "/api/projects",
            "POST",
            {
                "filename": "sample.pdf",
                "language": "en",
                "data": base64.b64encode((self.root / "sample.pdf").read_bytes()).decode(),
            },
        )
        self.assertEqual(status, 201, result)
        return result

    def test_import_save_and_preview_preserve_evidence_and_reject_stale_edits(self):
        initial = self.import_book()
        path = "/api/projects/" + initial["project"]["id"]
        plan = copy.deepcopy(initial["book"])
        plan["metadata"]["title"] = "The Edited Title"
        status, saved, _ = self.request(
            path, "PUT", {"book": plan, "revision": initial["revision"]}
        )
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved["book"]["metadata"]["title"], "The Edited Title")
        self.assertEqual(saved["book"]["review"]["status"], "draft")
        self.assertEqual(
            self.request(path, "PUT", {"book": plan, "revision": initial["revision"]})[0], 409
        )
        for revision in (None, True, "2", -1):
            self.assertEqual(
                self.request(path, "PUT", {"book": plan, "revision": revision})[0], 422
            )
        for field, value in [("source", "../../outside.json"), ("source_sha256", "forged")]:
            bad = copy.deepcopy(plan)
            bad[field] = value
            status, error, _ = self.request(
                path, "PUT", {"book": bad, "revision": saved["revision"]}
            )
            self.assertEqual(status, 422, error)
            self.assertEqual(error["code"], "protected_source")
        bad = copy.deepcopy(plan)
        bad["sections"][0]["blocks"].pop()
        self.assertEqual(
            self.request(path, "PUT", {"book": bad, "revision": saved["revision"]})[1]["code"],
            "source_coverage",
        )
        current = self.request(path)[1]
        self.assertEqual(current["source"], initial["source"])
        self.assertEqual(current["revision"], saved["revision"])
        status, preview, _ = self.request(
            path + "/preview", "POST", {"revision": saved["revision"], "section": "title"}
        )
        self.assertEqual(status, 200, preview)
        self.assertTrue(
            "The Edited Title" in preview["html"], "The saved title must appear in the preview."
        )
        self.assertTrue(
            "data:font/otf;base64," in preview["html"], "Preview fonts must be self-contained."
        )
        self.assertTrue(".prose >" in preview["html"], "Style selectors must not be XML-escaped.")
        self.assertFalse("<script" in preview["html"])

    def test_review_export_and_download_are_bound_to_the_saved_revision(self):
        from pdf_epub.validate import doctor

        initial = self.import_book()
        path = "/api/projects/" + initial["project"]["id"]
        status, error, _ = self.request(path + "/export", "POST", {"revision": initial["revision"]})
        self.assertEqual(status, 422, error)
        status, reviewed, _ = self.request(
            path + "/review",
            "POST",
            {
                "revision": initial["revision"],
                "note": "Checked source and structure.",
                "resolutions": {w["id"]: "Checked." for w in initial["source"]["warnings"]},
            },
        )
        self.assertEqual(status, 200, reviewed)
        self.assertEqual(reviewed["book"]["review"]["status"], "reviewed")
        status, result, _ = self.request(
            path + "/export", "POST", {"revision": reviewed["revision"]}
        )
        self.assertEqual(status, 200, result)
        if doctor(os.environ.get("EPUBCHECK_JAR"))["epubcheck_available"]:
            self.assertEqual(result["validation"]["status"], "valid", result)
            self.assertTrue(result["can_download"])
            status, data, _ = self.request(path + "/download?export=" + result["export_id"])
            self.assertEqual(status, 200)
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                self.assertIn(b"The first paragraph", archive.read("EPUB/Text/text.xhtml"))
        else:
            self.assertFalse(result["can_download"])
        edited = reviewed["book"]
        edited["metadata"]["author"] = "A New Author"
        status, result, _ = self.request(
            path, "PUT", {"revision": reviewed["revision"], "book": edited}
        )
        self.assertEqual(status, 200, result)
        self.assertEqual(result["book"]["review"]["status"], "draft")
        self.assertIsNone(result["validation"])
        self.assertEqual(self.request(path + "/download")[0], 409)

    def test_old_download_cannot_be_replaced_by_another_export(self):
        initial = self.import_book()
        path = "/api/projects/" + initial["project"]["id"]
        value = {"revision": initial["revision"], "draft": True}
        first = self.request(path + "/export", "POST", value)[1]
        second = self.request(path + "/export", "POST", value)[1]
        self.assertTrue(first["can_download"], first)
        self.assertNotEqual(first["export_id"], second["export_id"])
        self.assertEqual(self.request(path + "/download?export=" + first["export_id"])[0], 409)
        self.assertEqual(self.request(path + "/download?export=" + second["export_id"])[0], 200)
        initial["book"]["metadata"]["title"] = "A new revision"
        self.request(path, "PUT", {"revision": initial["revision"], "book": initial["book"]})
        self.assertEqual(self.request(path + "/download?export=" + second["export_id"])[0], 409)

    def test_image_warning_requires_an_explicit_resolution(self):
        initial = self.import_book(scanned_body=True)
        path = "/api/projects/" + initial["project"]["id"]
        status, error, _ = self.request(
            path + "/review",
            "POST",
            {"revision": initial["revision"], "note": "Checked.", "resolutions": {}},
        )
        self.assertEqual(status, 422, error)
        self.assertEqual(error["code"], "review_required")
        warning_id = initial["source"]["warnings"][0]["id"]
        initial["book"]["review"]["resolutions"] = {warning_id: "Checked first page."}
        status, saved, _ = self.request(
            path, "PUT", {"book": initial["book"], "revision": initial["revision"]}
        )
        self.assertEqual(status, 200, saved)
        reopened = self.request(path)[1]
        self.assertEqual(
            reopened["book"]["review"]["resolutions"], {warning_id: "Checked first page."}
        )
        self.assertEqual(reopened["book"]["review"]["status"], "draft")
        self.assertEqual(
            self.request(path + "/export", "POST", {"revision": saved["revision"]})[0], 422
        )
