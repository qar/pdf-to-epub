import hashlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/pdf-to-epub/scripts"))
CLI = ROOT / "skills/pdf-to-epub/scripts/epub.py"


def fixture(folder):
    source = {
        "version": 1,
        "units": [
            {
                "id": "p0001-l0001",
                "page": 1,
                "text": "A quiet beginning.",
                "runs": [
                    {"text": "A quiet ", "styles": []},
                    {"text": "beginning.", "styles": ["italic"]},
                ],
            },
            {
                "id": "p0001-l0002",
                "page": 1,
                "text": 'She said, "Come home."',
                "runs": [{"text": 'She said, "Come home."', "styles": []}],
            },
        ],
        "warnings": [],
    }
    source_path = folder / "source.json"
    source_path.write_text(json.dumps(source), encoding="utf-8")
    book = {
        "version": 1,
        "source": "source.json",
        "source_sha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
        "metadata": {"title": "The Quiet House", "author": "Example Author", "language": "en"},
        "review": {"status": "reviewed", "notes": ["Checked the two source paragraphs."]},
        "sections": [
            {
                "id": "chapter-1",
                "title": "A Beginning",
                "kind": "chapter",
                "blocks": [
                    {"kind": "paragraph", "sources": ["p0001-l0001"]},
                    {"kind": "paragraph", "sources": ["p0001-l0002"]},
                ],
            }
        ],
        "omissions": [],
    }
    path = folder / "book.json"
    path.write_text(json.dumps(book), encoding="utf-8")
    return path, book


