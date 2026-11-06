import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from pathlib import Path

from test_build import fixture

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/pdf-to-epub/scripts"))


class ValidateTests(unittest.TestCase):
    def test_unavailable_epubcheck_does_not_report_conformance(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            plan, _ = fixture(root)
            self.invoke("build", str(plan), "--output", str(root / "book.epub"))
            code, result = self.invoke(
                "validate", str(root / "book.epub"), "--epubcheck-jar", str(root / "absent.jar")
            )
            self.assertEqual(code, 2)
            self.assertEqual(result["status"], "unchecked")
            self.assertEqual(result["epubcheck"]["status"], "not_run")

    @unittest.skipUnless(
        os.environ.get("EPUBCHECK_JAR"), "Set EPUBCHECK_JAR for the actual conformance check"
    )
    def test_real_epubcheck_accepts_generated_book(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            plan, _ = fixture(root)
            self.invoke("build", str(plan), "--output", str(root / "book.epub"))
            code, result = self.invoke(
                "validate", str(root / "book.epub"), "--epubcheck-jar", os.environ["EPUBCHECK_JAR"]
            )
            self.assertEqual(code, 0, result)
            self.assertEqual(result["status"], "valid")
            self.assertEqual(result["epubcheck"]["status"], "passed")

    def invoke(self, *args):
        from pdf_epub.cli import main

        capture = io.StringIO()
        with redirect_stdout(capture):
            code = main(list(args))
        return code, json.loads(capture.getvalue())

    def test_internal_checks_are_distinguished_from_epubcheck(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            plan, _ = fixture(root)
            self.assertEqual(
                self.invoke("build", str(plan), "--output", str(root / "book.epub"))[0], 0
            )
            code, result = self.invoke("validate", str(root / "book.epub"), "--internal-only")
            self.assertEqual(code, 0)
            self.assertEqual(result["status"], "internal_passed")
            self.assertEqual(result["epubcheck"]["status"], "not_run")
            self.assertGreater(result["internal"]["text_characters"], 30)

    def test_missing_chapter_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            plan, _ = fixture(root)
            self.invoke("build", str(plan), "--output", str(root / "book.epub"))
            with (
                zipfile.ZipFile(root / "book.epub") as source,
                zipfile.ZipFile(root / "broken.epub", "w") as target,
            ):
                for info in source.infolist():
                    if info.filename != "EPUB/Text/chapter-1.xhtml":
                        target.writestr(info, source.read(info.filename))
            code, result = self.invoke("validate", str(root / "broken.epub"), "--internal-only")
            self.assertNotEqual(code, 0)
            self.assertEqual(result["status"], "invalid")
            self.assertTrue(
                any("chapter-1.xhtml" in error for error in result["internal"]["errors"])
            )


if __name__ == "__main__":
    unittest.main()
