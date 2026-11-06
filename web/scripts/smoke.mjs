import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const artifacts = path.join(root, ".work/browser");
await fs.mkdir(artifacts, { recursive: true });
const origin = process.env.EPUB_APP_URL || "http://127.0.0.1:48291";
const browser = await chromium.launch({
  executablePath: process.env.EPUB_CHROME_EXECUTABLE,
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [], remoteBodies = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => {
  if (request.postData() && !["localhost", "127.0.0.1"].includes(new URL(request.url()).hostname)) remoteBodies.push(request.url());
});
page.on("dialog", dialog => dialog.accept());
const screenshot = name => page.screenshot({ path: path.join(artifacts, name + ".png"), fullPage: true });
const canvasReady = () => page.waitForFunction(() => {
  const c = document.querySelector(".pdf-canvas canvas");
  if (!c || c.width < 100) return false;
  const pixels = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let ink = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && pixels[i] < 180) ink++;
  return ink > 500;
});
try {
  await page.goto(origin);
  await page.getByRole("heading", { name: "书库", exact: true }).waitFor();
  if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) {
    await page.getByRole("button", { name: "本机未连接" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "连接本机" }).click();
    await page.getByRole("link", { name: "连接本机编辑器" }).click();
  }
  await page.getByRole("button", { name: "本机已连接" }).waitFor();
  assert.equal(new URL(page.url()).hash, "");
  await screenshot("library-desktop");
  await page.getByLabel("选择 PDF 文件").setInputFiles(path.join(root, "web/public/sample.pdf"));
  await page.getByRole("button", { name: "提取文字", exact: true }).click();
  await page.getByRole("button", { name: "导出 EPUB", exact: true }).waitFor();
  await page.getByLabel("书名", { exact: true }).fill("The Art of Noticing");
  await page.getByLabel("作者", { exact: true }).fill("Studio Edition");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("已保存到本机", { exact: true }).waitFor();
  await page.locator(".block-row").first().click();
  await page.getByRole("button", { name: "设为章节标题" }).click();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await screenshot("structure-desktop");
  await page.getByRole("tab", { name: "排版", exact: true }).click();
  const preview = page.frameLocator('iframe[title="EPUB 排版预览"]');
  await preview.locator(".prose").waitFor();
  assert.match(await preview.locator("body").innerText(), /A quiet morning/);
  await screenshot("preview-desktop");
  await page.getByRole("tab", { name: "原稿", exact: true }).click();
  await canvasReady();
  await screenshot("original-desktop");
  await page.getByRole("button", { name: "复核", exact: true }).click();
  for (const input of await page.locator(".warning-item textarea").all()) await input.fill("已与自建示例 PDF 逐段比对，文字和阅读顺序完整。");
  await page.getByLabel("已核对正文、章节和阅读顺序").check();
  await page.getByRole("button", { name: "完成复核", exact: true }).click();
  await page.getByText("复核已完成", { exact: true }).waitFor();
  await page.getByRole("button", { name: "导出 EPUB", exact: true }).click();
  await page.getByRole("button", { name: "制作并校验", exact: true }).click();
  await page.getByText("EPUBCheck 校验通过", { exact: true }).waitFor({ timeout: 60000 });
  await screenshot("validated-export");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 EPUB", exact: true }).click();
  await (await downloaded).saveAs(path.join(artifacts, "sample.epub"));
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("tab", { name: "结构", exact: true }).click();
  for (const [name, width, height] of [["tablet", 834, 1112], ["mobile", 390, 844]]) {
    await page.setViewportSize({ width, height });
    if (await page.getByRole("button", { name: "收起属性" }).isVisible()) await page.getByRole("button", { name: "收起属性" }).click();
    if (await page.getByRole("button", { name: "收起目录" }).isVisible()) await page.getByRole("button", { name: "收起目录" }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await screenshot("structure-" + name);
    await page.getByRole("button", { name: "切换属性" }).click();
    await screenshot("inspector-" + name);
    await page.getByRole("button", { name: "收起属性" }).click();
    await page.getByRole("tab", { name: "原稿", exact: true }).click();
    await canvasReady();
    await screenshot("original-" + name);
    await page.getByRole("tab", { name: "结构", exact: true }).click();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const encrypted = path.join(artifacts, "encrypted.pdf");
  execFileSync("qpdf", ["--encrypt", "preview-test", "owner-test", "256", "--", path.join(root, "web/public/sample.pdf"), encrypted]);
  await page.getByLabel("选择 PDF 文件").setInputFiles(encrypted);
  await page.getByLabel("打开密码", { exact: false }).fill("preview-test");
  await page.getByRole("button", { name: "提取文字", exact: true }).click();
  await page.getByRole("button", { name: "导出 EPUB", exact: true }).waitFor();
  await page.getByRole("tab", { name: "原稿", exact: true }).click();
  await page.getByLabel("原稿打开密码").fill("wrong-password");
  await page.getByRole("button", { name: "解锁原稿" }).click();
  await page.getByText("密码不正确。", { exact: true }).waitFor();
  await page.getByLabel("原稿打开密码").fill("preview-test");
  await page.getByRole("button", { name: "解锁原稿" }).click();
  await canvasReady();
  await screenshot("encrypted-original");
  const warningFile = path.join(artifacts, "review-fixture.pdf");
  execFileSync("python3", ["-c", "import sys; sys.path.insert(0, sys.argv[1]); from pdf_fixture import make_pdf; make_pdf(sys.argv[2], scanned_body=True)", path.join(root, "tests"), warningFile]);
  await page.getByLabel("选择 PDF 文件").setInputFiles(warningFile);
  await page.getByRole("button", { name: "提取文字", exact: true }).click();
  await page.getByRole("button", { name: "导出 EPUB", exact: true }).waitFor();
  if (!(await page.getByRole("button", { name: "收起属性" }).isVisible())) await page.getByRole("button", { name: "切换属性" }).click();
  await page.locator(".inspector-tabs button").filter({ hasText: "复核" }).click();
  const note = "已核对第一页图像，第二页待检查。";
  await page.locator(".warning-item textarea").first().fill(note);
  assert.equal(await page.getByRole("button", { name: "保存", exact: true }).isEnabled(), true);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("已保存到本机", { exact: true }).waitFor();
  await page.getByTitle("返回书库").click();
  await page.locator(".project-row").first().click();
  await page.locator(".inspector-tabs button").filter({ hasText: "复核" }).click();
  assert.equal(await page.locator(".warning-item textarea").first().inputValue(), note);
  assert.equal(await page.getByRole("button", { name: "完成复核", exact: true }).isEnabled(), false);
  assert.deepEqual(remoteBodies, [], "Book content must stay on loopback");
  assert.deepEqual(errors, [], "Browser runtime errors");
  console.log(JSON.stringify({ origin, text_epub: true, epubcheck: "valid", remote_uploads: remoteBodies.length, screenshots: artifacts }));
} catch (error) {
  await screenshot("failure");
  throw error;
} finally {
  await browser.close();
}
