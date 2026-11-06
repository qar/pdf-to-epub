import re
import shutil
import statistics
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from collections import Counter
from itertools import pairwise
from pathlib import Path

from .common import ConversionError, digest, write_json


def tool(name):
    path = shutil.which(name)
    if not path:
        raise ConversionError(
            "missing_tool", f"Install {name} before extracting PDF text.", tool=name
        )
    return path


def run(args):
    return subprocess.run(
        args,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=300,
    )


def compact(text):
    return "".join(text.split())


def terminal(text):
    if re.search(r"\b(?:Mrs?|Ms|Dr|St|Prof|Rev|Sr|Jr|[A-Z])\.$", text):
        return False
    return bool(re.search(r"[.!?:;\-\u3002\uff01\uff1f][\"\u201d\u2019\)\]]*$", text))


def styled_characters(node, inherited):
    styles = set(inherited)
    if node.tag in {"b", "i"}:
        styles.add({"b": "bold", "i": "italic"}[node.tag])
    current = sorted(styles)
    yield from ((char, current) for char in node.text or "")
    for child in node:
        yield from styled_characters(child, current)
        yield from ((char, current) for char in child.tail or "")


def parse_layout(path, raw_pages):
    root = ET.parse(path).getroot()
    fonts = {
        node.get("id"): {"size": float(node.get("size")), "family": node.get("family", "")}
        for node in root.findall(".//fontspec")
    }
    units, pages, warnings = [], [], []
    duplicates = 0
    for page in root.findall("page"):
        number = int(page.get("number"))
        width, height = float(page.get("width")), float(page.get("height"))
        raw = raw_pages[number - 1] if number <= len(raw_pages) else ""
        page_info = {"number": number, "width": width, "height": height, "raw_text": raw.strip()}
        page_info["images"] = [
            {key: float(image.get(key)) for key in ("top", "left", "width", "height")}
            for image in page.findall("image")
        ]
        pages.append(page_info)
        if page_info["images"]:
            warnings.append(
                {
                    "id": f"p{number:04}-images",
                    "code": "page_images",
                    "page": number,
                    "message": "Page images are not included in the text model. Check for scanned text, illustrations or formulas; apply OCR or preserve required content before review.",
                }
            )
        items = []
        for node in page.findall("text"):
            text = "".join(node.itertext())
            if not text.strip():
                continue
            font = fonts[node.get("font")]
            item = {key: float(node.get(key)) for key in ("top", "left", "width", "height")}
            family = font["family"].lower()
            styles = []
            if "bold" in family:
                styles.append("bold")
            if "italic" in family or "oblique" in family:
                styles.append("italic")
            item.update(
                text=text,
                size=font["size"],
                characters=list(styled_characters(node, styles)),
            )
            if any(
                compact(item["text"]) == compact(prev["text"])
                and abs(item["left"] - prev["left"]) < 2
                and abs(item["top"] - prev["top"]) < 2
                for prev in items[-4:]
            ):
                duplicates += 1
                continue
            items.append(item)
        if not items:
            warnings.append(
                {
                    "id": f"p{number:04}-no-text",
                    "code": "page_without_text",
                    "page": number,
                    "message": "Check whether this is a blank page, illustration, or a page requiring OCR.",
                }
            )
            continue
        lines, separated = [], False
        for item in items:
            overlap = (
                bool(lines)
                and min(lines[-1]["bottom"], item["top"] + item["height"])
                - max(lines[-1]["top"], item["top"])
                >= min(lines[-1]["height"], item["height"]) * 0.4
            )
            large_gap = overlap and item["left"] - lines[-1]["right"] > item["size"] * 4
            if overlap and not large_gap:
                line = lines[-1]
                line["items"].append(item)
                line["left"] = min(line["left"], item["left"])
                line["right"] = max(line["right"], item["left"] + item["width"])
            else:
                separated |= bool(large_gap)
                lines.append(
                    {
                        "top": item["top"],
                        "bottom": item["top"] + item["height"],
                        "height": item["height"],
                        "left": item["left"],
                        "right": item["left"] + item["width"],
                        "items": [item],
                    }
                )
        for line in lines:
            line["items"].sort(key=lambda x: x["left"])
        aligned = "".join(
            compact(item["text"]) for line in lines for item in line["items"]
        ) == compact(raw)
        if not aligned:
            warnings.append(
                {
                    "id": f"p{number:04}-text-order",
                    "code": "text_order",
                    "page": number,
                    "message": "Layout text differs from plain extraction. Inspect reading order and overlapping glyphs.",
                }
            )
        if separated:
            warnings.append(
                {
                    "id": f"p{number:04}-columns",
                    "code": "columns_or_form",
                    "page": number,
                    "message": "Separated text columns or form fields require semantic reconstruction.",
                }
            )
        positions = [i for i, c in enumerate(raw) if not c.isspace()]
        cursor = 0
        for index, line in enumerate(lines, 1):
            chars = [
                (c, styles)
                for item in line["items"]
                for c, styles in item["characters"]
                if not c.isspace()
            ]
            if aligned:
                text = raw[positions[cursor] : positions[cursor + len(chars) - 1] + 1]
                styled, i = [], 0
                for char in text:
                    styles = chars[i][1] if not char.isspace() else []
                    styled.append((char, styles))
                    i += not char.isspace()
            else:
                text = "".join(item["text"] for item in line["items"]).strip()
                styled = [pair for item in line["items"] for pair in item["characters"]]
                while styled and styled[0][0].isspace():
                    styled.pop(0)
                while styled and styled[-1][0].isspace():
                    styled.pop()
            cursor += len(chars)
            runs = []
            for char, styles in styled:
                if runs and runs[-1]["styles"] == styles:
                    runs[-1]["text"] += char
                else:
                    runs.append({"text": char, "styles": styles})
            units.append(
                {
                    "id": f"p{number:04}-l{index:04}",
                    "page": number,
                    "text": text,
                    "runs": runs,
                    "bbox": [line["left"], line["top"], line["right"], line["bottom"]],
                    "font_size": max(item["size"] for item in line["items"]),
                }
            )
    if not units:
        raise ConversionError(
            "ocr_required",
            "No usable text layer was found. OCR is required; an image-only EPUB is not a text conversion.",
        )
    return {
        "version": 1,
        "pages": pages,
        "units": units,
        "warnings": warnings,
        "duplicate_glyphs_removed": duplicates,
    }


