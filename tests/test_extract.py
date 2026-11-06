import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from pdf_fixture import make_pdf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/pdf-to-epub/scripts"))


@unittest.skipUnless(shutil.which("pdftohtml") and shutil.which("pdftotext"), "Poppler is required")
class ExtractTests(unittest.TestCase):
    def invoke(self, *args):
        from pdf_epub.cli import main

        output = io.StringIO()
        with redirect_stdout(output):
            code = main(list(args))
        return code, json.loads(output.getvalue())

    def test_mixed_inline_styles_do_not_spread_to_surrounding_text(self):
        from pdf_epub.extract import parse_layout

        with tempfile.TemporaryDirectory() as temp:
            layout = Path(temp) / "layout.xml"
            layout.write_text(
                '<pdf2xml><page number="1" width="300" height="400">'
                '<fontspec id="0" size="12" family="Times"/>'
                '<text top="10" left="10" width="200" height="12" font="0">'
                "Plain <i>italic <b>both</b></i> plain.</text></page></pdf2xml>"
            )
            source = parse_layout(layout, ["Plain italic both plain."])
            unit = source["units"][0]
            styles = {c: run["styles"] for run in unit["runs"] for c in run["text"] if c in "Pib"}
            self.assertEqual(unit["text"], "Plain italic both plain.")
            self.assertEqual(styles["P"], [])
            self.assertEqual(styles["b"], ["bold", "italic"])
            self.assertEqual(unit["runs"][-1]["styles"], [])

    def test_no_text_layer_requests_ocr_without_creating_a_fake_book(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_pdf(root / "blank.pdf", empty=True)
            code, result = self.invoke(
                "extract", str(root / "blank.pdf"), "--work-dir", str(root / "work")
            )
            self.assertNotEqual(code, 0)
            self.assertEqual(result["code"], "ocr_required")
            self.assertFalse((root / "work").exists())

    def test_scanned_body_with_native_page_number_requires_image_review(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_pdf(root / "scan.pdf", scanned_body=True)
            code, result = self.invoke(
                "extract", str(root / "scan.pdf"), "--work-dir", str(root / "work")
            )
            self.assertEqual(code, 0, result)
            warnings = result["warnings"]
            self.assertTrue(any(w["page"] == 1 and w["code"] == "page_images" for w in warnings))
            source = json.loads((root / "work/source.json").read_text())
            self.assertEqual(source["units"][0]["text"], "Page 1")
            self.assertGreater(len(source["pages"][0]["images"]), 0)
            plan = root / "work/book.json"
            book = json.loads(plan.read_text())
            book["review"]["status"] = "reviewed"
            plan.write_text(json.dumps(book))
            code, result = self.invoke("build", str(plan), "--output", str(root / "scan.epub"))
            self.assertEqual(code, 1)
            self.assertEqual(result["code"], "review_required")
            self.assertFalse((root / "scan.epub").exists())

    @unittest.skipUnless(shutil.which("qpdf"), "qpdf is required")
    def test_copy_restricted_pdf_is_extracted_without_modifying_the_original(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_pdf(root / "source.pdf")
            subprocess.run(
                [
                    "qpdf",
                    "--encrypt",
                    "",
                    "owner-test-password",
                    "256",
                    "--extract=n",
                    "--",
                    str(root / "source.pdf"),
                    str(root / "restricted.pdf"),
                ],
                check=True,
                capture_output=True,
            )
            before = (root / "restricted.pdf").read_bytes()
            code, result = self.invoke(
                "extract",
                str(root / "restricted.pdf"),
                "--work-dir",
                str(root / "work"),
                "--language",
                "en",
            )
            self.assertEqual(code, 0, result)
            self.assertTrue(result["permissions_removed"])
            self.assertEqual((root / "restricted.pdf").read_bytes(), before)

    @unittest.skipUnless(shutil.which("qpdf"), "qpdf is required")
    def test_opening_password_is_read_from_a_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_pdf(root / "source.pdf")
            password = "reader test 'quoted' $value"
            subprocess.run(
                [
                    "qpdf",
                    "--encrypt",
                    password,
                    "owner-test-password",
                    "256",
                    "--",
                    str(root / "source.pdf"),
                    str(root / "restricted.pdf"),
                ],
                check=True,
                capture_output=True,
            )
            code, result = self.invoke(
                "extract", str(root / "restricted.pdf"), "--work-dir", str(root / "work")
            )
            self.assertNotEqual(code, 0)
            self.assertEqual(result["code"], "password_required")
            (root / "password.txt").write_text(password + "\n")
            code, result = self.invoke(
                "extract",
                str(root / "restricted.pdf"),
                "--work-dir",
                str(root / "work"),
                "--password-file",
                str(root / "password.txt"),
            )
            self.assertEqual(code, 0, result)

    def test_existing_work_directory_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_pdf(root / "source.pdf")
            (root / "work").mkdir()
            (root / "work/notes.txt").write_text("Keep my annotations.")
            code, result = self.invoke(
                "extract", str(root / "source.pdf"), "--work-dir", str(root / "work")
            )
            self.assertNotEqual(code, 0)
            self.assertEqual(result["code"], "output_exists")
            self.assertEqual((root / "work/notes.txt").read_text(), "Keep my annotations.")

    def test_native_pdf_produces_reviewable_paragraphs_and_rejoins_pages(self):
        from pdf_epub.cli import main

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_pdf(root / "input.pdf")
            output = io.StringIO()
            with redirect_stdout(output):
                code = main(
                    [
                        "extract",
                        str(root / "input.pdf"),
                        "--work-dir",
                        str(root / "work"),
                        "--language",
                        "en",
                    ]
                )
            self.assertEqual(code, 0, output.getvalue())
            result = json.loads(output.getvalue())
            self.assertEqual(result["status"], "draft")
            source = json.loads((root / "work/source.json").read_text())
            plan = json.loads((root / "work/book.json").read_text())
            self.assertEqual(plan["review"]["status"], "draft")
            units = {item["id"]: item for item in source["units"]}
            blocks = plan["sections"][0]["blocks"]
            paragraphs = [
                " ".join(units[key]["text"] for key in block["sources"]) for block in blocks
            ]
            self.assertIn("The story continues across pages.", paragraphs)
            self.assertIn("The first paragraph has a quiet opening.", paragraphs)
            self.assertIn('"Come back," she said.', paragraphs)
            self.assertTrue(
                any("italic" in run["styles"] for unit in units.values() for run in unit["runs"])
            )
            self.assertEqual(source["input"]["name"], "input.pdf")


if __name__ == "__main__":
    unittest.main()
