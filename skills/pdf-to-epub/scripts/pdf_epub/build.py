import os
import tempfile
import unicodedata
import uuid
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from .common import ConversionError
from .model import load_book

XHTML = "http://www.w3.org/1999/xhtml"
EPUB = "http://www.idpf.org/2007/ops"
ASSETS = Path(__file__).parent / "assets"
ET.register_namespace("epub", EPUB)


def xml(root):
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def xhtml(title):
    root = ET.Element(
        "html", {"xmlns": XHTML, "lang": "en", "{http://www.w3.org/XML/1998/namespace}lang": "en"}
    )
    head = ET.SubElement(root, "head")
    ET.SubElement(head, "meta", {"charset": "utf-8"})
    ET.SubElement(head, "title").text = title
    ET.SubElement(
        head, "link", {"rel": "stylesheet", "type": "text/css", "href": "../Styles/book.css"}
    )
    return root, ET.SubElement(root, "body")


def append_text(node, text):
    if len(node):
        node[-1].tail = (node[-1].tail or "") + text
    else:
        node.text = (node.text or "") + text


def append_runs(node, runs):
    for run in runs:
        parent = node
        if "bold" in run.get("styles", []):
            parent = ET.SubElement(parent, "strong")
        if "italic" in run.get("styles", []):
            parent = ET.SubElement(parent, "em")
        append_text(parent, run["text"])


def render_block(parent, block, units, heading_tag="h2"):
    kind = block["kind"]
    if kind == "quote":
        node = ET.SubElement(parent, "blockquote")
        for child in block["blocks"]:
            render_block(node, child, units)
        return
    tag = heading_tag if kind == "heading" else "p"
    node = ET.SubElement(parent, tag)
    classes = {
        "source": "source",
        "verse": "verse",
        "scene-break": "divider",
        "signature": "signature",
        "thought": "thought",
    }
    if kind in classes:
        node.set("class", classes[kind])
    previous = None
    for source_id in block["sources"]:
        unit = units[source_id]
        if previous is not None:
            mode = block.get("joins", {}).get(previous["id"], "auto")
            if kind == "verse" or mode == "line":
                ET.SubElement(node, "br")
            elif mode == "space":
                append_text(node, " ")
            elif mode == "auto":
                a, b = previous["text"].rstrip(), unit["text"].lstrip()
                cjk = bool(
                    a
                    and b
                    and unicodedata.east_asian_width(a[-1]) in {"W", "F"}
                    and unicodedata.east_asian_width(b[0]) in {"W", "F"}
                )
                if not cjk and not (a.endswith("-") and b and b[0].isalpha()):
                    append_text(node, " ")
        append_runs(node, unit["runs"])
        previous = unit


