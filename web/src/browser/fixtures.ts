import type { Book, Evidence } from "../types";
import { sha256 } from "./errors";

export async function fixture() {
  const text = [
    "book",
    "store",
    "A quiet morning.",
    "The next paragraph.",
    "第一句。",
    "第二句。",
  ];
  const source: Evidence = {
    pages: [{ number: 1, width: 420, height: 595, raw_text: text.join("\n") }],
    units: text.map((value, i) => ({
      id: `u${i}`,
      page: 1,
      text: value,
      runs: [{ text: value, styles: i === 2 ? ["italic"] : [] }],
      bbox: [40, 40 + i * 20, 300, 60 + i * 20],
      font_size: 12,
    })),
    warnings: [],
  };
  const sourceJson = JSON.stringify(source),
    sourceHash = await sha256(sourceJson);
  const book: Book = {
    version: 1,
    source: "source.json",
    source_sha256: sourceHash,
    metadata: {
      title: "Sample <book>",
      author: "Author & Editor",
      language: "en",
    },
    review: { status: "reviewed", notes: ["Checked"], resolved_warnings: [] },
    omissions: [],
    sections: [
      {
        id: "chapter",
        title: "bookstore",
        kind: "chapter",
        title_sources: ["u0", "u1"],
        title_joins: { u0: "none" },
        blocks: [
          { kind: "paragraph", sources: ["u2"] },
          { kind: "quote", blocks: [{ kind: "paragraph", sources: ["u3"] }] },
          { kind: "paragraph", sources: ["u4", "u5"] },
        ],
      },
    ],
  };
  return { source, sourceJson, sourceHash, book };
}
