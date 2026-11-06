import { openDB } from "idb";
import type { DBSchema } from "idb";
import { strFromU8, strToU8, zipSync, unzipSync } from "fflate";
import type { Book, Detail, Evidence, ExportResult, Project } from "../types";
import { extract } from "./extract";
import { buildEpub, previewEpub } from "./epub";
import { validateBook } from "./model";
import { sha256, WorkspaceError } from "./errors";
import { validateEpub } from "./validator";

interface StoredProject {
  id: string;
  filename: string;
  updatedAt: string;
  revision: number;
  book: Book;
  sourceJson: string;
  sourceHash: string;
  pdf: Blob;
  exported?: { result: ExportResult; data: Blob };
}
interface Library extends DBSchema {
  projects: { key: string; value: StoredProject };
}

function summary(item: StoredProject): Project {
  const source: Evidence = JSON.parse(item.sourceJson);
  return {
    id: item.id,
    title: item.book.metadata.title,
    author: item.book.metadata.author,
    filename: item.filename,
    pages: source.pages.length,
    units: source.units.length,
    sections: item.book.sections.length,
    review_status: item.book.review.status,
    updated_at: item.updatedAt,
  };
}
function detail(item: StoredProject): Detail {
  return {
    project: summary(item),
    book: structuredClone(item.book),
    source: JSON.parse(item.sourceJson),
    revision: item.revision,
    validation: item.exported?.result || null,
  };
}
function revision(
  item: StoredProject | undefined,
  expected?: number,
): asserts item is StoredProject {
  if (!item)
    throw new WorkspaceError("not_found", "这本书已不存在，请刷新书库。");
  if (
    expected !== undefined &&
    (!Number.isInteger(expected) || expected < 1 || item.revision !== expected)
  )
    throw new WorkspaceError(
      "conflict",
      "其他标签页已修改此书，请重新打开后再保存。",
    );
}
export function filename(title: string, suffix: string) {
  return title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 100) + suffix;
}