def build_epub(plan_path, output, allow_draft=False):
    plan_path, output = Path(plan_path).resolve(), Path(output).absolute()
    book, _source, units = load_book(plan_path, allow_draft)
    metadata = book["metadata"]
    language = metadata["language"]
    files = {}
    spine = []
    title, body = xhtml(metadata["title"])
    page = ET.SubElement(body, "section", {"class": "title-page", f"{{{EPUB}}}type": "titlepage"})
    ET.SubElement(page, "p", {"class": "author"}).text = metadata.get("author", "")
    ET.SubElement(page, "h1").text = metadata["title"]
    ET.SubElement(page, "hr", {"class": "short-rule"})
    files["EPUB/Text/title.xhtml"] = title
    spine.append(("title", "Text/title.xhtml"))
    nav, nav_body = xhtml("Contents")
    navigation = ET.SubElement(
        nav_body, "nav", {f"{{{EPUB}}}type": "toc", "id": "toc", "class": "contents"}
    )
    ET.SubElement(navigation, "h1").text = "Contents"
    links = ET.SubElement(navigation, "ol")
    files["EPUB/Text/contents.xhtml"] = nav
    spine.append(("contents", "Text/contents.xhtml"))
    for section in book["sections"]:
        name = section["id"]
        document, body = xhtml(section["title"])
        article = ET.SubElement(
            body, "section", {"class": "prose", f"{{{EPUB}}}type": section.get("kind", "chapter")}
        )
        header = ET.SubElement(
            article,
            "header",
            {"class": "part-page" if section.get("kind") == "part" else "section-heading"},
        )
        if section.get("title_sources"):
            render_block(
                header,
                {
                    "kind": "heading",
                    "sources": section["title_sources"],
                    "joins": section.get("title_joins", {}),
                },
                units,
                "h1",
            )
        else:
            ET.SubElement(header, "h1").text = section["title"]
        ET.SubElement(header, "hr", {"class": "short-rule"})
        for block in section.get("blocks", []):
            render_block(article, block, units)
        files[f"EPUB/Text/{name}.xhtml"] = document
        spine.append((name, f"Text/{name}.xhtml"))
        item = ET.SubElement(links, "li")
        ET.SubElement(item, "a", {"href": f"{name}.xhtml"}).text = section["title"]
    for name, root in list(files.items()):
        root.set("lang", language)
        root.set("{http://www.w3.org/XML/1998/namespace}lang", language)
        files[name] = xml(root)
    css = (ASSETS / "book.css").read_text(encoding="utf-8")
    appearance = book.get("appearance", {})
    if appearance:
        template = appearance.get("template", "classic")
        size = appearance.get("font_size", 1)
        leading = appearance.get("line_height", 1.35 if template == "compact" else 1.5)
        indent = appearance.get("indent", 1.25)
        family = "font-family: system-ui, sans-serif;" if template == "modern" else ""
        css += f"\nbody {{ font-size: {size:.2f}em; line-height: {leading:.2f}; {family} }}\n"
        # Low specificity preserves unindented chapter openings, verse and signatures.
        css += f"p {{ text-indent: {indent:.2f}em; }}\n"
    files["EPUB/Styles/book.css"] = css.encode("utf-8")
    for font in sorted((ASSETS / "fonts").iterdir()):
        files[f"EPUB/Fonts/{font.name}"] = font.read_bytes()
    container = ET.Element(
        "container", {"xmlns": "urn:oasis:names:tc:opendocument:xmlns:container", "version": "1.0"}
    )
    roots = ET.SubElement(container, "rootfiles")
    ET.SubElement(
        roots,
        "rootfile",
        {"full-path": "EPUB/package.opf", "media-type": "application/oebps-package+xml"},
    )
    files["META-INF/container.xml"] = xml(container)
    package = ET.Element(
        "package",
        {
            "xmlns": "http://www.idpf.org/2007/opf",
            "version": "3.0",
            "unique-identifier": "book-id",
            "prefix": "rendition: http://www.idpf.org/vocab/rendition/#",
        },
    )
    meta = ET.SubElement(package, "metadata", {"xmlns:dc": "http://purl.org/dc/elements/1.1/"})
    ET.SubElement(meta, "dc:identifier", {"id": "book-id"}).text = f"urn:uuid:{uuid.uuid4()}"
    ET.SubElement(meta, "dc:title").text = metadata["title"]
    ET.SubElement(meta, "dc:language").text = language
    if metadata.get("author"):
        ET.SubElement(meta, "dc:creator").text = metadata["author"]
    ET.SubElement(meta, "meta", {"property": "dcterms:modified"}).text = datetime.now(
        timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")
    ET.SubElement(meta, "meta", {"property": "rendition:layout"}).text = "reflowable"
    manifest = ET.SubElement(package, "manifest")
    for name, href in spine:
        attrs = {"id": f"doc-{name}", "href": href, "media-type": "application/xhtml+xml"}
        if name == "contents":
            attrs["properties"] = "nav"
        ET.SubElement(manifest, "item", attrs)
    ET.SubElement(
        manifest, "item", {"id": "css", "href": "Styles/book.css", "media-type": "text/css"}
    )
    for index, name in enumerate(k for k in files if k.startswith("EPUB/Fonts/")):
        mime = "font/otf" if name.endswith(".otf") else "text/plain"
        ET.SubElement(
            manifest,
            "item",
            {"id": f"font-{index}", "href": name.removeprefix("EPUB/"), "media-type": mime},
        )
    reading_order = ET.SubElement(package, "spine")
    for name, _ in spine:
        ET.SubElement(reading_order, "itemref", {"idref": f"doc-{name}"})
    files["EPUB/package.opf"] = xml(package)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output.parent, suffix=".epub") as temp:
        with zipfile.ZipFile(temp.name, "w") as archive:
            archive.writestr("mimetype", b"application/epub+zip", compress_type=zipfile.ZIP_STORED)
            for name, data in files.items():
                archive.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)
        try:
            os.link(temp.name, output)
        except FileExistsError as error:
            raise ConversionError("output_exists", f"Output already exists: {output}") from error
    return {
        "status": "draft_built" if allow_draft else "built",
        "output": str(output),
        "bytes": output.stat().st_size,
        "source_units": len(units),
        "omitted_units": len(book.get("omissions", [])),
        "validation": "not_run",
    }
