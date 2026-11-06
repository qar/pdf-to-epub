import { DOMImplementation, DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Document, Element } from "@xmldom/xmldom";
import { strToU8, strFromU8, zipSync, unzipSync } from "fflate";
import type { Block, Book, Evidence, Unit } from "../types";
import { validateBook } from "./model";
import baseCss from "../../../skills/pdf-to-epub/scripts/pdf_epub/assets/book.css?raw";
import regular from "../../../skills/pdf-to-epub/scripts/pdf_epub/assets/fonts/SourceSerif4-Regular.otf?inline";
import italic from "../../../skills/pdf-to-epub/scripts/pdf_epub/assets/fonts/SourceSerif4-It.otf?inline";
import semibold from "../../../skills/pdf-to-epub/scripts/pdf_epub/assets/fonts/SourceSerif4-Semibold.otf?inline";
import license from "../../../skills/pdf-to-epub/scripts/pdf_epub/assets/fonts/OFL.txt?raw";

const XHTML = "http://www.w3.org/1999/xhtml";
const EPUB = "http://www.idpf.org/2007/ops";
const OPF = "http://www.idpf.org/2007/opf";
const DC = "http://purl.org/dc/elements/1.1/";
const XML = "http://www.w3.org/XML/1998/namespace";
const fonts: Record<string, string> = {
  "SourceSerif4-Regular.otf": regular,
  "SourceSerif4-It.otf": italic,
  "SourceSerif4-Semibold.otf": semibold,
};
const serializer = new XMLSerializer();

function root(name: string, namespace: string): Document {
  return new DOMImplementation().createDocument(namespace, name, null);
}
function add(
  parent: Element,
  tag: string,
  attrs: Record<string, string> = {},
  text?: string,
): Element {
  const document = parent.ownerDocument!;
  const element = document.createElementNS(
    tag.startsWith("dc:") ? DC : parent.namespaceURI,
    tag,
  );
  for (const [name, value] of Object.entries(attrs)) {
    if (name.startsWith("epub:")) element.setAttributeNS(EPUB, name, value);
    else if (name.startsWith("xml:")) element.setAttributeNS(XML, name, value);
    else element.setAttribute(name, value);
  }
  if (text !== undefined) element.appendChild(document.createTextNode(text));
  parent.appendChild(element);
  return element;
}
function text(parent: Element, value: string) {
  parent.appendChild(parent.ownerDocument!.createTextNode(value));
}
function xml(document: Document) {
  return strToU8(
    '<?xml version="1.0" encoding="utf-8"?>\n' +
      serializer.serializeToString(document),
  );
}
function xhtml(title: string, language: string) {
  const document = root("html", XHTML);
  const html = document.documentElement!;
  html.setAttribute("lang", language);
  html.setAttributeNS(XML, "xml:lang", language);
  const head = add(html, "head");
  add(head, "meta", { charset: "utf-8" });
  add(head, "title", {}, title);
  add(head, "link", {
    rel: "stylesheet",
    type: "text/css",
    href: "../Styles/book.css",
  });
  return { document, body: add(html, "body") };
}
const wide = (char: string) =>
  /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]/u.test(
    char,
  );

function render(
  parent: Element,
  block: Block,
  units: Map<string, Unit>,
  heading = "h2",
) {
  if (block.kind === "quote") {
    const quote = add(parent, "blockquote");
    block.blocks!.forEach((child) => render(quote, child, units));
    return;
  }
  const classes: Record<string, string> = {
    source: "source",
    verse: "verse",
    "scene-break": "divider",
    signature: "signature",
    thought: "thought",
  };
  const element = add(
    parent,
    block.kind === "heading" ? heading : "p",
    classes[block.kind] ? { class: classes[block.kind] } : {},
  );
  let previous: Unit | undefined;
  for (const id of block.sources!) {
    const unit = units.get(id)!;
    if (previous) {
      const mode = block.joins?.[previous.id] || "auto";
      const a = Array.from(previous.text.trimEnd()).at(-1) || "",
        b = Array.from(unit.text.trimStart())[0] || "";
      if (mode === "line" || block.kind === "verse") add(element, "br");
      else if (
        mode === "space" ||
        (mode === "auto" &&
          !(wide(a) && wide(b)) &&
          !(a === "-" && /\p{L}/u.test(b)))
      )
        text(element, " ");
    }
    for (const run of unit.runs) {
      let target = element;
      if (run.styles.includes("bold")) target = add(target, "strong");
      if (run.styles.includes("italic")) target = add(target, "em");
      text(target, run.text);
    }
    previous = unit;
  }
}

