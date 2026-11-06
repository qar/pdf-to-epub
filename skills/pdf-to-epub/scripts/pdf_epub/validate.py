import json
import os
import posixpath
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

NS = {
    "c": "urn:oasis:names:tc:opendocument:xmlns:container",
    "o": "http://www.idpf.org/2007/opf",
    "h": "http://www.w3.org/1999/xhtml",
    "dc": "http://purl.org/dc/elements/1.1/",
}


def resolved_path(base, href):
    parsed = urlsplit(href)
    if parsed.scheme or parsed.netloc:
        return None, parsed.fragment
    path = (
        posixpath.normpath(posixpath.join(posixpath.dirname(base), unquote(parsed.path)))
        if parsed.path
        else base
    )
    if path.startswith(("/", "../")) or path == "..":
        raise ValueError(f"Package path escapes the EPUB: {href}")
    return path, unquote(parsed.fragment)


def internal_check(path):
    errors, text_count, image_count = [], 0, 0
    try:
        with zipfile.ZipFile(path) as archive:
            info = archive.infolist()
            names = archive.namelist()
            if len(set(names)) != len(names):
                errors.append("The ZIP contains duplicate entry names.")
            if (
                not info
                or info[0].filename != "mimetype"
                or info[0].compress_type != zipfile.ZIP_STORED
                or archive.read("mimetype") != b"application/epub+zip"
            ):
                errors.append("The first ZIP entry must be an uncompressed EPUB mimetype.")
            if any(n.startswith("/") or ".." in PurePosixPath(n).parts or "\\" in n for n in names):
                errors.append("The ZIP contains unsafe entry paths.")
            bad = archive.testzip()
            if bad:
                errors.append(f"ZIP checksum failed: {bad}")
            container = ET.fromstring(archive.read("META-INF/container.xml"))
            roots = container.findall(".//c:rootfile", NS)
            if not roots:
                raise ValueError("The container has no package rootfile.")
            package_path = roots[0].get("full-path")
            package = ET.fromstring(archive.read(package_path))
            for name in ("title", "language", "identifier"):
                node = package.find(f"o:metadata/dc:{name}", NS)
                if node is None or not "".join(node.itertext()).strip():
                    errors.append(f"Missing metadata: {name}")
            if package.find('o:metadata/o:meta[@property="dcterms:modified"]', NS) is None:
                errors.append("Missing EPUB 3 modified timestamp.")
            manifest, documents = {}, {}
            navigation = False
            for item in package.findall("o:manifest/o:item", NS):
                item_id = item.get("id")
                if not item_id or item_id in manifest:
                    errors.append(f"Manifest item ID is empty or repeated: {item_id}")
                resource, _ = resolved_path(package_path, item.get("href", ""))
                manifest[item_id] = (resource, item.get("media-type"))
                if resource not in names:
                    errors.append(
                        f"Missing local manifest resource: {resource or item.get('href')}"
                    )
                    continue
                if item.get("media-type") == "application/xhtml+xml":
                    document = ET.fromstring(archive.read(resource))
                    documents[resource] = document
                    image_count += len(document.findall(".//h:img", NS))
                    if "nav" in item.get("properties", "").split():
                        navigation = document.find(".//h:nav", NS) is not None
                    else:
                        body = document.find("h:body", NS)
                        if body is not None:
                            text_count += len("".join(body.itertext()).strip())
            if not navigation:
                errors.append("Missing EPUB navigation document.")
            spine = package.findall("o:spine/o:itemref", NS)
            if not spine:
                errors.append("The reading order is empty.")
            for item in spine:
                entry = manifest.get(item.get("idref"))
                if not entry or entry[1] != "application/xhtml+xml":
                    errors.append(f"Invalid spine reference: {item.get('idref')}")
            anchors = {}
            for name, document in documents.items():
                ids = [node.get("id") for node in document.iter() if node.get("id")]
                if len(ids) != len(set(ids)):
                    errors.append(f"Duplicate anchors: {name}")
                anchors[name] = set(ids)
            for name, document in documents.items():
                for node in document.iter():
                    href = node.get("href") or node.get("src")
                    if not href:
                        continue
                    target, fragment = resolved_path(name, href)
                    if target is None:
                        continue
                    if target not in names:
                        errors.append(f"Broken local link in {name}: {href}")
                    elif fragment and fragment not in anchors.get(target, set()):
                        errors.append(f"Broken anchor in {name}: {href}")
            if not text_count:
                errors.append("No readable text was found.")
    except (OSError, ValueError, KeyError, TypeError, ET.ParseError, zipfile.BadZipFile) as error:
        errors.append(str(error))
    return {
        "status": "passed" if not errors else "failed",
        "errors": errors,
        "text_characters": text_count,
        "images": image_count,
    }


def epubcheck_command(jar=None):
    jar = jar or os.environ.get("EPUBCHECK_JAR")
    if jar:
        return (
            [shutil.which("java"), "-jar", str(Path(jar).resolve())]
            if shutil.which("java") and Path(jar).is_file()
            else None
        )
    executable = shutil.which("epubcheck")
    return [executable] if executable else None


def validate_epub(path, jar=None, internal_only=False):
    path = Path(path).resolve()
    internal = internal_check(path)
    result = {"status": "invalid", "internal": internal, "epubcheck": {"status": "not_run"}}
    if internal["errors"]:
        return result
    if internal_only:
        result["status"] = "internal_passed"
        return result
    command = epubcheck_command(jar)
    if not command:
        result.update(
            status="unchecked",
            epubcheck={
                "status": "not_run",
                "reason": "Install EPUBCheck, or supply --epubcheck-jar /path/to/epubcheck.jar and Java.",
            },
        )
        return result
    with tempfile.TemporaryDirectory(prefix="epubcheck-") as temp:
        report = Path(temp) / "report.json"
        completed = subprocess.run(
            command + [str(path), "--failonwarnings", "--json", str(report)],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
        )
        data = json.loads(report.read_text()) if report.exists() else {}
    messages = data.get("messages", [])
    result["epubcheck"] = {
        "status": "passed" if completed.returncode == 0 and data else "failed",
        "exit_code": completed.returncode,
        "messages": messages,
    }
    if not data:
        result["epubcheck"]["reason"] = (completed.stderr or completed.stdout).strip()
    result["status"] = "valid" if result["epubcheck"]["status"] == "passed" else "invalid"
    return result


def doctor(jar=None):
    tools = {
        name: shutil.which(name) for name in ("pdftohtml", "pdftotext", "pdfinfo", "qpdf", "java")
    }
    validation = bool(epubcheck_command(jar))
    return {
        "status": "ready"
        if tools["pdftohtml"] and tools["pdftotext"] and validation
        else "incomplete",
        "tools": tools,
        "epubcheck_available": validation,
        "runtime": "Python standard library",
    }
