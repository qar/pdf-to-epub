import re
from collections import Counter
from pathlib import Path

from .common import ConversionError, digest, read_json

BLOCK_KINDS = {"paragraph", "heading", "source", "verse", "scene-break", "signature", "thought"}
SECTION_KINDS = {
    "chapter",
    "part",
    "preface",
    "dedication",
    "copyright-page",
    "acknowledgments",
    "afterword",
    "appendix",
    "notes",
}


def load_book(plan_path, allow_draft=False):
    book = read_json(plan_path)
    if book.get("version") != 1:
        raise ConversionError("model_version", "Expected book model version 1.")
    source_path = Path(plan_path).parent / book["source"]
    if digest(source_path) != book.get("source_sha256"):
        raise ConversionError(
            "source_changed", "The extraction evidence changed after the plan was created."
        )
    source = read_json(source_path)
    raw_units = source.get("units", [])
    units = {unit["id"]: unit for unit in raw_units}
    if not units or len(units) != len(raw_units):
        raise ConversionError("invalid_source", "Source IDs must be unique and contain text.")
    for unit in raw_units:
        if not unit.get("text") or "".join(run["text"] for run in unit["runs"]) != unit["text"]:
            raise ConversionError(
                "invalid_source",
                "Styled runs must exactly match their source text.",
                source=unit["id"],
            )
        if any(set(run.get("styles", [])) - {"bold", "italic"} for run in unit["runs"]):
            raise ConversionError(
                "invalid_source", "Unsupported source text style.", source=unit["id"]
            )
    metadata = book["metadata"]
    if not isinstance(metadata.get("title"), str) or not metadata["title"].strip():
        raise ConversionError("metadata", "A title is required.")
    if not re.fullmatch(r"[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*", metadata.get("language", "")):
        raise ConversionError("metadata", "Provide a BCP 47 language tag, such as en or zh-Hans.")
    seen = Counter()
    ids = {"title", "contents"}

    def block_sources(block):
        if "text" in block or "html" in block:
            raise ConversionError(
                "untracked_text", "Blocks reference source IDs; replacement text is not accepted."
            )
        if block.get("kind") == "quote":
            if "sources" in block or not block.get("blocks"):
                raise ConversionError(
                    "invalid_block", "A quote contains child blocks, not direct sources."
                )
            for child in block["blocks"]:
                block_sources(child)
            return
        if block.get("kind") not in BLOCK_KINDS or not block.get("sources"):
            raise ConversionError(
                "invalid_block", "Every text block needs a supported kind and source IDs."
            )
        seen.update(block["sources"])
        for key, value in block.get("joins", {}).items():
            if key not in block["sources"][:-1] or value not in {"auto", "space", "none", "line"}:
                raise ConversionError(
                    "invalid_join", "A join must identify a non-final source and a supported mode."
                )

    if not book.get("sections"):
        raise ConversionError("empty_book", "At least one text section is required.")
    for section in book["sections"]:
        name = section["id"]
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", name) or name in ids:
            raise ConversionError("section_id", "Section IDs must be unique, safe filenames.")
        ids.add(name)
        if (
            section.get("kind", "chapter") not in SECTION_KINDS
            or not (section.get("blocks") or section.get("title_sources"))
            or not section.get("title", "").strip()
        ):
            raise ConversionError(
                "invalid_section", "Sections require a title, supported kind and text blocks."
            )
        if "title_sources" in section:
            block_sources({"kind": "heading", "sources": section["title_sources"]})
        for block in section.get("blocks", []):
            block_sources(block)
    included = sum(seen.values())
    for omitted in book.get("omissions", []):
        if not omitted.get("reason", "").strip():
            raise ConversionError("omission_reason", "Every excluded source needs a reason.")
        seen.update([omitted["source"]])
    missing = sorted(set(units) - seen.keys())
    unknown = sorted(seen.keys() - set(units))
    repeated = sorted(key for key, value in seen.items() if value != 1)
    if missing or unknown or repeated:
        raise ConversionError(
            "source_coverage",
            "Every source must occur exactly once, either included or explicitly excluded.",
            missing=missing,
            unknown=unknown,
            repeated=repeated,
        )
    if not included:
        raise ConversionError("empty_book", "The book must contain source text.")
    review = book.get("review", {})
    if not allow_draft:
        if review.get("status") != "reviewed":
            raise ConversionError(
                "review_required",
                "Review the structure and mark review.status as reviewed, or use --allow-draft for a preview.",
            )
        unresolved = [
            w["id"]
            for w in source.get("warnings", [])
            if w["id"] not in review.get("resolved_warnings", [])
        ]
        if unresolved:
            raise ConversionError(
                "review_required",
                "Resolve extraction warnings before producing a reviewed book.",
                unresolved=unresolved,
            )
    return book, source, units