class BuildTests(unittest.TestCase):
    def invoke(self, plan, output, *extra):
        from pdf_epub.cli import main

        captured = io.StringIO()
        with redirect_stdout(captured):
            code = main(["build", str(plan), "--output", str(output), *extra])
        return code, json.loads(captured.getvalue())

    def test_build_rejects_missing_or_repeated_source_text(self):
        for change in ("omit", "duplicate"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                plan, book = fixture(root)
                blocks = book["sections"][0]["blocks"]
                if change == "omit":
                    blocks.pop()
                else:
                    blocks.append(blocks[0])
                plan.write_text(json.dumps(book), encoding="utf-8")
                code, result = self.invoke(plan, root / "book.epub")
                self.assertNotEqual(code, 0)
                self.assertEqual(result["code"], "source_coverage")
                self.assertFalse((root / "book.epub").exists())

    def test_review_and_source_evidence_are_required(self):
        for change, expected in [
            ("draft", "review_required"),
            ("hash", "source_changed"),
            ("replacement", "untracked_text"),
            ("path", "section_id"),
        ]:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                plan, book = fixture(root)
                if change == "draft":
                    book["review"]["status"] = "draft"
                elif change == "hash":
                    (root / "source.json").write_text("{}")
                elif change == "replacement":
                    book["sections"][0]["blocks"][0]["text"] = "A changed meaning."
                else:
                    book["sections"][0]["id"] = "../title"
                plan.write_text(json.dumps(book))
                code, result = self.invoke(plan, root / "book.epub")
                self.assertNotEqual(code, 0)
                self.assertEqual(result["code"], expected)
                self.assertFalse((root / "book.epub").exists())

    def test_existing_output_and_source_are_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            plan, _ = fixture(root)
            before = (root / "source.json").read_bytes()
            target = root / "book.epub"
            target.write_bytes(b"existing work")
            code, result = self.invoke(plan, target)
            self.assertNotEqual(code, 0)
            self.assertEqual(result["code"], "output_exists")
            self.assertEqual(target.read_bytes(), b"existing work")
            self.assertEqual((root / "source.json").read_bytes(), before)

    def test_invalid_model_returns_json_without_creating_output(self):
        for value in ([], None, {"version": 1, "source": []}):
            with self.subTest(value=value), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                plan = root / "book.json"
                plan.write_text(json.dumps(value))
                code, result = self.invoke(plan, root / "book.epub")
                self.assertEqual(code, 1)
                self.assertEqual(result["status"], "error")
                self.assertFalse((root / "book.epub").exists())

    def test_source_chapter_title_is_rendered_once_and_counted_as_used(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            plan, book = fixture(root)
            section = book["sections"][0]
            section["title_sources"] = section["blocks"].pop(0)["sources"]
            plan.write_text(json.dumps(book))
            code, result = self.invoke(plan, root / "book.epub")
            self.assertEqual(code, 0, result)
            with zipfile.ZipFile(root / "book.epub") as archive:
                doc = ET.fromstring(archive.read("EPUB/Text/chapter-1.xhtml"))
                ns = {"h": "http://www.w3.org/1999/xhtml"}
                body = doc.find("h:body", ns)
                self.assertEqual("".join(body.itertext()).count("A quiet beginning."), 1)
                self.assertEqual(
                    "".join(doc.find(".//h:header/h:h1", ns).itertext()), "A quiet beginning."
                )

    def test_section_names_do_not_conflict_with_package_resource_ids(self):
        from pdf_epub.validate import internal_check

        for name in ("css", "font-0"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                plan, book = fixture(root)
                book["sections"][0]["id"] = name
                plan.write_text(json.dumps(book))
                target = root / "book.epub"
                self.assertEqual(self.invoke(plan, target)[0], 0)
                self.assertEqual(internal_check(target)["errors"], [])

    def test_cjk_lines_join_without_spaces_after_fullwidth_punctuation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            plan, book = fixture(root)
            source_path = root / "source.json"
            source = json.loads(source_path.read_text())
            for unit, text in zip(source["units"], ["\u4f60\u597d\uff0c", "\u4e16\u754c\u3002"]):
                unit["text"] = text
                unit["runs"] = [{"text": text, "styles": []}]
            source_path.write_text(json.dumps(source))
            book["source_sha256"] = hashlib.sha256(source_path.read_bytes()).hexdigest()
            book["metadata"]["language"] = "zh-Hans"
            book["sections"][0]["blocks"] = [
                {"kind": "paragraph", "sources": [u["id"] for u in source["units"]]}
            ]
            plan.write_text(json.dumps(book))
            target = root / "book.epub"
            self.assertEqual(self.invoke(plan, target)[0], 0)
            with zipfile.ZipFile(target) as archive:
                doc = ET.fromstring(archive.read("EPUB/Text/chapter-1.xhtml"))
                paragraph = doc.find(
                    ".//{http://www.w3.org/1999/xhtml}section/{http://www.w3.org/1999/xhtml}p"
                )
                self.assertEqual(
                    "".join(paragraph.itertext()), "\u4f60\u597d\uff0c\u4e16\u754c\u3002"
                )

    def test_explicit_omission_quote_and_verse_keep_source_text(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            plan, book = fixture(root)
            book["sections"][0]["blocks"] = [
                {"kind": "quote", "blocks": [{"kind": "verse", "sources": ["p0001-l0001"]}]}
            ]
            book["omissions"] = [
                {"source": "p0001-l0002", "reason": "Synthetic repeated running header."}
            ]
            plan.write_text(json.dumps(book))
            code, result = self.invoke(plan, root / "book.epub")
            self.assertEqual(code, 0, result)
            self.assertEqual(result["omitted_units"], 1)
            with zipfile.ZipFile(root / "book.epub") as archive:
                doc = ET.fromstring(archive.read("EPUB/Text/chapter-1.xhtml"))
                quote = doc.find(".//{http://www.w3.org/1999/xhtml}blockquote")
                self.assertIsNotNone(quote)
                self.assertEqual("".join(quote.itertext()), "A quiet beginning.")

    def test_draft_preview_is_labeled_as_draft(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            plan, book = fixture(root)
            book["review"]["status"] = "draft"
            plan.write_text(json.dumps(book))
            code, result = self.invoke(plan, root / "preview.epub", "--allow-draft")
            self.assertEqual(code, 0, result)
            self.assertEqual(result["status"], "draft_built")

    def test_reviewed_book_builds_searchable_epub_with_navigation_and_italics(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            plan, _ = fixture(root)
            result = subprocess.run(
                [sys.executable, str(CLI), "build", str(plan), "--output", str(root / "book.epub")],
                check=False,
                text=True,
                capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["status"], "built")
            with zipfile.ZipFile(root / "book.epub") as epub:
                self.assertEqual(epub.infolist()[0].filename, "mimetype")
                self.assertEqual(epub.infolist()[0].compress_type, zipfile.ZIP_STORED)
                documents = [
                    ET.fromstring(epub.read(n)) for n in epub.namelist() if n.endswith(".xhtml")
                ]
                ns = {"h": "http://www.w3.org/1999/xhtml"}
                texts = [
                    "".join(e.itertext()) for doc in documents for e in doc.findall(".//h:p", ns)
                ]
                self.assertIn("A quiet beginning.", texts)
                self.assertIn('She said, "Come home."', texts)
                self.assertTrue(
                    any(
                        e.text == "beginning."
                        for doc in documents
                        for e in doc.findall(".//h:em", ns)
                    )
                )
                self.assertTrue(
                    any(
                        e.text == "A Beginning"
                        for doc in documents
                        for e in doc.findall(".//h:nav//h:a", ns)
                    )
                )
                self.assertFalse(any(doc.findall(".//h:img", ns) for doc in documents))


if __name__ == "__main__":
    unittest.main()
