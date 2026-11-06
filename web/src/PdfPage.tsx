import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  PasswordResponses,
} from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker&inline";
import type { PDFDocumentProxy } from "pdfjs-dist";

GlobalWorkerOptions.workerPort = new PdfWorker();

export default function PdfPage({
  data,
  page,
}: {
  data: Uint8Array;
  page: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(600);
  const [error, setError] = useState("");
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const unlock = useRef<((password: string) => void) | null>(null);
  useEffect(() => {
    setError("");
    const task = getDocument({ data: data.slice() });
    let active = true;
    task.onPassword = (update: (password: string) => void, reason: number) => {
      if (!active) return;
      unlock.current = update;
      setPasswordRequired(true);
      setPasswordError(reason === PasswordResponses.INCORRECT_PASSWORD);
    };
    task.promise
      .then((value) => {
        if (active) {
          setDoc(value);
          setPasswordRequired(false);
          setPassword("");
        }
      })
      .catch(() => {
        if (active) setError("此页无法预览。");
      });
    return () => {
      active = false;
      setDoc(null);
      unlock.current = null;
      void task.destroy();
    };
  }, [data]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(200, entry.contentRect.width)),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!doc || !canvas.current) return;
    let cancelled = false;
    let render:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    const task = async () => {
      const pdfPage = await doc.getPage(
        Math.max(1, Math.min(page, doc.numPages)),
      );
      if (cancelled || !canvas.current) return;
      const scale = Math.min(2, devicePixelRatio || 1);
      const viewport = pdfPage.getViewport({
        scale: width / pdfPage.getViewport({ scale: 1 }).width,
      });
      const target = canvas.current;
      target.width = Math.floor(viewport.width * scale);
      target.height = Math.floor(viewport.height * scale);
      target.style.width = `${viewport.width}px`;
      target.style.height = `${viewport.height}px`;
      render = pdfPage.render({
        canvas: target,
        viewport,
        transform: [scale, 0, 0, scale, 0, 0],
      });
      await render.promise;
    };
    void task().catch((e) => {
      if (!cancelled && e?.name !== "RenderingCancelledException")
        setError("此页无法预览。");
    });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [doc, page, width]);
  return (
    <div className="pdf-canvas" ref={container}>
      {passwordRequired && (
        <form
          className="pdf-password"
          onSubmit={(event) => {
            event.preventDefault();
            unlock.current?.(password);
            setPassword("");
          }}
        >
          <label className="field">
            原稿打开密码
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {passwordError && <p className="form-error">密码不正确。</p>}
          <button className="button primary" disabled={!password} type="submit">
            解锁原稿
          </button>
        </form>
      )}
      {error ? (
        <p className="empty-note">{error}</p>
      ) : (
        <canvas ref={canvas} aria-label={`PDF 第 ${page} 页`} />
      )}
    </div>
  );
}