def paragraph_candidates(source):
    units = source["units"]
    font_counts = Counter()
    for unit in units:
        font_counts[unit["font_size"]] += len(unit["text"])
    body_size = font_counts.most_common(1)[0][0]
    page_map = {page["number"]: page for page in source["pages"]}
    metrics = {}
    for page in page_map:
        page_units = [u for u in units if u["page"] == page]
        regular = [u for u in page_units if u["font_size"] <= body_size * 1.25] or page_units
        if not regular:
            continue
        left = Counter(round(u["bbox"][0], 0) for u in regular).most_common()
        margin = min(x for x, count in left if count >= max(1, left[0][1] * 0.15))
        steps = [
            b["bbox"][1] - a["bbox"][1]
            for a, b in pairwise(regular)
            if 0 < b["bbox"][1] - a["bbox"][1] <= body_size * 1.8
        ]
        metrics[page] = (margin, statistics.median(steps) if steps else body_size * 1.2)
    blocks, previous = [], None
    for unit in units:
        margin, leading = metrics[unit["page"]]
        heading = unit["font_size"] > body_size * 1.35
        new = previous is None or heading or blocks[-1]["kind"] == "heading"
        if previous and not new:
            x, y, _right, _ = unit["bbox"]
            _px, py, pright, _ = previous["bbox"]
            same_page = previous["page"] == unit["page"]
            indent = x - margin > body_size * 0.65
            gap = same_page and y - py > leading * 1.55
            prev_width = page_map[previous["page"]]["width"]
            short = pright < prev_width - metrics[previous["page"]][0] - body_size * 1.5
            starts = bool(re.match(r"[A-Z\"\u201c\(\d\u3400-\u9fff]", unit["text"]))
            new = bool(gap or indent or (short and terminal(previous["text"]) and starts))
            if not terminal(previous["text"]) and re.match(r"^[a-z]", unit["text"]):
                new = False
        if new:
            blocks.append({"kind": "heading" if heading else "paragraph", "sources": [unit["id"]]})
        else:
            blocks[-1]["sources"].append(unit["id"])
        previous = unit
    return blocks


