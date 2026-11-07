import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import { chromium, webkit } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const input = process.env.EPUB_READER_FILE || path.join(root, ".work/browser/sample.epub");
const engine = process.env.EPUB_READER_ENGINE || "chromium";
assert.ok(["chromium", "webkit"].includes(engine), "Use the chromium or webkit engine");
const artifacts = path.join(root, ".work/reader-layout", engine, path.basename(input, ".epub"));
await fs.mkdir(artifacts, { recursive: true });
const files = unzipSync(new Uint8Array(await fs.readFile(input)));
const xml = name => new DOMParser().parseFromString(strFromU8(files[name]), "application/xml");
const packagePath = xml("META-INF/container.xml").getElementsByTagName("rootfile")[0].getAttribute("full-path");
const packageDocument = xml(packagePath);
const base = "http://epub-reader.test/";
const resolve = href => new URL(href, base + packagePath).pathname.slice(1);
const manifest = new Map([...packageDocument.getElementsByTagName("item")].map(item => [
  item.getAttribute("id"), { name: resolve(item.getAttribute("href")), type: item.getAttribute("media-type") },
]));
const types = new Map([...manifest.values()].map(item => [item.name, item.type]));
const chapter = [...packageDocument.getElementsByTagName("itemref")]
  .map(item => manifest.get(item.getAttribute("idref")).name)
  .find(name => [...xml(name).getElementsByTagName("section")].some(section => section.getAttribute("class")?.split(/\s+/).includes("prose")));
assert.ok(chapter, "The EPUB must contain a prose chapter");

const browser = engine === "webkit" ? await webkit.launch()
  : await chromium.launch({ executablePath: process.env.EPUB_CHROME_EXECUTABLE });
const page = await browser.newPage();
await page.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (url.origin !== new URL(base).origin) return route.abort();
  const name = decodeURIComponent(url.pathname.slice(1));
  if (name === "reader") return route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head><style>html,body{margin:0;height:100%;background:white}main{box-sizing:border-box;padding:24px;height:100%}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><main><iframe title="EPUB" src="/${chapter}"></iframe></main></body></html>`,
  });
  if (!files[name]) return route.fulfill({ status: 404, body: "Not found" });
  return route.fulfill({ contentType: types.get(name) || "application/octet-stream", body: Buffer.from(files[name]) });
});
try {
  for (const [name, width, height, fontSize] of [
    ["small-phone", 320, 740, 18],
    ["phone", 390, 844, 18],
    ["phone-large-type", 390, 844, 28],
    ["tablet", 768, 1024, 18],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(base + "reader");
    const frame = page.frames().find(frame => frame.url().endsWith(chapter));
    assert.ok(frame, "The EPUB chapter must load");
    await frame.addStyleTag({ content: `html { font-size: ${fontSize}px; }` });
    await frame.evaluate(() => document.fonts.ready);
    const bounds = await frame.evaluate(() => {
      const body = document.body.getBoundingClientRect();
      const prose = document.querySelector(".prose").getBoundingClientRect();
      const pageMargins = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
        .filter(rule => rule.type === CSSRule.PAGE_RULE)
        .map(rule => [rule.style.marginLeft, rule.style.marginRight]);
      return {
        readerWidth: innerWidth,
        bodyWidth: body.width,
        proseWidth: prose.width,
        leftInset: body.left,
        rightInset: innerWidth - body.right,
        scrollWidth: document.documentElement.scrollWidth,
        pageMargins,
        fontsLoaded: [...document.fonts].some(font => font.family === "Source Serif" && font.status === "loaded"),
      };
    });
    console.log(JSON.stringify({ engine, name, ...bounds }));
    await page.screenshot({ path: path.join(artifacts, name + ".png"), animations: "disabled" });
    assert.ok(bounds.leftInset <= 1 && bounds.rightInset <= 1, "The EPUB must not add side margins inside the reader");
    assert.ok(bounds.proseWidth >= bounds.readerWidth - 1, "Prose must use the width assigned by the reader");
    assert.ok(bounds.scrollWidth <= bounds.readerWidth, "Text must not overflow horizontally");
    assert.ok(bounds.pageMargins.flat().every(value => !value || parseFloat(value) === 0), "Publisher page margins must not narrow the reader");
    assert.ok(bounds.fontsLoaded, "The embedded body font must load");
  }
} finally {
  await browser.close();
}
