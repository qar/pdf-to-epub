import { describe, expect, it } from "vitest";
import type { Book } from "./types";
import {
  mergeBlock,
  splitBlock,
  startSection,
  omitBlock,
  promoteTitle,
  blockSources,
  changeKind,
} from "./editor";

const sample = (): Book => ({
  version: 1,
  source: "source.json",
  source_sha256: "evidence",
  metadata: { title: "Book", author: "", language: "en" },
  review: { status: "reviewed", notes: [] },
  omissions: [],
  sections: [
    {
      id: "one",
      title: "One",
      kind: "chapter",
      blocks: [
        { kind: "paragraph", sources: ["a", "b"] },
        { kind: "paragraph", sources: ["c"] },
      ],
    },
  ],
});
const coverage = (book: Book) =>
  book.sections
    .flatMap((s) => [
      ...(s.title_sources || []),
      ...s.blocks.flatMap(blockSources),
    ])
    .concat(book.omissions.map((o) => o.source))
    .sort();

describe("source-preserving editing", () => {
  it("keeps title joins when promoting and replacing a source heading", () => {
    const book = sample();
    book.sections[0].blocks[0].joins = { a: "none" };
    const first = promoteTitle(book, "one", 0, "Joined title");
    expect(first.sections[0].title_joins).toEqual({ a: "none" });
    const next = promoteTitle(first, "one", 0, "Next title");
    expect(next.sections[0].blocks[0].joins).toEqual({ a: "none" });
    expect(coverage(next)).toEqual(["a", "b", "c"]);
  });
  it("preserves explicit joins when changing kind and merging quotes", () => {
    const book = sample();
    book.sections[0].blocks[0].joins = { a: "none" };
    const quote = changeKind(book.sections[0].blocks[0], "quote");
    expect(changeKind(quote, "verse").joins).toEqual({ a: "none" });
    book.sections[0].blocks[0] = quote;
    expect(mergeBlock(book, "one", 0).sections[0].blocks[0].joins).toEqual({
      a: "none",
    });
  });
  it("merges and splits paragraphs without losing or repeating a source", () => {
    const merged = mergeBlock(sample(), "one", 0);
    expect(merged.sections[0].blocks).toHaveLength(1);
    expect(merged.review.status).toBe("draft");
    const split = splitBlock(merged, "one", 0, "b");
    expect(split.sections[0].blocks.map(blockSources)).toEqual([
      ["a", "b"],
      ["c"],
    ]);
    expect(coverage(split)).toEqual(["a", "b", "c"]);
  });
  it("starts a chapter and promotes its heading without duplicating it", () => {
    const book = startSection(sample(), "one", 1, "Two", "two");
    expect(book.sections.map((s) => s.id)).toEqual(["one", "two"]);
    const promoted = promoteTitle(book, "two", 0, "Two");
    expect(promoted.sections[1].title_sources).toEqual(["c"]);
    expect(promoted.sections[1].blocks).toHaveLength(0);
    expect(coverage(promoted)).toEqual(["a", "b", "c"]);
  });
  it("requires a reason to exclude a paragraph and keeps the exclusion in coverage", () => {
    expect(() => omitBlock(sample(), "one", 0, "")).toThrow();
    const book = omitBlock(sample(), "one", 0, "Verified running header.");
    expect(book.omissions).toEqual([
      { source: "a", reason: "Verified running header." },
      { source: "b", reason: "Verified running header." },
    ]);
    expect(coverage(book)).toEqual(["a", "b", "c"]);
    expect(sample().sections[0].blocks).toHaveLength(2);
  });
});
