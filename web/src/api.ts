const DEFAULT_ENGINE = "http://127.0.0.1:48291";
const messages: Record<string, string> = {
  unauthorized: "连接已失效，请重新连接本机。",
  origin_denied: "本机服务尚未允许此网页连接。",
  password_required: "这份 PDF 需要正确的打开密码。",
  ocr_required: "未找到可用文字层。请先完成 OCR。",
  missing_tool: "本机缺少 PDF 提取工具。",
  invalid_pdf: "请选择小于 32 MB 的 PDF 文件。",
  file_too_large: "PDF 文件不能超过 32 MB。",
  conflict: "项目版本已变化，请重新打开项目。",
  source_coverage: "正文存在遗漏或重复。请检查段落和排除项。",
  review_required: "请完成正文校对，并逐项处理提取警告。",
  protected_source: "原始提取证据不可替换。",
  storage_error: "无法读写本机工作目录。",
};

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(messages[code] || message);
  }
}

export function localEngine(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "本机地址必须是 http://127.0.0.1:端口 或 http://localhost:端口。",
    );
  }
  return url.origin;
}

export class Api {
  engine: string;
  token: string;
  constructor() {
    const params = new URLSearchParams(location.hash.slice(1));
    this.engine = DEFAULT_ENGINE;
    try {
      this.engine = localEngine(
        params.get("engine") ||
          sessionStorage.getItem("epub-engine") ||
          (["127.0.0.1", "localhost"].includes(location.hostname) &&
          !import.meta.env.DEV
            ? location.origin
            : DEFAULT_ENGINE),
      );
    } catch {
      /* Keep credentials restricted to loopback. */
    }
    this.token =
      params.get("token") || sessionStorage.getItem("epub-token") || "";
    if (params.has("token"))
      history.replaceState(null, "", location.pathname + location.search);
    sessionStorage.setItem("epub-engine", this.engine);
    if (this.token) sessionStorage.setItem("epub-token", this.token);
  }
  setEngine(value: string) {
    this.engine = localEngine(value);
    this.token = "";
    sessionStorage.setItem("epub-engine", this.engine);
    sessionStorage.removeItem("epub-token");
  }
  async pairLocal() {
    if (location.origin === this.engine) {
      const session = await this.json<{ token: string }>("/api/session");
      this.token = session.token;
      sessionStorage.setItem("epub-token", this.token);
    }
  }
  async request(
    path: string,
    method = "GET",
    value?: unknown,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(this.engine + path, {
        method,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: {
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(value !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
        },
        body: value !== undefined ? JSON.stringify(value) : undefined,
      });
    } catch {
      throw new ApiError(
        "connection",
        "无法连接本机服务。请检查服务状态和浏览器的本地网络权限。",
      );
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({
        code: "request_failed",
        message: `请求失败 (${response.status})`,
      }));
      throw new ApiError(error.code, error.message);
    }
    return response;
  }
  async json<T>(path: string, method = "GET", value?: unknown): Promise<T> {
    return (await this.request(path, method, value)).json();
  }
  connectUrl() {
    return `${this.engine}/connect?returnTo=${encodeURIComponent(location.origin + location.pathname)}`;
  }
}

export async function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("无法读取所选文件。"));
    reader.readAsDataURL(file);
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
