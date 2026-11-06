import { OPS, Util } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { Block, Book, Evidence, Unit } from "../types";
import { getDocument } from "./pdf";
import { sha256, WorkspaceError } from "./errors";

const terminal = (text: string) => /[.!?。！？…]["'”’）)]*$/.test(text.trim());
const mode = (values: number[]) => {
  const counts = new Map<number, number>();
  for (const n of values) counts.set(n, (counts.get(n) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || 12;
};

export function paragraphs(source: Evidence): Block[] {
  const sizes = new Map<number, number>();
  for (const u of source.units)
    sizes.set(u.font_size, (sizes.get(u.font_size) || 0) + u.text.length);
  const size = [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] || 12;
  const metrics = new Map(
    source.pages.map((page) => {
      const regular = source.units.filter(
        (u) => u.page === page.number && u.font_size <= size * 1.25,
      );
      const left = regular.map((u) => Math.round(u.bbox[0]));
      const steps = regular
        .slice(1)
        .map((u, i) => u.bbox[1] - regular[i].bbox[1])
        .filter((n) => n > 0 && n <= size * 1.8)
        .sort((a, b) => a - b);
      return [
        page.number,
        {
          margin: mode(left),
          leading: steps[Math.floor(steps.length / 2)] || size * 1.2,
          width: page.width,
        },
      ];
    }),
  );
  const blocks: Block[] = [];
  let previous: Unit | undefined;
  for (const u of source.units) {
    const metric = metrics.get(u.page)!;
    const heading = u.font_size > size * 1.35;
    let next = !previous || heading || blocks.at(-1)?.kind === "heading";
    if (previous && !next) {
      const prevMetric = metrics.get(previous.page)!;
      const gap =
        u.page === previous.page &&
        u.bbox[1] - previous.bbox[1] > metric.leading * 1.55;
      const indent = u.bbox[0] - metric.margin > size * 0.65;
      const short =
        previous.bbox[2] < prevMetric.width - prevMetric.margin - size * 1.5;
      next =
        gap ||
        indent ||
        (short &&
          terminal(previous.text) &&
          /^[A-Z"“(\d\u3400-\u9fff]/u.test(u.text));
      if (!terminal(previous.text) && /^[a-z]/.test(u.text)) next = false;
    }
    if (next)
      blocks.push({ kind: heading ? "heading" : "paragraph", sources: [u.id] });
    else blocks.at(-1)!.sources!.push(u.id);
    previous = u;
  }
  return blocks;
}

export async function extract(
  file: File,
  language: string,
  password: string,
  progress: (message: string) => void,
) {
  const data = new Uint8Array(await file.arrayBuffer());
  if (
    data.length > 32 * 1024 * 1024 ||
    new TextDecoder().decode(data.subarray(0, 5)) !== "%PDF-"
  )
    throw new WorkspaceError("invalid_pdf", "请选择小于 32 MB 的 PDF 文件。");
  const task = getDocument({
    data: data.slice(),
    password,
    fontExtraProperties: true,
  });
  try {
    const pdf = await task.promise;
    const source: Evidence = { units: [], pages: [], warnings: [] };
    for (let number = 1; number <= pdf.numPages; number++) {
      progress(`正在提取文字 ${number} / ${pdf.numPages}`);
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ disableNormalization: true });
      const operators = await page.getOperatorList();
      const items = content.items.filter(
        (item): item is TextItem => "str" in item,
      );
      const lines: Unit[] = [];
      let current: Unit | null = null;
      let reordered = false,
        columns = false;
      for (const item of items) {
        if (!item.str.trim()) {
          if (item.hasEOL) current = null;
          continue;
        }
        const t = Util.transform(viewport.transform, item.transform);
        const size = Math.max(1, Math.hypot(t[2], t[3]));
        const x = t[4],
          y = t[5] - size,
          right = x + Math.abs(item.width);
        const styles: string[] = [];
        const font = page.commonObjs.has(item.fontName)
          ? page.commonObjs.get(item.fontName)
          : undefined;
        const fontName = String(
          font?.name || content.styles[item.fontName]?.fontFamily || "",
        );
        if (font?.bold || /bold|semibold|demi/i.test(fontName))
          styles.push("bold");
        if (font?.italic || /italic|oblique/i.test(fontName))
          styles.push("italic");
        if (current && x - current.bbox[2] > size * 3) {
          columns = true;
          current = null;
        }
        if (
          current &&
          (Math.abs(current.bbox[1] - y) > size * 0.35 ||
            x < current.bbox[0] - size)
        )
          current = null;
        if (!current) {
          const previous = lines.at(-1);
          if (previous && y < previous.bbox[1] - size * 2) reordered = true;
          current = {
            id: `p${String(number).padStart(4, "0")}-l${String(lines.length + 1).padStart(4, "0")}`,
            page: number,
            text: "",
            runs: [],
            bbox: [x, y, right, y + size],
            font_size: Math.round(size * 100) / 100,
          };
          lines.push(current);
        }
        if (
          current.text &&
          x - current.bbox[2] > size * 0.18 &&
          !/\s$/.test(current.text) &&
          !/^\s/.test(item.str)
        ) {
          current.text += " ";
          current.runs.push({ text: " ", styles: [] });
        }
        current.text += item.str;
        current.runs.push({ text: item.str, styles });
        current.bbox[2] = Math.max(current.bbox[2], right);
        current.bbox[3] = Math.max(current.bbox[3], y + size);
        current.font_size = Math.max(
          current.font_size,
          Math.round(size * 100) / 100,
        );
        if (item.hasEOL) current = null;
      }
      const compact = (text: string) => text.replace(/\s/g, "");
      if (
        compact(lines.map((u) => u.text).join("")) !==
        compact(items.map((i) => i.str).join(""))
      )
        throw new WorkspaceError(
          "source_coverage",
          `第 ${number} 页文字提取不完整。`,
        );
      const images = operators.fnArray.some((op) =>
        [
          OPS.paintImageXObject,
          OPS.paintInlineImageXObject,
          OPS.paintImageMaskXObject,
        ].includes(op),
      );
      source.pages.push({
        number,
        width: viewport.width,
        height: viewport.height,
        raw_text: lines.map((u) => u.text).join("\n"),
        images: images ? ["image"] : [],
      });
      source.units.push(...lines);
      const warning = (code: string, message: string) =>
        source.warnings.push({
          id: `${code}-${number}`,
          code,
          page: number,
          message,
        });
      if (images)
        warning(
          "page_images",
          "此页含有图像，请确认扫描正文、插图和图注是否已完整处理。",
        );
      if (!lines.length)
        warning("page_without_text", "此页没有文字层，请核对是否需要 OCR。");
      if (reordered)
        warning("text_order", "文字顺序可能与页面视觉顺序不同，请核对。");
      if (columns)
        warning("columns_or_form", "此页可能含有多栏或表格，请核对阅读顺序。");
      page.cleanup();
    }
    if (!source.units.length)
      throw new WorkspaceError(
        "ocr_required",
        "这份 PDF 没有可用文字层，需要先进行 OCR。",
      );
    const metadata = await pdf.getMetadata().catch(() => null);
    const info = metadata?.info as
      { Title?: string; Author?: string } | undefined;
    const sourceJson = JSON.stringify(source);
    const book: Book = {
      version: 1,
      source: "source.json",
      source_sha256: await sha256(sourceJson),
      metadata: {
        title: info?.Title?.trim() || file.name.replace(/\.pdf$/i, ""),
        author: info?.Author?.trim() || "",
        language,
      },
      review: { status: "draft", notes: [], resolved_warnings: [] },
      sections: [
        {
          id: "text",
          title: info?.Title?.trim() || file.name.replace(/\.pdf$/i, ""),
          kind: "chapter",
          blocks: paragraphs(source),
        },
      ],
      omissions: [],
    };
    return {
      source,
      sourceJson,
      book,
      pdf: new Blob([data], { type: "application/pdf" }),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException")
      throw new WorkspaceError(
        "password_required",
        "这份 PDF 需要正确的打开密码。",
      );
    throw error;
  } finally {
    await task.destroy();
  }
}
