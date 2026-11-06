import { getDocument } from "pdfjs-dist";
import { WorkerMessageHandler } from "pdfjs-dist/build/pdf.worker.mjs";

// PDF.js supports an in-process handler when hosting policy disallows workers.
Object.assign(globalThis, { pdfjsWorker: { WorkerMessageHandler } });
export { getDocument };