export class BrowserWorkspace {
  private database;
  constructor(name = "pdf-to-epub-library") {
    this.database = openDB<Library>(name, 1, {
      upgrade(db) {
        db.createObjectStore("projects", { keyPath: "id" });
      },
    });
  }
  async list() {
    return (await (await this.database).getAll("projects"))
      .map(summary)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  private async read(id: string, expected?: number) {
    const item = await (await this.database).get("projects", id);
    revision(item, expected);
    if ((await sha256(item.sourceJson)) !== item.sourceHash)
      throw new WorkspaceError(
        "source_changed",
        "原始提取证据已变化，请恢复项目备份。",
      );
    return item;
  }
  async open(id: string) {
    return detail(await this.read(id));
  }
  async pdf(id: string) {
    return new Uint8Array(await (await this.read(id)).pdf.arrayBuffer());
  }
  async import(
    file: File,
    language: string,
    password: string,
    progress: (message: string) => void,
  ) {
    const extracted = await extract(file, language, password, progress);
    const item: StoredProject = {
      id: crypto.randomUUID(),
      filename: file.name,
      updatedAt: new Date().toISOString(),
      revision: 1,
      book: extracted.book,
      sourceJson: extracted.sourceJson,
      sourceHash: extracted.book.source_sha256,
      pdf: extracted.pdf,
    };
    validateBook(item.book, extracted.source, item.sourceHash, true);
    await (await this.database).add("projects", item);
    return detail(item);
  }
  private async change(
    id: string,
    expected: number,
    update: (item: StoredProject) => void,
  ) {
    const db = await this.database;
    const tx = db.transaction("projects", "readwrite");
    try {
      const item = await tx.store.get(id);
      revision(item, expected);
      update(item);
      await tx.store.put(item);
      await tx.done;
      return detail(item);
    } catch (error) {
      tx.abort();
      await tx.done.catch(() => {});
      throw error;
    }
  }
  async save(id: string, expected: number, book: Book) {
    await this.read(id, expected);
    return this.change(id, expected, (item) => {
      const source: Evidence = JSON.parse(item.sourceJson);
      const next = structuredClone(book);
      const resolutions = next.review.resolutions || {};
      if (
        Object.entries(resolutions).some(
          ([id, note]) =>
            !source.warnings.some((w) => w.id === id) ||
            typeof note !== "string",
        )
      )
        throw new WorkspaceError(
          "review_required",
          "复核记录必须对应提取警告。",
        );
      next.review = {
        ...next.review,
        status: "draft",
        resolved_warnings: [],
        resolutions,
      };
      validateBook(next, source, item.sourceHash, true);
      item.book = next;
      item.revision++;
      item.updatedAt = new Date().toISOString();
      delete item.exported;
    });
  }
  async review(
    id: string,
    expected: number,
    resolutions: Record<string, string>,
  ) {
    await this.read(id, expected);
    return this.change(id, expected, (item) => {
      const source: Evidence = JSON.parse(item.sourceJson);
      if (
        source.warnings.length !== Object.keys(resolutions).length ||
        source.warnings.some((w) => !resolutions[w.id]?.trim())
      )
        throw new WorkspaceError(
          "review_required",
          "请逐项填写警告的处理记录。",
        );
      item.book.review = {
        status: "reviewed",
        resolved_warnings: source.warnings.map((w) => w.id),
        resolutions,
        notes: ["已核对正文、章节与阅读顺序。", ...Object.values(resolutions)],
      };
      validateBook(item.book, source, item.sourceHash);
      item.revision++;
      item.updatedAt = new Date().toISOString();
      delete item.exported;
    });
  }
  async preview(id: string, expected: number, section: string) {
    const item = await this.read(id, expected);
    return previewEpub(
      buildEpub(item.book, JSON.parse(item.sourceJson), item.sourceHash, true),
      section,
    );
  }
  async export(id: string, expected: number, draft: boolean) {
    const item = await this.read(id, expected);
    const bytes = buildEpub(
      item.book,
      JSON.parse(item.sourceJson),
      item.sourceHash,
      draft,
    );
    const check = await validateEpub(bytes);
    const status = check.valid ? "valid" : "invalid";
    const result: ExportResult = {
      export_id: crypto.randomUUID(),
      status: draft && check.valid ? "draft" : status,
      validation: {
        status,
        internal: { errors: [] },
        epubcheck: {
          status,
          messages: check.messages,
          exit_code: check.exitCode,
          report: check.report,
        },
      },
      can_download: check.valid,
      filename: filename(
        item.book.metadata.title,
        draft ? ".draft.epub" : ".epub",
      ),
      revision: expected,
    };
    await this.change(id, expected, (stored) => {
      stored.exported = {
        result,
        data: new Blob([bytes.slice().buffer], {
          type: "application/epub+zip",
        }),
      };
    });
    return result;
  }
  async download(id: string, exportId: string) {
    const item = await this.read(id);
    if (
      !item.exported?.result.can_download ||
      item.exported.result.export_id !== exportId ||
      item.exported.result.revision !== item.revision
    )
      throw new WorkspaceError("conflict", "此导出已失效，请重新制作并校验。");
    return item.exported.data;
  }
  async backup(id: string) {
    const item = await this.read(id);
    const bytes = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({ version: 1, filename: item.filename }),
      ),
      "source.json": strToU8(item.sourceJson),
      "book.json": strToU8(JSON.stringify(item.book)),
      "source.pdf": new Uint8Array(await item.pdf.arrayBuffer()),
    });
    return {
      blob: new Blob([bytes.slice().buffer], { type: "application/zip" }),
      filename: filename(item.book.metadata.title, ".epub-project.zip"),
    };
  }
  async restore(file: File) {
    if (file.size > 64 * 1024 * 1024)
      throw new WorkspaceError("backup", "项目备份过大。");
    let size = 0;
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter(entry) {
        size += entry.originalSize;
        if (size > 128 * 1024 * 1024)
          throw new WorkspaceError("backup", "项目备份解压后过大。");
        return [
          "manifest.json",
          "source.json",
          "book.json",
          "source.pdf",
        ].includes(entry.name);
      },
    });
    if (
      !["manifest.json", "source.json", "book.json", "source.pdf"].every(
        (key) => files[key],
      )
    )
      throw new WorkspaceError("backup", "项目备份不完整。");
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    if (
      manifest.version !== 1 ||
      files["source.pdf"].length > 32 * 1024 * 1024 ||
      strFromU8(files["source.pdf"].subarray(0, 5)) !== "%PDF-"
    )
      throw new WorkspaceError("backup", "项目备份格式不支持。");
    const sourceJson = strFromU8(files["source.json"]),
      sourceHash = await sha256(sourceJson);
    const book: Book = JSON.parse(strFromU8(files["book.json"]));
    validateBook(book, JSON.parse(sourceJson), sourceHash, true);
    const item: StoredProject = {
      id: crypto.randomUUID(),
      filename: String(manifest.filename || "document.pdf"),
      updatedAt: new Date().toISOString(),
      revision: 1,
      book,
      sourceJson,
      sourceHash,
      pdf: new Blob([files["source.pdf"].slice().buffer], {
        type: "application/pdf",
      }),
    };
    await (await this.database).add("projects", item);
    return detail(item);
  }
  async remove(id: string) {
    await (await this.database).delete("projects", id);
  }
}
