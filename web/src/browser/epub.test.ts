import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import { fixture } from "./fixtures";
import { buildEpub, previewEpub } from "./epub";
import { validateBook } from "./model";

const temporary: string[] = [];
afterEach(() => {
  temporary
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true }));
});
describe("浏览器文字 EPUB", () => {
  it.each([null, "classic", "modern", "compact"] as const)(
    "与 Python 核心保留相同正文、字形、CSS 与标题连接（%s）",
    async (template) => {
      const f = await fixture();
      if (template) {
        f.book.appearance = {
          template,
          font_size: 1.2,
          line_height: 1.6,
          indent: 1.25,
        };
      }
      const output = buildEpub(f.book, f.source, f.sourceHash);
      const files = unzipSync(output);
      expect(strFromU8(files.mimetype)).toBe("application/epub+zip");
      expect(
        Object.keys(files).some((key) => /\.(png|jpeg|jpg)$/.test(key)),
      ).toBe(false);
      const doc = new DOMParser().parseFromString(
        strFromU8(files["EPUB/Text/chapter.xhtml"]),
        "application/xhtml+xml",
      );
      expect(doc.getElementsByTagName("h1")[0].textContent).toBe("bookstore");
      expect(doc.getElementsByTagName("em")[0].textContent).toBe(
        "A quiet morning.",
      );
      expect(doc.getElementsByTagName("p")[2].textContent).toBe(
        "第一句。第二句。",
      );
      const path = mkdtempSync(join(tmpdir(), "browser-epub-parity-"));
      temporary.push(path);
      writeFileSync(join(path, "source.json"), f.sourceJson);
      writeFileSync(join(path, "book.json"), JSON.stringify(f.book));
      const cli = fileURLToPath(
        new URL("../../../skills/pdf-to-epub/scripts/epub.py", import.meta.url),
      );
      execFileSync("python3", [
        cli,
        "build",
        join(path, "book.json"),
        "--output",
        join(path, "python.epub"),
      ]);
      const python = unzipSync(readFileSync(join(path, "python.epub")));
      const original = new DOMParser().parseFromString(
        strFromU8(python["EPUB/Text/chapter.xhtml"]),
        "application/xhtml+xml",
      );
      expect(doc.getElementsByTagName("body")[0].textContent).toBe(
        original.getElementsByTagName("body")[0].textContent,
      );
      expect(strFromU8(files["EPUB/Styles/book.css"])).toBe(
        strFromU8(python["EPUB/Styles/book.css"]),
      );
      expect(previewEpub(output, "chapter")).toContain("data:");
      expect(previewEpub(output, "chapter")).toContain(".prose >");
      expect(previewEpub(output, "chapter")).not.toContain(".prose &gt;");
    },
  );
  it("拒绝遗漏、重复、无理由排除和替换证据", async () => {
    for (const mode of ["missing", "duplicate", "omission", "source"]) {
      const f = await fixture();
      if (mode === "missing") f.book.sections[0].blocks.pop();
      if (mode === "duplicate")
        f.book.sections[0].blocks.push({ kind: "paragraph", sources: ["u2"] });
      if (mode === "omission") {
        f.book.sections[0].blocks.pop();
        f.book.omissions.push(
          { source: "u4", reason: "" },
          { source: "u5", reason: "" },
        );
      }
      if (mode === "source") f.book.source_sha256 = "changed";
      expect(() => validateBook(f.book, f.source, f.sourceHash)).toThrow();
    }
  });
  it("未复核和扫描页警告不能进入正式导出", async () => {
    const f = await fixture();
    f.book.review.status = "draft";
    expect(() => buildEpub(f.book, f.source, f.sourceHash)).toThrow();
    expect(() => buildEpub(f.book, f.source, f.sourceHash, true)).not.toThrow();
    f.book.review.status = "reviewed";
    f.source.warnings.push({
      id: "image-1",
      code: "page_images",
      page: 1,
      message: "Check image",
    });
    expect(() => buildEpub(f.book, f.source, f.sourceHash)).toThrow();
  });
  it("拒绝非法版式和路径，保留明确的 CJK 行连接", async () => {
    const f = await fixture();
    f.book.appearance = {
      template: "modern",
      font_size: 1.1,
      line_height: 1.7,
      indent: 0,
    };
    expect(
      strFromU8(
        unzipSync(buildEpub(f.book, f.source, f.sourceHash))[
          "EPUB/Styles/book.css"
        ],
      ),
    ).toContain("font-size: 1.10em");
    f.book.appearance.line_height = NaN;
    expect(() => buildEpub(f.book, f.source, f.sourceHash)).toThrow();
    delete f.book.appearance;
    f.book.sections[0].id = "../escape";
    expect(() => buildEpub(f.book, f.source, f.sourceHash)).toThrow();
  });
});
