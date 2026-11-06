export type BlockKind =
  | "paragraph"
  | "heading"
  | "source"
  | "verse"
  | "scene-break"
  | "signature"
  | "thought"
  | "quote";
export type Join = "auto" | "space" | "none" | "line";
export interface Block {
  kind: BlockKind;
  sources?: string[];
  joins?: Record<string, Join>;
  blocks?: Block[];
}
export interface Section {
  id: string;
  title: string;
  kind: string;
  title_sources?: string[];
  title_joins?: Record<string, Join>;
  blocks: Block[];
}
export interface Appearance {
  template: "classic" | "modern" | "compact";
  line_height: number;
  indent: number;
  font_size: number;
}
export interface Book {
  version: number;
  source: string;
  source_sha256: string;
  metadata: { title: string; author: string; language: string };
  review: {
    status: string;
    notes: string[];
    resolved_warnings?: string[];
    resolutions?: Record<string, string>;
  };
  sections: Section[];
  omissions: { source: string; reason: string }[];
  appearance?: Appearance;
}
export interface Unit {
  id: string;
  page: number;
  text: string;
  runs: { text: string; styles: string[] }[];
  bbox: number[];
  font_size: number;
}
export interface Warning {
  id: string;
  code: string;
  page: number;
  message: string;
}
export interface Evidence {
  units: Unit[];
  pages: {
    number: number;
    width: number;
    height: number;
    raw_text: string;
    images?: unknown[];
  }[];
  warnings: Warning[];
}
export interface Project {
  id: string;
  title: string;
  author: string;
  filename: string;
  pages: number;
  units: number;
  sections: number;
  review_status: string;
  updated_at: string;
}
export interface ExportResult {
  export_id: string;
  status: string;
  validation: {
    status: string;
    internal: { errors: string[] };
    epubcheck: {
      status: string;
      exit_code?: number;
      report?: string;
      reason?: string;
      messages?: { message: string; severity?: string }[];
    };
  };
  can_download: boolean;
  filename: string;
  revision: number;
}
export interface Detail {
  project: Project;
  book: Book;
  source: Evidence;
  revision: number;
  validation: ExportResult | null;
}
