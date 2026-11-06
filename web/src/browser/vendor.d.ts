declare module "epubcheck-standalone/epubcheck-engine.js" {
  export const createEngine: NonNullable<
    Parameters<
      typeof import("epubcheck-standalone").configureEngine
    >[0]["createEngine"]
  >;
}

declare module "pdfjs-dist/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
