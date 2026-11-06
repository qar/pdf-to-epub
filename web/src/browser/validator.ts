import { configureEngine, validate } from "epubcheck-standalone";
import { createEngine } from "epubcheck-standalone/epubcheck-engine.js";

configureEngine({ createEngine });

export interface Validation {
  valid: boolean;
  exitCode: number;
  report?: string;
  summary: { fatals: number; errors: number; warnings: number; infos: number };
  messages: { id: string; severity: string; message: string; path?: string }[];
}

export async function validateEpub(bytes: Uint8Array): Promise<Validation> {
  await new Promise((resolve) => setTimeout(resolve, 50));
  const result = await validate(bytes, {
    name: "book.epub",
    args: ["--failonwarnings"],
    reports: ["json"],
    timeoutMs: 120000,
    signal: AbortSignal.timeout(125000),
  });
  if (result.exitCode === null || result.summary === null)
    throw new Error("EPUBCheck 未返回完整结果，请重试。");
  return {
    valid: result.valid && result.exitCode === 0,
    exitCode: result.exitCode,
    summary: result.summary,
    messages: result.messages,
    report: result.reports?.json,
  };
}
