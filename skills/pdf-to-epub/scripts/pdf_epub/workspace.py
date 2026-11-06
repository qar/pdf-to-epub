import base64
import copy
import re
import shutil
import tempfile
import threading
import uuid
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from .build import build_epub
from .common import ConversionError, read_json, write_json
from .extract import extract_pdf
from .model import load_book
from .validate import validate_epub

CURRENT_REVISION = object()


def now():
    return datetime.now(timezone.utc).isoformat()


class Workspace:
    def __init__(self, root, epubcheck_jar=None):
        self.root = Path(root).resolve()
        self.jar = epubcheck_jar
        self.lock = threading.RLock()

    def folder(self, project_id):
        if not re.fullmatch(r"[a-f0-9]{32}", project_id):
            raise ConversionError("not_found", "Project not found.")
        folder = self.root / project_id
        if not folder.is_dir() or folder.resolve().parent != self.root:
            raise ConversionError("not_found", "Project not found.")
        return folder

    def load(self, project_id, revision=CURRENT_REVISION):
        folder = self.folder(project_id)
        meta = read_json(folder / "project.json")
        if revision is not CURRENT_REVISION:
            if type(revision) is not int or revision < 1:
                raise ConversionError("revision", "A positive integer revision is required.")
            if revision != meta["revision"]:
                raise ConversionError("conflict", "This project changed. Reload before saving.")
        plan = folder / "content" / meta["plan"]
        return folder, meta, plan, read_json(plan)

    def summary(self, project_id):
        _folder, meta, _plan, book = self.load(project_id)
        return {
            "id": project_id,
            "title": book["metadata"]["title"],
            "author": book["metadata"].get("author", ""),
            "filename": meta["filename"],
            "pages": meta["pages"],
            "units": meta["units"],
            "sections": len(book["sections"]),
            "review_status": book["review"]["status"],
            "updated_at": meta["updated_at"],
        }

    def detail(self, project_id):
        folder, meta, _plan, book = self.load(project_id)
        return {
            "project": self.summary(project_id),
            "book": book,
            "source": read_json(folder / "content/source.json"),
            "revision": meta["revision"],
            "validation": meta.get("validation"),
        }

    def list_projects(self):
        projects = [
            self.summary(p.name)
            for p in self.root.iterdir()
            if p.is_dir()
            and re.fullmatch(r"[a-f0-9]{32}", p.name)
            and (p / "project.json").exists()
        ]
        return sorted(projects, key=lambda p: p["updated_at"], reverse=True)

    def write_meta(self, folder, meta):
        temporary = folder / (uuid.uuid4().hex + ".json")
        write_json(temporary, meta)
        temporary.replace(folder / "project.json")

    def import_pdf(self, value):
        data = base64.b64decode(value["data"], validate=True)
        if not data.startswith(b"%PDF-") or len(data) > 32 * 1024 * 1024:
            raise ConversionError("invalid_pdf", "Choose a PDF smaller than 32 MiB.")
        project_id = uuid.uuid4().hex
        folder = self.root / project_id
        folder.mkdir(mode=0o700)
        try:
            (folder / "source.pdf").write_bytes(data)
            password_path = None
            if value.get("password"):
                password_path = folder / "password.txt"
                password_path.touch(mode=0o600)
                password_path.write_text(value["password"], encoding="utf-8")
            try:
                extracted = extract_pdf(
                    folder / "source.pdf",
                    folder / "content",
                    value.get("language", "und"),
                    password_path,
                )
            finally:
                if password_path:
                    password_path.unlink(missing_ok=True)
            filename = Path(str(value.get("filename", "document.pdf")).replace("\\", "/")).name
            plan_path = folder / "content/book.json"
            book = read_json(plan_path)
            if book["metadata"]["title"] == "source":
                book["metadata"]["title"] = Path(filename).stem or "Untitled"
                write_json(plan_path, book)
            self.write_meta(
                folder,
                {
                    "id": project_id,
                    "filename": filename,
                    "plan": "book.json",
                    "revision": 1,
                    "pages": extracted["pages"],
                    "units": extracted["units"],
                    "updated_at": now(),
                    "validation": None,
                },
            )
            return self.detail(project_id)
        except Exception:
            shutil.rmtree(folder)
            raise

    def commit_book(self, folder, meta, book, reviewed=False):
        candidate = folder / "content" / ("book-" + uuid.uuid4().hex + ".json")
        write_json(candidate, book)
        try:
            load_book(candidate, allow_draft=not reviewed)
        except Exception:
            candidate.unlink(missing_ok=True)
            raise
        meta.update(
            plan=candidate.name, revision=meta["revision"] + 1, updated_at=now(), validation=None
        )
        meta.pop("export", None)
        self.write_meta(folder, meta)
        return self.detail(meta["id"])

    def save(self, project_id, value):
        folder, meta, _plan, current = self.load(project_id, value["revision"])
        book = copy.deepcopy(value["book"])
        if any(book.get(key) != current[key] for key in ("source", "source_sha256")):
            raise ConversionError(
                "protected_source", "The original extraction evidence cannot be replaced."
            )
        if book == current:
            return self.detail(project_id)
        resolutions = book.get("review", {}).get("resolutions", {})
        warning_ids = {w["id"] for w in read_json(folder / "content/source.json")["warnings"]}
        if (
            not isinstance(resolutions, dict)
            or set(resolutions) - warning_ids
            or any(not isinstance(note, str) for note in resolutions.values())
        ):
            raise ConversionError(
                "review_required", "Review notes must identify extraction warnings."
            )
        book["review"] = {**current["review"], "status": "draft", "resolutions": resolutions}
        return self.commit_book(folder, meta, book)

    def review(self, project_id, value):
        folder, meta, _plan, book = self.load(project_id, value["revision"])
        source = read_json(folder / "content/source.json")
        ids = {w["id"] for w in source["warnings"]}
        resolutions = value.get("resolutions", {})
        if set(resolutions) != ids or any(
            not isinstance(n, str) or not n.strip() for n in resolutions.values()
        ):
            raise ConversionError(
                "review_required", "Resolve every extraction warning with a review note."
            )
        if not isinstance(value.get("note"), str) or not value["note"].strip():
            raise ConversionError(
                "review_required", "Confirm that the text and structure have been checked."
            )
        book["review"] = {
            "status": "reviewed",
            "resolved_warnings": sorted(ids),
            "resolutions": resolutions,
            "notes": [value["note"], *[f"{key}: {note}" for key, note in resolutions.items()]],
        }
        return self.commit_book(folder, meta, book, reviewed=True)

    def preview(self, project_id, value):
        folder, _meta, plan, book = self.load(project_id, value["revision"])
        section = value.get("section", book["sections"][0]["id"])
        if section not in {"title", "contents", *[s["id"] for s in book["sections"]]}:
            raise ConversionError("not_found", "Section not found.")
        with tempfile.TemporaryDirectory(dir=folder, prefix="preview-") as directory:
            target = Path(directory) / "preview.epub"
            build_epub(plan, target, allow_draft=True)
            with zipfile.ZipFile(target) as archive:
                root = ET.fromstring(archive.read(f"EPUB/Text/{section}.xhtml"))
                css = archive.read("EPUB/Styles/book.css").decode()
                for name in archive.namelist():
                    if name.startswith("EPUB/Fonts/") and name.endswith(".otf"):
                        data = base64.b64encode(archive.read(name)).decode()
                        css = css.replace(
                            "../Fonts/" + name.rsplit("/", 1)[1], "data:font/otf;base64," + data
                        )
                ns = "http://www.w3.org/1999/xhtml"
                head = root.find(f"{{{ns}}}head")
                for link in list(head.findall(f"{{{ns}}}link")):
                    head.remove(link)
                ET.SubElement(head, f"{{{ns}}}style").text = css
                ET.SubElement(
                    head,
                    f"{{{ns}}}meta",
                    {
                        "http-equiv": "Content-Security-Policy",
                        "content": "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:",
                    },
                )
                ET.register_namespace("", ns)
                return {
                    "html": ET.tostring(root, encoding="unicode", method="html"),
                    "revision": value["revision"],
                }

    def export(self, project_id, value):
        folder, meta, plan, book = self.load(project_id, value["revision"])
        draft = value.get("draft") is True
        export_id = uuid.uuid4().hex
        filename = "export-" + export_id + ".epub"
        target = folder / filename
        build_epub(plan, target, allow_draft=draft)
        validation = validate_epub(target, self.jar)
        can_download = validation["status"] == "valid" or (
            draft and validation["status"] == "unchecked"
        )
        name = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", book["metadata"]["title"])[:100]
        download_name = name + (".draft.epub" if draft else ".epub")
        result = {
            "status": "draft" if draft and can_download else validation["status"],
            "export_id": export_id,
            "validation": validation,
            "can_download": can_download,
            "filename": download_name,
            "revision": meta["revision"],
        }
        meta.update(
            validation=result,
            export={
                "id": export_id,
                "path": filename,
                "filename": download_name,
                "allowed": can_download,
            },
        )
        self.write_meta(folder, meta)
        return result

    def download(self, project_id, export_id):
        folder, meta, _plan, _book = self.load(project_id)
        exported = meta.get("export")
        if not exported or not exported["allowed"] or exported.get("id") != export_id:
            raise ConversionError("conflict", "Export this saved revision before downloading.")
        return (folder / exported["path"]).read_bytes(), exported["filename"]