def extract_pdf(pdf_path, work_dir, language="und", password_file=None):
    pdf_path, work_dir = Path(pdf_path).resolve(), Path(work_dir).absolute()
    if not pdf_path.is_file():
        raise ConversionError("input_missing", f"PDF does not exist: {pdf_path}")
    if work_dir.exists():
        raise ConversionError("output_exists", f"Work directory already exists: {work_dir}")
    html_tool, text_tool = tool("pdftohtml"), tool("pdftotext")
    with tempfile.TemporaryDirectory(prefix="pdf-to-epub-") as temp:
        temp = Path(temp)
        readable = pdf_path
        layout = temp / "layout.xml"

        def get_layout():
            return run([html_tool, "-xml", "-hidden", "-zoom", "1", str(readable), str(layout)])

        result = get_layout()
        unlocked = False
        if result.returncode and any(
            s in result.stderr.lower() for s in ("copying", "password", "encrypted")
        ):
            readable = temp / "readable.pdf"
            password = (
                f"--password-file={Path(password_file).resolve()}"
                if password_file
                else "--password="
            )
            decrypted = run([tool("qpdf"), password, "--decrypt", str(pdf_path), str(readable)])
            if decrypted.returncode not in (0, 3) or not readable.exists():
                raise ConversionError(
                    "password_required",
                    "The PDF needs a valid opening password. Supply it through --password-file; passwords are not logged.",
                )
            unlocked = True
            result = get_layout()
        if result.returncode or not layout.exists():
            raise ConversionError(
                "extraction_failed", result.stderr.strip() or "PDF layout extraction failed."
            )
        plain = run([text_tool, "-raw", str(readable), "-"])
        if plain.returncode:
            raise ConversionError("extraction_failed", plain.stderr.strip())
        source = parse_layout(layout, plain.stdout.split("\f"))
        title, author = pdf_path.stem, ""
        if shutil.which("pdfinfo"):
            info = run(["pdfinfo", str(readable)])
            fields = dict(line.split(":", 1) for line in info.stdout.splitlines() if ":" in line)
            title = fields.get("Title", title).strip() or title
            author = fields.get("Author", "").strip()
        source["input"] = {
            "name": pdf_path.name,
            "sha256": digest(pdf_path),
            "permissions_removed": unlocked,
        }
        work_dir.mkdir(parents=True, exist_ok=False)
        write_json(work_dir / "source.json", source)
        book = {
            "version": 1,
            "source": "source.json",
            "source_sha256": digest(work_dir / "source.json"),
            "metadata": {"title": title, "author": author, "language": language},
            "review": {"status": "draft", "notes": [], "resolved_warnings": []},
            "sections": [
                {
                    "id": "text",
                    "title": title,
                    "kind": "chapter",
                    "blocks": paragraph_candidates(source),
                }
            ],
            "omissions": [],
        }
        write_json(work_dir / "book.json", book)
    return {
        "status": "draft",
        "work_dir": str(work_dir),
        "plan": str(work_dir / "book.json"),
        "pages": len(source["pages"]),
        "units": len(source["units"]),
        "paragraph_candidates": len(book["sections"][0]["blocks"]),
        "warnings": source["warnings"],
        "permissions_removed": unlocked,
    }
