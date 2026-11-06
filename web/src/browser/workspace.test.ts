import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { fixture } from "./fixtures";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { sha256 } from "./errors";
vi.mock("./extract", () => ({ extract: vi.fn() }));
vi.mock("./validator", () => ({ validateEpub: vi.fn() }));
import { extract } from "./extract";
import { validateEpub } from "./validator";
import { BrowserWorkspace } from "./workspace";

async function library() {
  const f = await fixture();
  vi.mocked(extract).mockResolvedValue({ ...f, pdf: new Blob(["%PDF-1.4\n"]) });
  vi.mocked(validateEpub).mockResolvedValue({
    valid: true,
    exitCode: 0,
    summary: { fatals: 0, errors: 0, warnings: 0, infos: 0 },
    messages: [],
  });
  const dbName = crypto.randomUUID();
  const workspace = new BrowserWorkspace(dbName);
  const detail = await workspace.import(
    new File(["%PDF-1.4\n"], "sample.pdf"),
    "en",
    "",
    () => {},
  );
  return { workspace, detail, dbName };
}
it("刷新和第二个标签页可打开书库；过期保存失败", async () => {
  const { workspace, detail, dbName } = await library();
  const second = new BrowserWorkspace(dbName);
  expect((await second.list()).length).toBe(1);
  const edited = structuredClone(detail.book);
  edited.metadata.title = "Changed";
  const saved = await workspace.save(detail.project.id, 1, edited);
  expect((await second.open(detail.project.id)).book.metadata.title).toBe(
    "Changed",
  );
  expect(saved.book.review.status).toBe("draft");
  await expect(second.save(detail.project.id, 1, detail.book)).rejects.toThrow(
    /标签页/,
  );
});
it("下载绑定具体导出，修改或删除使旧下载失效", async () => {
  const { workspace, detail } = await library();
  const first = await workspace.export(detail.project.id, 1, false);
  const second = await workspace.export(detail.project.id, 1, true);
  await expect(
    workspace.download(detail.project.id, first.export_id),
  ).rejects.toThrow();
  expect(
    (await workspace.download(detail.project.id, second.export_id)).size,
  ).toBeGreaterThan(1000);
  await workspace.save(detail.project.id, 1, detail.book);
  await expect(
    workspace.download(detail.project.id, second.export_id),
  ).rejects.toThrow();
  await workspace.remove(detail.project.id);
  expect(await workspace.list()).toEqual([]);
});
it("校验器失败不允许下载；备份可恢复完整项目", async () => {
  const { workspace, detail } = await library();
  vi.mocked(validateEpub).mockResolvedValue({
    valid: false,
    exitCode: 1,
    summary: { fatals: 0, errors: 1, warnings: 0, infos: 0 },
    messages: [{ id: "RSC-005", severity: "ERROR", message: "Invalid XHTML" }],
  });
  const invalid = await workspace.export(detail.project.id, 1, false);
  expect(invalid.can_download).toBe(false);
  await expect(
    workspace.download(detail.project.id, invalid.export_id),
  ).rejects.toThrow();
  const backup = await workspace.backup(detail.project.id);
  const restored = await workspace.restore(
    new File([backup.blob], backup.filename),
  );
  expect(restored.book).toEqual(detail.book);
  expect(restored.project.id).not.toBe(detail.project.id);
  expect(restored.validation).toBeNull();
});

it("异常作者、页面和警告不会写入书库", async () => {
  const { workspace, detail } = await library();
  const backup = await workspace.backup(detail.project.id);
  for (const field of ["author", "pages", "warnings"]) {
    const files = unzipSync(new Uint8Array(await backup.blob.arrayBuffer()));
    const book = JSON.parse(strFromU8(files["book.json"]));
    if (field === "author") book.metadata.author = { bad: "value" };
    else {
      const source = JSON.parse(strFromU8(files["source.json"]));
      source[field] = [{ bad: "value" }];
      files["source.json"] = strToU8(JSON.stringify(source));
      book.source_sha256 = await sha256(files["source.json"]);
    }
    files["book.json"] = strToU8(JSON.stringify(book));
    await expect(
      workspace.restore(
        new File([zipSync(files).slice().buffer], "invalid.zip"),
      ),
    ).rejects.toThrow(/项目结构/);
    expect((await workspace.list()).length).toBe(1);
  }
});