export function buildEpub(
  book: Book,
  source: Evidence,
  sourceHash: string,
  draft = false,
): Uint8Array {
  const units = validateBook(book, source, sourceHash, draft);
  const files: Record<string, Uint8Array> = {};
  const spine: { id: string; href: string }[] = [];
  const put = (id: string, document: Document) => {
    files[`EPUB/Text/${id}.xhtml`] = xml(document);
    spine.push({ id, href: `Text/${id}.xhtml` });
  };
  const { metadata } = book;
  const title = xhtml(metadata.title, metadata.language);
  const titlePage = add(title.body, "section", {
    class: "title-page",
    "epub:type": "titlepage",
  });
  add(titlePage, "p", { class: "author" }, metadata.author);
  add(titlePage, "h1", {}, metadata.title);
  add(titlePage, "hr", { class: "short-rule" });
  put("title", title.document);
  const contentsLabel = metadata.language.startsWith("zh")
    ? "目录"
    : "Contents";
  const contents = xhtml(contentsLabel, metadata.language);
  const nav = add(contents.body, "nav", {
    "epub:type": "toc",
    id: "toc",
    class: "contents",
  });
  add(nav, "h1", {}, contentsLabel);
  const links = add(nav, "ol");
  for (const section of book.sections)
    add(add(links, "li"), "a", { href: `${section.id}.xhtml` }, section.title);
  put("contents", contents.document);
  for (const section of book.sections) {
    const chapter = xhtml(section.title, metadata.language);
    const prose = add(chapter.body, "section", {
      class: "prose",
      "epub:type": section.kind,
    });
    const header = add(prose, "header", {
      class: section.kind === "part" ? "part-page" : "section-heading",
    });
    if (section.title_sources)
      render(
        header,
        {
          kind: "heading",
          sources: section.title_sources,
          joins: section.title_joins,
        },
        units,
        "h1",
      );
    else add(header, "h1", {}, section.title);
    add(header, "hr", { class: "short-rule" });
    section.blocks.forEach((block) => render(prose, block, units));
    put(section.id, chapter.document);
  }
  let css = baseCss;
  if (book.appearance) {
    const a = book.appearance;
    css += `\nbody { font-size: ${a.font_size.toFixed(2)}em; line-height: ${a.line_height.toFixed(2)}; ${a.template === "modern" ? "font-family: system-ui, sans-serif;" : ""} }\np { text-indent: ${a.indent.toFixed(2)}em; }\n`;
  }
  files["EPUB/Styles/book.css"] = strToU8(css);
  for (const [name, url] of Object.entries(fonts))
    files[`EPUB/Fonts/${name}`] = Uint8Array.from(
      atob(url.split(",")[1]),
      (char) => char.charCodeAt(0),
    );
  files["EPUB/Fonts/OFL.txt"] = strToU8(license);
  const container = root(
    "container",
    "urn:oasis:names:tc:opendocument:xmlns:container",
  );
  container.documentElement!.setAttribute("version", "1.0");
  add(add(container.documentElement!, "rootfiles"), "rootfile", {
    "full-path": "EPUB/package.opf",
    "media-type": "application/oebps-package+xml",
  });
  files["META-INF/container.xml"] = xml(container);
  const packageDoc = root("package", OPF),
    pack = packageDoc.documentElement!;
  for (const [key, value] of Object.entries({
    version: "3.0",
    "unique-identifier": "book-id",
    prefix: "rendition: http://www.idpf.org/vocab/rendition/#",
  }))
    pack.setAttribute(key, value);
  const meta = add(pack, "metadata");
  add(
    meta,
    "dc:identifier",
    { id: "book-id" },
    `urn:uuid:${crypto.randomUUID()}`,
  );
  add(meta, "dc:title", {}, metadata.title);
  add(meta, "dc:language", {}, metadata.language);
  if (metadata.author) add(meta, "dc:creator", {}, metadata.author);
  add(
    meta,
    "meta",
    { property: "dcterms:modified" },
    new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  );
  add(meta, "meta", { property: "rendition:layout" }, "reflowable");
  const manifest = add(pack, "manifest");
  for (const item of spine)
    add(manifest, "item", {
      id: `doc-${item.id}`,
      href: item.href,
      "media-type": "application/xhtml+xml",
      ...(item.id === "contents" ? { properties: "nav" } : {}),
    });
  add(manifest, "item", {
    id: "css",
    href: "Styles/book.css",
    "media-type": "text/css",
  });
  Object.keys(files)
    .filter((path) => path.startsWith("EPUB/Fonts/"))
    .forEach((path, i) =>
      add(manifest, "item", {
        id: `font-${i}`,
        href: path.slice(5),
        "media-type": path.endsWith(".otf") ? "font/otf" : "text/plain",
      }),
    );
  const order = add(pack, "spine");
  spine.forEach((item) => add(order, "itemref", { idref: `doc-${item.id}` }));
  files["EPUB/package.opf"] = xml(packageDoc);
  return zipSync(
    { mimetype: [strToU8("application/epub+zip"), { level: 0 }], ...files },
    { level: 6 },
  );
}

export function previewEpub(bytes: Uint8Array, section: string): string {
  const files = unzipSync(bytes);
  const file = files[`EPUB/Text/${section}.xhtml`];
  if (!file) throw new Error("章节不存在。");
  const doc = new DOMParser().parseFromString(strFromU8(file), "text/html");
  const head = doc.getElementsByTagName("head")[0];
  for (const link of Array.from(doc.getElementsByTagName("link")))
    link.parentNode!.removeChild(link);
  let css = strFromU8(files["EPUB/Styles/book.css"]);
  for (const [name, data] of Object.entries(fonts))
    css = css.replaceAll(`../Fonts/${name}`, data);
  add(head, "style", {}, css);
  add(head, "meta", {
    "http-equiv": "Content-Security-Policy",
    content:
      "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:",
  });
  return serializer.serializeToString(doc);
}
