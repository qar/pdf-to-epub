import type { Block, Book, Evidence } from "../types";
import { WorkspaceError } from "./errors";
import { z } from "zod";

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/);
const joins = z.record(z.string(), z.enum(["auto", "space", "none", "line"]));
const blockShape: z.ZodType<Block> = z.lazy(() =>
  z
    .object({
      kind: z.enum([
        "paragraph",
        "heading",
        "source",
        "verse",
        "scene-break",
        "signature",
        "thought",
        "quote",
      ]),
      sources: z.array(id).optional(),
      joins: joins.optional(),
      blocks: z.array(blockShape).optional(),
    })
    .passthrough(),
);
const bookShape = z.object({
  version: z.literal(1),
  source: z.string(),
  source_sha256: z.string(),
  metadata: z.object({
    title: z.string().min(1),
    author: z.string(),
    language: z.string(),
  }),
  review: z.object({
    status: z.enum(["draft", "reviewed"]),
    notes: z.array(z.string()),
    resolved_warnings: z.array(id).optional(),
    resolutions: z.record(z.string(), z.string()).optional(),
  }),
  sections: z.array(
    z.object({
      id,
      title: z.string(),
      kind: z.string(),
      title_sources: z.array(id).optional(),
      title_joins: joins.optional(),
      blocks: z.array(blockShape),
    }),
  ),
  omissions: z.array(z.object({ source: id, reason: z.string() })),
  appearance: z
    .object({
      template: z.enum(["classic", "modern", "compact"]),
      font_size: z.number(),
      line_height: z.number(),
      indent: z.number(),
    })
    .optional(),
});
const sourceShape = z.object({
  pages: z
    .array(
      z.object({
        number: z.number().int().positive(),
        width: z.number().positive(),
        height: z.number().positive(),
        raw_text: z.string(),
        images: z.array(z.unknown()).optional(),
      }),
    )
    .min(1),
  units: z
    .array(
      z.object({
        id,
        page: z.number().int().positive(),
        text: z.string().min(1),
        runs: z
          .array(
            z.object({
              text: z.string(),
              styles: z.array(z.enum(["bold", "italic"])),
            }),
          )
          .min(1),
        bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        font_size: z.number().positive(),
      }),
    )
    .min(1),
  warnings: z.array(
    z.object({
      id,
      page: z.number().int().positive(),
      code: z.string(),
      message: z.string(),
    }),
  ),
});

const kinds = new Set([
  "paragraph",
  "heading",
  "source",
  "verse",
  "scene-break",
  "signature",
  "thought",
]);
const sections = new Set([
  "chapter",
  "part",
  "preface",
  "dedication",
  "copyright-page",
  "acknowledgments",
  "afterword",
  "appendix",
  "notes",
]);

export function validateBook(
  book: Book,
  source: Evidence,
  sourceHash: string,
  draft = false,
) {
  const fail = (code: string, message: string): never => {
    throw new WorkspaceError(code, message);
  };
  if (
    !bookShape.safeParse(book).success ||
    !sourceShape.safeParse(source).success
  )
    fail("invalid_project", "项目结构无效，请使用完整的项目备份。");
  const pages = new Set(source.pages.map((page) => page.number));
  if (
    pages.size !== source.pages.length ||
    new Set(source.warnings.map((warning) => warning.id)).size !==
      source.warnings.length ||
    source.units.some((unit) => !pages.has(unit.page)) ||
    source.warnings.some((warning) => !pages.has(warning.page))
  )
    fail("invalid_source", "来源页码或警告 ID 无效。");
  if (book.version !== 1) fail("model_version", "不支持此项目版本。");
  if (book.source !== "source.json" || book.source_sha256 !== sourceHash)
    fail("source_changed", "原始提取证据已变化。");
  const units = new Map(source.units.map((u) => [u.id, u]));
  if (!units.size || units.size !== source.units.length)
    fail("invalid_source", "文字来源 ID 必须唯一。");
  for (const unit of units.values()) {
    if (
      !unit.text ||
      unit.runs.map((r) => r.text).join("") !== unit.text ||
      unit.runs.some((r) =>
        r.styles.some((s) => !["bold", "italic"].includes(s)),
      )
    )
      fail("invalid_source", "字形记录与原始文字不一致。");
  }
  if (
    !book.metadata.title?.trim() ||
    !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(book.metadata.language)
  )
    fail("metadata", "请填写书名和有效的语言代码。");
  const appearance = book.appearance;
  if (appearance) {
    if (!["classic", "modern", "compact"].includes(appearance.template))
      fail("appearance", "请选择有效的版式。");
    for (const [key, low, high] of [
      ["font_size", 0.85, 1.4],
      ["line_height", 1.2, 2],
      ["indent", 0, 2],
    ] as const) {
      const value = appearance[key];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < low ||
        value > high
      )
        fail("appearance", "版式数值超出范围。");
    }
  }
  const seen = new Map<string, number>();
  const use = (id: string) => seen.set(id, (seen.get(id) || 0) + 1);
  const block = (item: Block, depth = 0) => {
    if (depth > 20 || "text" in item || "html" in item)
      fail("untracked_text", "正文必须引用原始文字来源。");
    if (item.kind === "quote") {
      if (item.sources || !item.blocks?.length)
        fail("invalid_block", "引文必须包含正文段落。");
      item.blocks!.forEach((child) => block(child, depth + 1));
      return;
    }
    if (!kinds.has(item.kind) || !item.sources?.length)
      fail("invalid_block", "段落缺少文字来源。");
    item.sources!.forEach(use);
    for (const [id, join] of Object.entries(item.joins || {})) {
      if (
        !item.sources!.slice(0, -1).includes(id) ||
        !["auto", "space", "none", "line"].includes(join)
      )
        fail("invalid_join", "行连接设置无效。");
    }
  };
  const ids = new Set(["title", "contents"]);
  if (!book.sections.length) fail("empty_book", "至少保留一个章节。");
  for (const section of book.sections) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(section.id) || ids.has(section.id))
      fail("section_id", "章节 ID 必须唯一。");
    ids.add(section.id);
    if (
      !sections.has(section.kind) ||
      !section.title.trim() ||
      (!section.blocks.length && !section.title_sources?.length)
    )
      fail("invalid_section", "章节需要标题和文字来源。");
    if (section.title_sources)
      block({
        kind: "heading",
        sources: section.title_sources,
        joins: section.title_joins,
      });
    section.blocks.forEach((item) => block(item));
  }
  if (!seen.size) fail("empty_book", "书籍必须包含原始正文。");
  for (const omitted of book.omissions) {
    if (!omitted.reason.trim()) fail("omission_reason", "请填写排除理由。");
    use(omitted.source);
  }
  if (
    seen.size !== units.size ||
    [...seen].some(([id, count]) => count !== 1 || !units.has(id))
  )
    fail("source_coverage", "正文存在遗漏或重复，请检查段落和排除项。");
  if (
    !draft &&
    (book.review.status !== "reviewed" ||
      source.warnings.some(
        (w) => !book.review.resolved_warnings?.includes(w.id),
      ))
  )
    fail("review_required", "请完成正文校对，并逐项处理提取警告。");
  return units;
}
