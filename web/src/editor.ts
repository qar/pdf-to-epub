import type { Block, Book, Join } from "./types";

export function blockSources(block: Block): string[] {
  return block.kind === "quote"
    ? (block.blocks || []).flatMap(blockSources)
    : block.sources || [];
}
function blockJoins(block: Block): Record<string, Join> {
  if (block.kind !== "quote") return block.joins || {};
  return Object.assign({}, ...(block.blocks || []).map(blockJoins));
}
export function changeKind(block: Block, kind: Block["kind"]): Block {
  if (block.kind === kind) return block;
  if (kind === "quote") return { kind, blocks: [block] };
  return { kind, sources: blockSources(block), joins: blockJoins(block) };
}
export function edit(book: Book, apply: (draft: Book) => void): Book {
  const draft = structuredClone(book);
  apply(draft);
  draft.review.status = "draft";
  return draft;
}
function leaf(block: Block, sources: string[]): Block {
  const joins = Object.fromEntries(
    Object.entries(blockJoins(block)).filter(([id]) =>
      sources.slice(0, -1).includes(id),
    ),
  ) as Record<string, Join>;
  return {
    kind: block.kind === "quote" ? "paragraph" : block.kind,
    sources,
    ...(Object.keys(joins).length ? { joins } : {}),
  };
}
export function mergeBlock(book: Book, sectionId: string, index: number) {
  return edit(book, (draft) => {
    const blocks = draft.sections.find((s) => s.id === sectionId)!.blocks;
    if (!blocks[index + 1]) return;
    const first = blocks[index],
      second = blocks[index + 1];
    blocks.splice(index, 2, {
      kind: "paragraph",
      sources: [...blockSources(first), ...blockSources(second)],
      joins: { ...blockJoins(first), ...blockJoins(second) },
    });
  });
}
export function splitBlock(
  book: Book,
  sectionId: string,
  index: number,
  after: string,
) {
  return edit(book, (draft) => {
    const blocks = draft.sections.find((s) => s.id === sectionId)!.blocks;
    const block = blocks[index],
      sources = blockSources(block),
      at = sources.indexOf(after) + 1;
    if (at <= 0 || at >= sources.length)
      throw new Error("请选择段落中间的来源行。");
    blocks.splice(
      index,
      1,
      leaf(block, sources.slice(0, at)),
      leaf(block, sources.slice(at)),
    );
  });
}
export function startSection(
  book: Book,
  sectionId: string,
  index: number,
  title: string,
  id: string,
) {
  return edit(book, (draft) => {
    const at = draft.sections.findIndex((s) => s.id === sectionId),
      section = draft.sections[at];
    if (!title.trim()) throw new Error("章节名称不能为空。");
    if (index === 0 && !section.title_sources?.length) {
      section.title = title.trim();
      return;
    }
    const blocks = section.blocks.splice(index);
    if (!blocks.length) throw new Error("请选择分章位置。");
    draft.sections.splice(at + 1, 0, {
      id,
      title: title.trim(),
      kind: "chapter",
      blocks,
    });
  });
}
export function promoteTitle(
  book: Book,
  sectionId: string,
  index: number,
  title: string,
) {
  return edit(book, (draft) => {
    const section = draft.sections.find((s) => s.id === sectionId)!;
    const [block] = section.blocks.splice(index, 1);
    if (section.title_sources?.length)
      section.blocks.unshift({
        kind: "heading",
        sources: section.title_sources,
        joins: section.title_joins,
      });
    section.title_sources = blockSources(block);
    section.title_joins = blockJoins(block);
    section.title = title;
  });
}
export function omitBlock(
  book: Book,
  sectionId: string,
  index: number,
  reason: string,
) {
  if (!reason.trim()) throw new Error("请填写排除原因。");
  return edit(book, (draft) => {
    const section = draft.sections.find((s) => s.id === sectionId)!;
    const [block] = section.blocks.splice(index, 1);
    draft.omissions.push(
      ...blockSources(block).map((source) => ({
        source,
        reason: reason.trim(),
      })),
    );
    draft.sections = draft.sections.filter(
      (s) => s.blocks.length || s.title_sources?.length,
    );
    if (!draft.sections.length) throw new Error("每本书至少保留一段正文。");
  });
}
