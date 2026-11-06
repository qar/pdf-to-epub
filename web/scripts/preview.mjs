import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const artifacts = path.join(root, ".work/browser-preview");
await fs.mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.EPUB_CHROME_EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(30000);
try {
  await page.goto(process.env.EPUB_APP_URL || "http://127.0.0.1:5178");
  await page.getByRole("heading", { name: "书库", exact: true }).waitFor();
  await page.getByLabel("选择 PDF 文件").setInputFiles(process.env.EPUB_PREVIEW_PDF || path.join(root, "web/public/sample.pdf"));
  await page.getByRole("button", { name: "提取文字", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("tab", { name: "排版", exact: true }).click();
  const preview = page.getByRole("region", { name: "EPUB 排版预览" });
  await preview.locator(".prose").waitFor();
  await page.evaluate(() => document.fonts.ready);
  const chapter = await page.getByLabel("预览章节").inputValue();
  const check = async name => {
    const surface = page.locator(".preview-surface");
    await surface.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bounds = await preview.evaluate(host => {
      const paper = host.getBoundingClientRect();
      const body = host.shadowRoot.querySelector("body");
      const content = [...body.querySelectorAll("p, h1, h2, hr")].map(element => element.getBoundingClientRect());
      const surface = host.parentElement.getBoundingClientRect();
      const last = content.at(-1);
      return {
        paperHeight: paper.height,
        contentHeight: body.getBoundingClientRect().height,
        overflowBottom: Math.max(...content.map(rect => rect.bottom)) - paper.bottom,
        overflowLeft: paper.left - Math.min(...content.map(rect => rect.left)),
        overflowRight: Math.max(...content.map(rect => rect.right)) - paper.right,
        lastVisible: last.bottom <= surface.bottom + 1 && last.top >= surface.top - 1,
        fillsViewport: paper.height >= host.parentElement.clientHeight - parseFloat(getComputedStyle(host.parentElement).paddingTop) - 1,
      };
    });
    console.log(JSON.stringify({ name, ...bounds }));
    await page.screenshot({ path: path.join(artifacts, name + ".png"), animations: "disabled" });
    assert.ok(bounds.overflowBottom <= 1, `正文超出白色书页 ${bounds.overflowBottom}px`);
    assert.ok(bounds.overflowLeft <= 1 && bounds.overflowRight <= 1, "正文超出书页宽度");
    assert.ok(bounds.lastVisible, "末段必须可以滚动到可视区域");
    assert.ok(bounds.fillsViewport, "短章节的白色书页应填满预览区域");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "页面横向溢出");
  };
  for (const [name, width, height] of [["desktop", 1440, 1000], ["tablet", 834, 1112], ["mobile", 390, 844]]) {
    await page.setViewportSize({ width, height });
    if (width < 900) {
      if (await page.getByRole("button", { name: "收起属性" }).isVisible()) await page.getByRole("button", { name: "收起属性" }).click();
      if (await page.getByRole("button", { name: "收起目录" }).isVisible()) await page.getByRole("button", { name: "收起目录" }).click();
    }
    await page.getByLabel("预览章节").selectOption(chapter);
    await preview.locator(".prose").waitFor();
    await check("long-" + name);
    await page.getByLabel("预览章节").selectOption("title");
    await preview.locator(".title-page").waitFor();
    await check("short-" + name);
  }
} finally {
  await browser.close();
}
