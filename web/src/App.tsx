import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookMarked,
  BookOpen,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  FileUp,
  FolderOpen,
  LayoutList,
  Loader2,
  Merge,
  Monitor,
  PanelLeft,
  PanelRight,
  HardDrive,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  Scissors,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  Tablet,
  Trash2,
  Type,
  Undo2,
  X,
  AlertTriangle,
} from "lucide-react";
import { downloadBlob } from "./download";
import { notices } from "./notices";
import EpubPreview from "./EpubPreview";
import { BrowserWorkspace } from "./browser/workspace";
import type {
  Appearance,
  Block,
  Book,
  Detail,
  ExportResult,
  Project,
  Unit,
} from "./types";
import {
  blockSources,
  changeKind,
  edit,
  mergeBlock,
  omitBlock,
  promoteTitle,
  splitBlock,
  startSection,
} from "./editor";
import PdfPage from "./PdfPage";

const workspace = new BrowserWorkspace();
const kinds: Record<string, string> = {
  paragraph: "正文",
  heading: "小标题",
  quote: "引文",
  source: "来源说明",
  verse: "诗行",
  "scene-break": "场景分隔",
  signature: "署名",
  thought: "思绪",
};
const warningNames: Record<string, string> = {
  page_images: "含有图像",
  page_without_text: "未找到文字",
  text_order: "阅读顺序待核对",
  columns_or_form: "多栏或表格",
};
const defaults: Appearance = {
  template: "classic",
  line_height: 1.5,
  indent: 1.25,
  font_size: 1,
};

function Tool({
  label,
  children,
  onClick,
  disabled = false,
  active = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`tool ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function Dialog({
  title,
  children,
  close,
  wide = false,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "dialog wide" : "dialog"}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
      onClick={(event) => {
        if (event.target === ref.current && !busy) close();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <Tool label="关闭" onClick={close} disabled={busy}>
          <X size={18} />
        </Tool>
      </div>
      {children}
    </dialog>
  );
}

function SourceText({
  ids,
  units,
}: {
  ids: string[];
  units: Map<string, Unit>;
}) {
  return (
    <>
      {ids.map((id, index) => (
        <span key={id}>
          {index > 0 && " "}
          {units.get(id)?.runs.map((run, i) => (
            <span
              key={i}
              style={{
                fontStyle: run.styles.includes("italic") ? "italic" : undefined,
                fontWeight: run.styles.includes("bold") ? 600 : undefined,
              }}
            >
              {run.text}
            </span>
          ))}
        </span>
      ))}
    </>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [persisted, setPersisted] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [past, setPast] = useState<Book[]>([]);
  const [future, setFuture] = useState<Book[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<"structure" | "preview" | "original">(
    "structure",
  );
  const [inspector, setInspector] = useState<"book" | "paragraph" | "review">(
    "book",
  );
  const [showLeft, setShowLeft] = useState(() => innerWidth > 840);
  const [showRight, setShowRight] = useState(() => innerWidth > 840);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pdf, setPdf] = useState<Uint8Array | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [preview, setPreview] = useState("");
  const [previewSection, setPreviewSection] = useState("");
  const [previewWidth, setPreviewWidth] = useState(680);
  const [dialog, setDialog] = useState<
    "storage" | "import" | "chapter" | "omit" | "export" | "omissions" | null
  >(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [language, setLanguage] = useState("en");
  const [field, setField] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [exportDraft, setExportDraft] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const section =
    book?.sections.find((item) => item.id === sectionId) || book?.sections[0];
  const block = section?.blocks[selected];
  const units = useMemo(
    () => new Map(detail?.source.units.map((unit) => [unit.id, unit]) || []),
    [detail?.source],
  );
  const warnings = detail?.source.warnings || [];
  const resolutions = book?.review.resolutions || {};
  const sources = block ? blockSources(block) : [];
  const textOf = useCallback(
    (item: Block) =>
      blockSources(item)
        .map((id) => units.get(id)?.text || "")
        .join(" "),
    [units],
  );
  const filtered = useMemo(
    () =>
      (section?.blocks || [])
        .map((item, index) => ({ item, index }))
        .filter(
          ({ item }) =>
            !search ||
            textOf(item)
              .toLocaleLowerCase()
              .includes(search.toLocaleLowerCase()),
        ),
    [section, search, textOf],
  );
  const visible = filtered.slice(page * 40, (page + 1) * 40);
  const appearance = book?.appearance || defaults;

  const reportError = useCallback((value: unknown) => {
    const message =
      value instanceof Error && value.name === "QuotaExceededError"
        ? "浏览器存储空间不足，请先备份并移除不再使用的项目。"
        : value instanceof Error
          ? value.message
          : "操作失败，请重试。";
    setError(message);
  }, []);

  const refresh = useCallback(async () => {
    setError("");
    try {
      setProjects(await workspace.list());
      setPersisted((await navigator.storage?.persisted?.()) || false);
      setReady(true);
    } catch (e) {
      setReady(false);
      reportError(e);
    }
  }, [reportError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (toast) {
      const timeout = setTimeout(() => setToast(""), 3000);
      return () => clearTimeout(timeout);
    }
  }, [toast]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    addEventListener("beforeunload", unload);
    return () => removeEventListener("beforeunload", unload);
  }, [dirty]);
  useEffect(() => {
    setPage(0);
    listRef.current?.scrollTo({ top: 0 });
  }, [sectionId, search]);
  useEffect(() => {
    if (!book || !section) return;
    if (section.id !== sectionId) setSectionId(section.id);
    if (selected >= section.blocks.length)
      setSelected(Math.max(0, section.blocks.length - 1));
    if (
      !["title", "contents", ...book.sections.map((s) => s.id)].includes(
        previewSection,
      )
    )
      setPreviewSection(section.id);
    if (page * 40 >= filtered.length)
      setPage(Math.max(0, Math.ceil(filtered.length / 40) - 1));
  }, [
    book,
    section,
    sectionId,
    selected,
    previewSection,
    page,
    filtered.length,
  ]);

  const adopt = (value: Detail, keepHistory = false) => {
    setDetail(value);
    setBook(value.book);
    setDirty(false);
    setExportResult(value.validation);
    if (!keepHistory) {
      setPast([]);
      setFuture([]);
      setSelected(0);
      setSectionId(value.book.sections[0]?.id || "");
      setPreview("");
      setPdf(null);
    }
    setProjects((current) => [
      value.project,
      ...current.filter((p) => p.id !== value.project.id),
    ]);
  };
  const load = async (id: string) => {
    if (dirty && !confirm("放弃尚未保存的修改？")) return;
    setBusy("正在打开");
    setError("");
    try {
      adopt(await workspace.open(id));
      setTab("structure");
      setSearch("");
      setConfirmed(false);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy("");
    }
  };
  const change = (next: Book) => {
    if (!book || busy) return;
    setPast((history) => [...history.slice(-29), book]);
    setFuture([]);
    setBook(next);
    setDirty(true);
    setConfirmed(false);
    setPreview("");
    setExportResult(null);
    if (!next.sections.some((s) => s.id === sectionId)) {
      setSectionId(next.sections[0]?.id || "");
      setSelected(0);
    }
  };
  const mutate = (action: (draft: Book) => void) => {
    if (book) {
      try {
        change(edit(book, action));
      } catch (e) {
        reportError(e);
      }
    }
  };
  const operation = (action: () => Book) => {
    try {
      change(action());
    } catch (e) {
      reportError(e);
    }
  };
  const undo = () => {
    if (!book || !past.length || busy) return;
    setFuture((values) => [book, ...values]);
    setBook(past[past.length - 1]);
    setPast((values) => values.slice(0, -1));
    setDirty(true);
    setPreview("");
    setExportResult(null);
    setConfirmed(false);
  };
  const redo = () => {
    if (!book || !future.length || busy) return;
    setPast((values) => [...values, book]);
    setBook(future[0]);
    setFuture((values) => values.slice(1));
    setDirty(true);
    setPreview("");
    setExportResult(null);
    setConfirmed(false);
  };
  const saveCurrent = async (): Promise<Detail> => {
    if (!detail || !book) throw new Error("请先打开书籍。");
    if (!dirty) return detail;
    const saved = await workspace.save(
      detail.project.id,
      detail.revision,
      book,
    );
    adopt(saved, true);
    return saved;
  };
  const save = async () => {
    if (busy) return;
    setBusy("正在保存");
    setError("");
    try {
      await saveCurrent();
      setToast("已保存到浏览器书库");
    } catch (e) {
      reportError(e);
    } finally {
      setBusy("");
    }
  };
  const showPreview = async (id = previewSection || section?.id || "") => {
    if (!detail || busy) return;
    setBusy("正在生成预览");
    setError("");
    try {
      const saved = await saveCurrent();
      setPreview(await workspace.preview(saved.project.id, saved.revision, id));
      setPreviewSection(id);
      setTab("preview");
    } catch (e) {
      reportError(e);
    } finally {
      setBusy("");
    }
  };
  const showOriginal = async (number = pdfPage) => {
    if (!detail || busy) return;
    setPdfPage(number);
    setTab("original");
    if (pdf) return;
    setBusy("正在读取原稿");
    setError("");
    try {
      setPdf(await workspace.pdf(detail.project.id));
    } catch (e) {
      reportError(e);
    } finally {
      setBusy("");
    }
  };
  const importFile = async () => {
    if (!file || busy) return;
    if (file.size > 32 * 1024 * 1024) {
      setError("PDF 文件不能超过 32 MB。");
      return;
    }
    setBusy("正在提取文字");
    setError("");
    try {
      const result = await workspace.import(file, language, password, setBusy);
      adopt(result);
      setTab("structure");
      setDialog(null);
      setFile(null);
      setPassword("");
      setConfirmed(false);
      setToast("文字已提取");
    } catch (e) {
      reportError(e);
    } finally {
      setBusy("");
    }
  };
  const review = async () => {
    if (!detail || busy || !confirmed) return;
    setBusy("正在核验来源");
    setError("");
    try {
      const saved = await saveCurrent();
      const reviewed = await workspace.review(
        saved.project.id,
        saved.revision,
        resolutions,
      );
      adopt(reviewed, true);
      setToast("复核完成");
    } catch (e) {
      reportError(e);
    } finally {
      setBusy("");
    }
  };
  const runExport = async () => {
    if (!detail || busy) return;
    setBusy("正在制作与校验");
    setError("");
    setExportResult(null);
    try {
      const saved = await saveCurrent();
      const result = await workspace.export(
        saved.project.id,
        saved.revision,
        exportDraft,
      );
      setExportResult(result);
      setDetail((current) =>
        current ? { ...current, validation: result } : current,
      );
    } catch (e) {
      reportError(e);
    } finally {
      setBusy("");
    }
  };
  const download = async () => {
    if (!detail || !exportResult?.can_download || busy) return;
    setBusy("正在下载");
    try {
      downloadBlob(
        await workspace.download(detail.project.id, exportResult.export_id),
        exportResult.filename,
      );
    } catch (e) {
      reportError(e);
    } finally {
      setBusy("");
    }
  };
  const pickFile = (selectedFile: File | null) => {
    if (!selectedFile) return;
    if (!ready) return;
    if (dirty && !confirm("放弃尚未保存的修改并导入新书？")) return;
    setFile(selectedFile);
    setPassword("");
    setError("");
    setDialog("import");
  };
  const moveBlock = (direction: number) => {
    if (!section) return;
    const next = selected + direction;
    if (next < 0 || next >= section.blocks.length) return;
    mutate((draft) => {
      const blocks = draft.sections.find((s) => s.id === section.id)!.blocks;
      [blocks[selected], blocks[next]] = [blocks[next], blocks[selected]];
    });
    setSelected(next);
    setPage(Math.floor(next / 40));
  };
  const selectSection = (id: string) => {
    if (innerWidth <= 840) setShowLeft(false);
    setSectionId(id);
    setSelected(0);
    setPage(0);
    setPreviewSection(id);
    if (tab === "preview") setTab("structure");
  };
  const closeDialog = () => {
    if (!busy) {
      setDialog(null);
      setError("");
    }
  };
  const editedState = dirty
    ? "未保存"
    : book?.review.status === "reviewed"
      ? "已复核"
      : "草稿";

  return (
    <div
      className="epub-workspace"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (!busy) pickFile(event.dataTransfer.files[0]);
      }}
    >
      <input
        ref={backupInput}
        type="file"
        accept=".zip"
        className="hidden"
        aria-label="选择项目备份"
        onChange={async (event) => {
          const backup = event.target.files?.[0];
          event.target.value = "";
          if (
            !backup ||
            busy ||
            (dirty && !confirm("放弃尚未保存的修改并恢复备份？"))
          )
            return;
          setBusy("正在恢复项目");
          setError("");
          try {
            adopt(await workspace.restore(backup));
            setDialog(null);
            setTab("structure");
            setToast("项目备份已恢复");
          } catch (e) {
            reportError(e);
          } finally {
            setBusy("");
          }
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        aria-label="选择 PDF 文件"
        onChange={(event) => {
          pickFile(event.target.files?.[0] || null);
          event.target.value = "";
        }}
      />
      <header className="app-header">
        <button
          className="brand"
          onClick={() => {
            if (!dirty || confirm("放弃尚未保存的修改？")) {
              setDetail(null);
              setBook(null);
              setDirty(false);
            }
          }}
        >
          <BookOpen size={23} strokeWidth={1.8} />
          <span>PDF to EPUB</span>
        </button>
        <span className="header-divider" />
        <span className="header-context">制作工作台</span>
        <div className="header-actions">
          <button
            className={`connection ${ready ? "online" : ""}`}
            onClick={() => setDialog("storage")}
          >
            <span className="status-dot" />
            {ready ? "浏览器书库" : "书库未就绪"}
          </button>
          <button
            className="button primary small"
            disabled={!!busy || !ready}
            onClick={() => fileInput.current?.click()}
          >
            <Plus size={16} />
            导入 PDF
          </button>
        </div>
      </header>
      {!dialog && error && (
        <div className="error-bar" role="alert">
          <AlertTriangle size={17} />
          <span>{error}</span>
          <Tool label="关闭提示" onClick={() => setError("")}>
            <X size={16} />
          </Tool>
        </div>
      )}
      {!book || !detail ? (
        <main className="library">
          <div className="library-heading">
            <div>
              <p className="eyebrow">PDF to EPUB</p>
              <h1>书库</h1>
            </div>
            <div className="library-actions">
              <span className="muted">{projects.length} 本书籍</span>
              <Tool label="刷新书库" onClick={() => void refresh()}>
                <RefreshCw size={18} />
              </Tool>
            </div>
          </div>
          <div className="library-table-head">
            <span>书籍</span>
            <span>页数</span>
            <span>状态</span>
            <span>最近编辑</span>
          </div>
          {projects.map((project) => (
            <button
              className="project-row"
              key={project.id}
              onClick={() => void load(project.id)}
              disabled={!!busy}
            >
              <span className="project-title">
                <span className="book-glyph">
                  <BookMarked size={24} strokeWidth={1.4} />
                </span>
                <span>
                  <strong>{project.title}</strong>
                  <small>{project.author || project.filename}</small>
                </span>
              </span>
              <span>{project.pages}</span>
              <span>
                <span
                  className={`badge ${project.review_status === "reviewed" ? "success" : ""}`}
                >
                  {project.review_status === "reviewed" ? "已复核" : "草稿"}
                </span>
              </span>
              <time>
                {new Date(project.updated_at).toLocaleDateString("zh-CN")}
              </time>
            </button>
          ))}
          {projects.length === 0 && (
            <div className="empty-library">
              <img
                className="sample-page"
                src={import.meta.env.VITE_SAMPLE_IMAGE_URL || "/sample.png"}
                alt="The Art of Noticing 示例书页"
              />
              <h2>{ready ? "还没有书籍" : "正在打开书库"}</h2>
              <button
                className="button primary"
                disabled={!ready || !!busy}
                onClick={() => fileInput.current?.click()}
              >
                <FileUp size={18} />
                导入 PDF
              </button>
              <button
                className="text-command"
                disabled={!!busy || !ready}
                onClick={async () => {
                  setBusy("正在读取示例");
                  try {
                    const url =
                      import.meta.env.VITE_SAMPLE_URL || "/sample.pdf";
                    let sample: Blob;
                    if (url.startsWith("data:application/pdf;base64,")) {
                      const bytes = Uint8Array.from(
                        atob(url.split(",")[1]),
                        (char) => char.charCodeAt(0),
                      );
                      sample = new Blob([bytes], { type: "application/pdf" });
                    } else {
                      const response = await fetch(url, {
                        credentials: "omit",
                      });
                      if (!response.ok) throw new Error("示例文档暂不可用。");
                      sample = await response.blob();
                    }
                    pickFile(
                      new File([sample], "The Art of Noticing.pdf", {
                        type: "application/pdf",
                      }),
                    );
                    setLanguage("en");
                  } catch (e) {
                    reportError(e);
                  } finally {
                    setBusy("");
                  }
                }}
              >
                <BookOpen size={16} />
                打开示例书籍
              </button>
            </div>
          )}
          <div className="library-bottom">
            <span>
              <ShieldCheck size={16} />
              文件未上传
            </span>
            <a
              href="https://github.com/qar/pdf-to-epub#网页工作台"
              target="_blank"
              rel="noreferrer"
            >
              项目文档
              <ExternalLink size={14} />
            </a>
          </div>
        </main>
      ) : (
        <>
          <div className="document-bar">
            <button
              className="back-button"
              title="返回书库"
              onClick={() => {
                if (!dirty || confirm("放弃尚未保存的修改？")) {
                  setDetail(null);
                  setBook(null);
                  setDirty(false);
                }
              }}
            >
              <ArrowLeft size={18} />
            </button>
            <div className="document-name">
              <strong>{book.metadata.title}</strong>
              <span>
                {detail.project.filename} <span className="separator">/</span>{" "}
                {detail.project.pages} 页
              </span>
            </div>
            <span
              className={`badge ${book.review.status === "reviewed" && !dirty ? "success" : ""}`}
            >
              {editedState}
            </span>
            <div className="document-actions">
              <Tool
                label="撤销"
                disabled={!past.length || !!busy}
                onClick={undo}
              >
                <Undo2 size={18} />
              </Tool>
              <Tool
                label="重做"
                disabled={!future.length || !!busy}
                onClick={redo}
              >
                <Redo2 size={18} />
              </Tool>
              <span className="toolbar-rule" />
              <Tool
                label="保存"
                disabled={!dirty || !!busy || !ready}
                onClick={() => void save()}
              >
                <Save size={18} />
              </Tool>
              <button
                className="button primary small"
                disabled={!!busy || !ready}
                onClick={() => {
                  setDialog("export");
                  setExportDraft(book.review.status !== "reviewed" || dirty);
                  setError("");
                }}
              >
                <Download size={16} />
                导出 EPUB
              </button>
            </div>
          </div>
          <div
            className={`workspace-grid ${showLeft ? "" : "hide-left"} ${showRight ? "" : "hide-right"}`}
          >
            <aside className={`chapters ${showLeft ? "" : "collapsed"}`}>
              <div className="panel-heading">
                <h2>目录</h2>
                <span>{book.sections.length}</span>
                <Tool label="收起目录" onClick={() => setShowLeft(false)}>
                  <X size={15} />
                </Tool>
              </div>
              <nav className="chapter-list" aria-label="章节目录">
                {book.sections.map((item, index) => (
                  <button
                    className={`chapter ${item.id === section?.id ? "selected" : ""}`}
                    key={item.id}
                    onClick={() => selectSection(item.id)}
                  >
                    <span className="chapter-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="chapter-name">
                      {item.title}
                      <small>{item.blocks.length} 段</small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </nav>
              <div className="chapter-actions">
                <Tool
                  label="章节上移"
                  disabled={
                    !section || book.sections[0].id === section.id || !!busy
                  }
                  onClick={() =>
                    mutate((draft) => {
                      const i = draft.sections.findIndex(
                        (s) => s.id === section!.id,
                      );
                      [draft.sections[i - 1], draft.sections[i]] = [
                        draft.sections[i],
                        draft.sections[i - 1],
                      ];
                    })
                  }
                >
                  <ArrowUp size={16} />
                </Tool>
                <Tool
                  label="章节下移"
                  disabled={
                    !section ||
                    book.sections.at(-1)?.id === section.id ||
                    !!busy
                  }
                  onClick={() =>
                    mutate((draft) => {
                      const i = draft.sections.findIndex(
                        (s) => s.id === section!.id,
                      );
                      [draft.sections[i + 1], draft.sections[i]] = [
                        draft.sections[i],
                        draft.sections[i + 1],
                      ];
                    })
                  }
                >
                  <ArrowDown size={16} />
                </Tool>
                <button
                  className="text-command"
                  disabled={!block || !!busy}
                  onClick={() => {
                    setField("");
                    setDialog("chapter");
                  }}
                >
                  <Plus size={16} />
                  分章
                </button>
              </div>
              <div className="chapter-footer">
                <span>
                  {detail.source.units.length.toLocaleString()} 个来源片段
                </span>
                <button onClick={() => setDialog("omissions")}>
                  已排除 {book.omissions.length} 项<ChevronRight size={14} />
                </button>
              </div>
            </aside>
            <main className="editor-main">
              <div className="editor-toolbar">
                <Tool
                  label="切换目录"
                  active={showLeft}
                  onClick={() => {
                    setShowLeft((value) => !value);
                    if (innerWidth <= 840) setShowRight(false);
                  }}
                >
                  <PanelLeft size={17} />
                </Tool>
                <div className="view-tabs" role="tablist" aria-label="编辑视图">
                  <button
                    role="tab"
                    aria-selected={tab === "structure"}
                    onClick={() => setTab("structure")}
                  >
                    <LayoutList size={16} />
                    结构
                  </button>
                  <button
                    role="tab"
                    aria-selected={tab === "preview"}
                    disabled={!!busy}
                    onClick={() => void showPreview(section?.id)}
                  >
                    <BookOpen size={16} />
                    排版
                  </button>
                  <button
                    role="tab"
                    aria-selected={tab === "original"}
                    disabled={!!busy}
                    onClick={() => void showOriginal()}
                  >
                    <Columns2 size={16} />
                    原稿
                  </button>
                </div>
                <div className="editor-toolbar-end">
                  <Tool
                    label="切换属性"
                    active={showRight}
                    onClick={() => {
                      setShowRight((value) => !value);
                      if (innerWidth <= 840) setShowLeft(false);
                    }}
                  >
                    <PanelRight size={17} />
                  </Tool>
                </div>
              </div>
              {tab === "structure" && (
                <>
                  <div className="section-toolbar">
                    <input
                      aria-label={
                        section?.title_sources?.length ? "目录标题" : "章节名称"
                      }
                      className="section-title-input"
                      value={section?.title || ""}
                      disabled={!!busy}
                      onChange={(event) =>
                        mutate((draft) => {
                          draft.sections.find(
                            (s) => s.id === section!.id,
                          )!.title = event.target.value;
                        })
                      }
                    />
                    <label className="search-field">
                      <Search size={15} />
                      <input
                        aria-label="搜索正文"
                        placeholder="搜索正文"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="block-actions">
                    <span>{block ? `第 ${selected + 1} 段` : "章节标题"}</span>
                    <div>
                      <Tool
                        label="段落上移"
                        onClick={() => moveBlock(-1)}
                        disabled={selected <= 0 || !!busy || !block}
                      >
                        <ArrowUp size={16} />
                      </Tool>
                      <Tool
                        label="段落下移"
                        onClick={() => moveBlock(1)}
                        disabled={
                          !section ||
                          selected >= section.blocks.length - 1 ||
                          !!busy
                        }
                      >
                        <ArrowDown size={16} />
                      </Tool>
                      <Tool
                        label="与下一段合并"
                        disabled={
                          !section ||
                          selected >= section.blocks.length - 1 ||
                          !!busy
                        }
                        onClick={() =>
                          operation(() =>
                            mergeBlock(book, section!.id, selected),
                          )
                        }
                      >
                        <Merge size={16} />
                      </Tool>
                      <Tool
                        label="设为章节标题"
                        disabled={!block || !!busy}
                        onClick={() =>
                          operation(() =>
                            promoteTitle(
                              book,
                              section!.id,
                              selected,
                              textOf(block!).slice(0, 140),
                            ),
                          )
                        }
                      >
                        <BookMarked size={16} />
                      </Tool>
                      <Tool
                        label="排除此段"
                        disabled={!block || !!busy}
                        onClick={() => {
                          setField("");
                          setDialog("omit");
                        }}
                      >
                        <Trash2 size={16} />
                      </Tool>
                    </div>
                  </div>
                  <div className="block-list" ref={listRef}>
                    {section?.title_sources?.length ? (
                      <div className="source-heading">
                        <span className="eyebrow">章节标题</span>
                        <h2>
                          <SourceText
                            ids={section.title_sources}
                            units={units}
                          />
                        </h2>
                      </div>
                    ) : null}
                    {visible.map(({ item, index }) => (
                      <button
                        className={`block-row ${selected === index ? "selected" : ""} kind-${item.kind}`}
                        key={`${section?.id}-${index}-${blockSources(item)[0]}`}
                        onClick={() => {
                          setSelected(index);
                          setInspector("paragraph");
                        }}
                      >
                        <span className="block-meta">
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <span>{kinds[item.kind]}</span>
                          <span>
                            第 {units.get(blockSources(item)[0])?.page || 1} 页
                          </span>
                        </span>
                        <span className="block-copy">
                          <SourceText ids={blockSources(item)} units={units} />
                        </span>
                      </button>
                    ))}
                    {!visible.length && (
                      <div className="empty-note">
                        {search ? "没有匹配的段落" : "此章节只有标题"}
                      </div>
                    )}
                  </div>
                  <footer className="page-controls">
                    <span>
                      {filtered.length
                        ? `${page * 40 + 1}–${Math.min((page + 1) * 40, filtered.length)}`
                        : "0"}{" "}
                      / {filtered.length} 段
                    </span>
                    <div>
                      <Tool
                        label="上一组段落"
                        disabled={page === 0}
                        onClick={() => {
                          setPage((value) => value - 1);
                          listRef.current?.scrollTo({ top: 0 });
                        }}
                      >
                        <ChevronLeft size={17} />
                      </Tool>
                      <Tool
                        label="下一组段落"
                        disabled={(page + 1) * 40 >= filtered.length}
                        onClick={() => {
                          setPage((value) => value + 1);
                          listRef.current?.scrollTo({ top: 0 });
                        }}
                      >
                        <ChevronRight size={17} />
                      </Tool>
                    </div>
                  </footer>
                </>
              )}
              {tab === "preview" && (
                <>
                  <div className="preview-toolbar">
                    <select
                      aria-label="预览章节"
                      value={previewSection || section?.id}
                      disabled={!!busy}
                      onChange={(event) => void showPreview(event.target.value)}
                    >
                      <option value="title">扉页</option>
                      <option value="contents">目录页</option>
                      {book.sections.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
                        </option>
                      ))}
                    </select>
                    <div className="device-tools">
                      <Tool
                        label="手机宽度"
                        active={previewWidth === 390}
                        onClick={() => setPreviewWidth(390)}
                      >
                        <Smartphone size={17} />
                      </Tool>
                      <Tool
                        label="平板宽度"
                        active={previewWidth === 540}
                        onClick={() => setPreviewWidth(540)}
                      >
                        <Tablet size={17} />
                      </Tool>
                      <Tool
                        label="宽屏预览"
                        active={previewWidth === 680}
                        onClick={() => setPreviewWidth(680)}
                      >
                        <Monitor size={17} />
                      </Tool>
                      <Tool
                        label="刷新排版"
                        disabled={!!busy}
                        onClick={() => void showPreview()}
                      >
                        <RefreshCw size={17} />
                      </Tool>
                    </div>
                  </div>
                  <div className="preview-surface">
                    {preview ? (
                      <EpubPreview html={preview} width={previewWidth} />
                    ) : (
                      <div className="empty-note">
                        <BookOpen size={30} />
                        <span>排版预览待更新</span>
                        <button
                          className="button"
                          onClick={() => void showPreview()}
                          disabled={!!busy}
                        >
                          生成预览
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
              {tab === "original" && (
                <>
                  <div className="preview-toolbar">
                    <span className="muted">原始 PDF</span>
                    <div className="page-input">
                      <Tool
                        label="上一页"
                        disabled={pdfPage <= 1}
                        onClick={() => setPdfPage((value) => value - 1)}
                      >
                        <ChevronLeft size={17} />
                      </Tool>
                      <input
                        aria-label="PDF 页码"
                        type="number"
                        min={1}
                        max={detail.project.pages}
                        value={pdfPage}
                        onChange={(event) =>
                          setPdfPage(
                            Math.max(
                              1,
                              Math.min(
                                detail.project.pages,
                                Number(event.target.value) || 1,
                              ),
                            ),
                          )
                        }
                      />
                      <span>/ {detail.project.pages}</span>
                      <Tool
                        label="下一页"
                        disabled={pdfPage >= detail.project.pages}
                        onClick={() => setPdfPage((value) => value + 1)}
                      >
                        <ChevronRight size={17} />
                      </Tool>
                    </div>
                  </div>
                  <div className="original-surface">
                    {pdf ? (
                      <PdfPage data={pdf} page={pdfPage} />
                    ) : (
                      <div className="empty-note">正在读取原稿</div>
                    )}
                  </div>
                </>
              )}
            </main>
            <aside className={`inspector ${showRight ? "" : "collapsed"}`}>
              <div className="inspector-tabs">
                <Tool label="收起属性" onClick={() => setShowRight(false)}>
                  <X size={15} />
                </Tool>
                <button
                  className={inspector === "book" ? "selected" : ""}
                  onClick={() => setInspector("book")}
                >
                  <Settings2 size={16} />
                  书籍
                </button>
                <button
                  className={inspector === "paragraph" ? "selected" : ""}
                  onClick={() => setInspector("paragraph")}
                >
                  <Type size={16} />
                  段落
                </button>
                <button
                  className={inspector === "review" ? "selected" : ""}
                  onClick={() => setInspector("review")}
                >
                  <ShieldCheck size={16} />
                  复核
                  {warnings.length > 0 && (
                    <span className="count">{warnings.length}</span>
                  )}
                </button>
              </div>
              <div className="inspector-content">
                {inspector === "book" && (
                  <>
                    <h3>书籍信息</h3>
                    <label className="field">
                      书名
                      <input
                        value={book.metadata.title}
                        disabled={!!busy}
                        onChange={(event) =>
                          mutate((draft) => {
                            draft.metadata.title = event.target.value;
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      作者
                      <input
                        value={book.metadata.author}
                        disabled={!!busy}
                        placeholder="作者"
                        onChange={(event) =>
                          mutate((draft) => {
                            draft.metadata.author = event.target.value;
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      语言
                      <select
                        value={book.metadata.language}
                        disabled={!!busy}
                        onChange={(event) =>
                          mutate((draft) => {
                            draft.metadata.language = event.target.value;
                          })
                        }
                      >
                        <option value="en">English</option>
                        <option value="zh-Hans">简体中文</option>
                        <option value="zh-Hant">繁體中文</option>
                        <option value="ja">日本語</option>
                        <option value="fr">Français</option>
                        <option value="und">未指定</option>
                      </select>
                    </label>
                    <div className="inspector-divider" />
                    <h3>版式</h3>
                    <div className="template-options">
                      {(["classic", "modern", "compact"] as const).map(
                        (template, i) => (
                          <button
                            key={template}
                            className={`template-option ${appearance.template === template ? "selected" : ""}`}
                            disabled={!!busy}
                            onClick={() =>
                              mutate((draft) => {
                                draft.appearance = {
                                  ...defaults,
                                  template,
                                  line_height:
                                    template === "compact" ? 1.35 : 1.5,
                                  indent: template === "modern" ? 0 : 1.25,
                                };
                              })
                            }
                          >
                            <span className={`type-sample ${template}`}>
                              Aa
                            </span>
                            <span>{["经典", "现代", "紧凑"][i]}</span>
                            {appearance.template === template && (
                              <Check size={12} />
                            )}
                          </button>
                        ),
                      )}
                    </div>
                    <label className="range-field">
                      <span>
                        正文比例
                        <output>{appearance.font_size.toFixed(2)}×</output>
                      </span>
                      <input
                        aria-label="正文比例"
                        type="range"
                        min="0.85"
                        max="1.4"
                        step="0.05"
                        value={appearance.font_size}
                        disabled={!!busy}
                        onChange={(event) =>
                          mutate((draft) => {
                            draft.appearance = {
                              ...appearance,
                              font_size: Number(event.target.value),
                            };
                          })
                        }
                      />
                    </label>
                    <label className="range-field">
                      <span>
                        行距<output>{appearance.line_height.toFixed(2)}</output>
                      </span>
                      <input
                        aria-label="行距"
                        type="range"
                        min="1.2"
                        max="2"
                        step="0.05"
                        value={appearance.line_height}
                        disabled={!!busy}
                        onChange={(event) =>
                          mutate((draft) => {
                            draft.appearance = {
                              ...appearance,
                              line_height: Number(event.target.value),
                            };
                          })
                        }
                      />
                    </label>
                    <label className="range-field">
                      <span>
                        首行缩进
                        <output>{appearance.indent.toFixed(2)} em</output>
                      </span>
                      <input
                        aria-label="首行缩进"
                        type="range"
                        min="0"
                        max="2"
                        step="0.25"
                        value={appearance.indent}
                        disabled={!!busy}
                        onChange={(event) =>
                          mutate((draft) => {
                            draft.appearance = {
                              ...appearance,
                              indent: Number(event.target.value),
                            };
                          })
                        }
                      />
                    </label>
                    <button
                      className="button full"
                      onClick={() => void showPreview(section?.id)}
                      disabled={!!busy}
                    >
                      <BookOpen size={16} />
                      查看排版
                    </button>
                  </>
                )}
                {inspector === "paragraph" &&
                  (block ? (
                    <>
                      <div className="inspector-subheading">
                        <h3>第 {selected + 1} 段</h3>
                        <span>{sources.length} 个来源片段</span>
                      </div>
                      <label className="field">
                        段落类型
                        <select
                          aria-label="段落类型"
                          value={block.kind}
                          disabled={!!busy}
                          onChange={(event) =>
                            mutate((draft) => {
                              const target = draft.sections.find(
                                (s) => s.id === section!.id,
                              )!.blocks;
                              const old = target[selected];
                              const kind = event.target.value as Block["kind"];
                              target[selected] = changeKind(old, kind);
                            })
                          }
                        >
                          {Object.entries(kinds).map(([kind, label]) => (
                            <option key={kind} value={kind}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="button full"
                        disabled={!!busy}
                        onClick={() => {
                          setField("");
                          setDialog("chapter");
                        }}
                      >
                        <Plus size={16} />
                        从此处分章
                      </button>
                      <div className="inspector-divider" />
                      <h3>来源行</h3>
                      <div className="source-lines">
                        {sources.map((id, index) => (
                          <div className="source-line" key={id}>
                            <div className="source-line-heading">
                              <button
                                onClick={() =>
                                  void showOriginal(units.get(id)?.page || 1)
                                }
                              >
                                第 {units.get(id)?.page} 页
                                <ExternalLink size={11} />
                              </button>
                              <span>
                                {index + 1} / {sources.length}
                              </span>
                            </div>
                            <p>{units.get(id)?.text}</p>
                            {index < sources.length - 1 && (
                              <div className="source-line-actions">
                                <select
                                  aria-label={`来源行 ${index + 1} 连接方式`}
                                  value={block.joins?.[id] || "auto"}
                                  disabled={!!busy || block.kind === "quote"}
                                  onChange={(event) =>
                                    mutate((draft) => {
                                      const target = draft.sections.find(
                                        (s) => s.id === section!.id,
                                      )!.blocks[selected];
                                      target.joins = {
                                        ...target.joins,
                                        [id]: event.target.value as
                                          "auto" | "space" | "none" | "line",
                                      };
                                    })
                                  }
                                >
                                  <option value="auto">自动连接</option>
                                  <option value="space">空格连接</option>
                                  <option value="none">直接连接</option>
                                  <option value="line">保留换行</option>
                                </select>
                                <Tool
                                  label={`在第 ${index + 1} 个来源片段后分段`}
                                  disabled={!!busy}
                                  onClick={() =>
                                    operation(() =>
                                      splitBlock(
                                        book,
                                        section!.id,
                                        selected,
                                        id,
                                      ),
                                    )
                                  }
                                >
                                  <Scissors size={14} />
                                </Tool>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="empty-note">选择一个段落</div>
                  ))}
                {inspector === "review" && (
                  <>
                    <div className="review-summary">
                      <span
                        className={`review-symbol ${book.review.status === "reviewed" && !dirty ? "complete" : ""}`}
                      >
                        {book.review.status === "reviewed" && !dirty ? (
                          <CheckCheck size={24} />
                        ) : (
                          <FileCheck2 size={24} />
                        )}
                      </span>
                      <h3>
                        {book.review.status === "reviewed" && !dirty
                          ? "复核已完成"
                          : "出版前复核"}
                      </h3>
                      <span>
                        {warnings.length} 项提取提醒 · {book.omissions.length}{" "}
                        项排除
                      </span>
                    </div>
                    {warnings.map((warning) => (
                      <div className="warning-item" key={warning.id}>
                        <div>
                          <AlertTriangle size={15} />
                          <strong>
                            {warningNames[warning.code] || "页面待核对"}
                          </strong>
                          <button
                            onClick={() => void showOriginal(warning.page)}
                          >
                            第 {warning.page} 页<ChevronRight size={12} />
                          </button>
                        </div>
                        <textarea
                          aria-label={`第 ${warning.page} 页 ${warningNames[warning.code] || "页面"}处理记录`}
                          placeholder="核对结果与处理记录"
                          value={resolutions[warning.id] || ""}
                          disabled={!!busy}
                          onChange={(event) =>
                            mutate((draft) => {
                              draft.review.resolutions = {
                                ...resolutions,
                                [warning.id]: event.target.value,
                              };
                            })
                          }
                          rows={2}
                        />
                      </div>
                    ))}
                    {!warnings.length && (
                      <p className="review-clear">
                        <CheckCircle2 size={16} />
                        未发现自动提取警告
                      </p>
                    )}
                    <button
                      className="review-link"
                      onClick={() => setDialog("omissions")}
                    >
                      检查排除项
                      <ChevronRight size={14} />
                    </button>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        disabled={!!busy}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      <span>已核对正文、章节和阅读顺序</span>
                    </label>
                    <button
                      className="button primary full"
                      disabled={
                        !confirmed ||
                        warnings.some((w) => !resolutions[w.id]?.trim()) ||
                        !!busy
                      }
                      onClick={() => void review()}
                    >
                      <CheckCheck size={16} />
                      完成复核
                    </button>
                  </>
                )}
              </div>
            </aside>
          </div>
          <footer className="status-bar">
            <span>
              <span className={`status-dot ${ready ? "green" : ""}`} />
              {busy || (ready ? "浏览器处理" : "书库未就绪")}
            </span>
            <span>
              {detail.source.units.length.toLocaleString()} 个文字片段
              <span className="separator">·</span>已排除 {book.omissions.length}{" "}
              个
            </span>
            <span>
              {dirty ? "有未保存修改" : `保存版本 ${detail.revision}`}
            </span>
          </footer>
        </>
      )}
      {busy && (
        <div className="busy-indicator" role="status">
          <Loader2 size={17} className="spin" />
          {busy}
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={16} />
          {toast}
        </div>
      )}
      {dialog === "storage" && (
        <Dialog title="浏览器书库" close={closeDialog} busy={!!busy}>
          <div className="connection-summary">
            <HardDrive size={20} />
            <strong>{persisted ? "已启用持久保存" : "标准保存"}</strong>
          </div>
          <p className="muted">
            清除网站数据会移除书库。项目备份包含原稿和校对进度。
          </p>
          <div className="tool-status">
            <button
              className="button"
              onClick={() =>
                downloadBlob(
                  new Blob([notices], { type: "text/plain;charset=utf-8" }),
                  "third-party-notices.txt",
                )
              }
            >
              <Download size={16} />
              第三方许可
            </button>
            <button
              className="button"
              disabled={!!busy || persisted}
              onClick={async () => {
                try {
                  const granted =
                    (await navigator.storage?.persist?.()) || false;
                  setPersisted(granted);
                  setToast(
                    granted ? "已启用持久保存" : "浏览器暂未授予持久保存",
                  );
                } catch (e) {
                  reportError(e);
                }
              }}
            >
              <HardDrive size={16} />
              保留书库
            </button>
            <button
              className="button"
              disabled={!!busy}
              onClick={() => backupInput.current?.click()}
            >
              <FolderOpen size={16} />
              恢复项目备份
            </button>
            {detail && (
              <button
                className="button"
                disabled={!!busy}
                onClick={async () => {
                  setBusy("正在备份项目");
                  try {
                    const saved = await saveCurrent();
                    const backup = await workspace.backup(saved.project.id);
                    downloadBlob(backup.blob, backup.filename);
                  } catch (e) {
                    reportError(e);
                  } finally {
                    setBusy("");
                  }
                }}
              >
                <Download size={16} />
                备份当前项目
              </button>
            )}
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-footer">
            {detail && (
              <button
                className="button"
                disabled={!!busy}
                onClick={async () => {
                  if (
                    !confirm("移除此书籍及其校对进度？已下载的备份不受影响。")
                  )
                    return;
                  setBusy("正在移除项目");
                  try {
                    await workspace.remove(detail.project.id);
                    setBook(null);
                    setDetail(null);
                    setDirty(false);
                    setDialog(null);
                    await refresh();
                  } catch (e) {
                    reportError(e);
                  } finally {
                    setBusy("");
                  }
                }}
              >
                <Trash2 size={16} />
                移除当前项目
              </button>
            )}
            <button
              className="button primary"
              onClick={closeDialog}
              disabled={!!busy}
            >
              完成
            </button>
          </div>
        </Dialog>
      )}
      {dialog === "import" && (
        <Dialog title="导入 PDF" close={closeDialog} busy={!!busy}>
          <div className="import-file">
            <FileText size={31} strokeWidth={1.4} />
            <div>
              <strong>{file?.name}</strong>
              <span>{((file?.size || 0) / 1024 / 1024).toFixed(2)} MB</span>
            </div>
            <Tool
              label="重新选择 PDF"
              onClick={() => fileInput.current?.click()}
              disabled={!!busy}
            >
              <FolderOpen size={18} />
            </Tool>
          </div>
          <label className="field">
            正文语言
            <select
              value={language}
              disabled={!!busy}
              onChange={(event) => setLanguage(event.target.value)}
            >
              <option value="en">English</option>
              <option value="zh-Hans">简体中文</option>
              <option value="zh-Hant">繁體中文</option>
              <option value="ja">日本語</option>
              <option value="und">未指定</option>
            </select>
          </label>
          <label className="field">
            打开密码 <span className="muted">可选</span>
            <input
              type="password"
              value={password}
              autoComplete="off"
              disabled={!!busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-footer">
            <span className="privacy-label">
              <ShieldCheck size={15} />
              文件留在本机
            </span>
            <button
              className="button primary"
              onClick={() => void importFile()}
              disabled={!file || !!busy}
            >
              {busy ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <FileUp size={16} />
              )}
              {busy || "提取文字"}
            </button>
          </div>
        </Dialog>
      )}
      {dialog === "chapter" && (
        <Dialog title="从选中段落开始新章节" close={closeDialog}>
          <label className="field">
            章节名称
            <input
              autoFocus
              value={field}
              onChange={(event) => setField(event.target.value)}
              placeholder="新章节"
            />
          </label>
          <div className="dialog-footer">
            <button className="button" onClick={closeDialog}>
              取消
            </button>
            <button
              className="button primary"
              disabled={!field.trim()}
              onClick={() => {
                if (book && section) {
                  operation(() =>
                    startSection(
                      book,
                      section.id,
                      selected,
                      field,
                      "chapter-" + crypto.randomUUID().slice(0, 8),
                    ),
                  );
                  setDialog(null);
                  setSelected(0);
                }
              }}
            >
              <Plus size={16} />
              创建章节
            </button>
          </div>
        </Dialog>
      )}
      {dialog === "omit" && (
        <Dialog title="排除选中段落" close={closeDialog}>
          <div className="omission-excerpt">{block && textOf(block)}</div>
          <label className="field">
            排除原因
            <textarea
              autoFocus
              rows={3}
              value={field}
              onChange={(event) => setField(event.target.value)}
              placeholder="例如：已核实为重复页眉"
            />
          </label>
          <div className="dialog-footer">
            <button className="button" onClick={closeDialog}>
              取消
            </button>
            <button
              className="button danger"
              disabled={!field.trim()}
              onClick={() => {
                if (book && section) {
                  operation(() => omitBlock(book, section.id, selected, field));
                  setDialog(null);
                  setSelected(0);
                }
              }}
            >
              <Trash2 size={16} />
              记录并排除
            </button>
          </div>
        </Dialog>
      )}
      {dialog === "omissions" && (
        <Dialog
          title={`排除记录 · ${book?.omissions.length || 0} 项`}
          close={closeDialog}
          wide
        >
          <div className="omissions-list">
            {book?.omissions.map((item, index) => (
              <div key={item.source}>
                <span className="muted">
                  第 {units.get(item.source)?.page} 页
                </span>
                <p>{units.get(item.source)?.text}</p>
                <small>{item.reason}</small>
                <button
                  className="text-command"
                  disabled={!!busy}
                  onClick={() =>
                    mutate((draft) => {
                      const [restored] = draft.omissions.splice(index, 1);
                      (
                        draft.sections.find((s) => s.id === section?.id) ||
                        draft.sections[0]
                      ).blocks.push({
                        kind: "paragraph",
                        sources: [restored.source],
                      });
                    })
                  }
                >
                  <Undo2 size={14} />
                  恢复至当前章节末尾
                </button>
              </div>
            ))}
            {!book?.omissions.length && (
              <div className="empty-note">没有排除的内容</div>
            )}
          </div>
        </Dialog>
      )}
      {dialog === "export" && (
        <Dialog title="导出 EPUB" close={closeDialog} busy={!!busy}>
          <div className="export-book">
            <BookOpen size={34} strokeWidth={1.3} />
            <div>
              <h3>{book?.metadata.title}</h3>
              <span>
                {book?.sections.length} 章 ·{" "}
                {detail?.source.units.length.toLocaleString()} 个来源片段
              </span>
            </div>
          </div>
          <div className="export-checks">
            <div>
              <span>文字来源</span>
              <span className="check-value">
                <Check size={15} />
                制作时检查
              </span>
            </div>
            <div>
              <span>内容复核</span>
              <span
                className={
                  book?.review.status === "reviewed" && !dirty
                    ? "check-value"
                    : "warning-value"
                }
              >
                {book?.review.status === "reviewed" && !dirty
                  ? "已完成"
                  : "尚未完成"}
              </span>
            </div>
            <div>
              <span>EPUBCheck</span>
              <span>5.4.0</span>
            </div>
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={exportDraft}
              disabled={!!busy}
              onChange={(event) => {
                setExportDraft(event.target.checked);
                setExportResult(null);
              }}
            />
            <span>导出排版草稿</span>
          </label>
          {!exportDraft && (book?.review.status !== "reviewed" || dirty) && (
            <button
              className="review-link"
              onClick={() => {
                setDialog(null);
                setInspector("review");
                setShowRight(true);
              }}
            >
              前往内容复核
              <ChevronRight size={15} />
            </button>
          )}
          {exportResult && (
            <div
              className={`export-result ${exportResult.status === "valid" ? "success" : ""}`}
              role="status"
            >
              {exportResult.can_download ? (
                <CheckCircle2 size={21} />
              ) : (
                <AlertTriangle size={21} />
              )}
              <div>
                <strong>
                  {exportResult.status === "valid"
                    ? "EPUBCheck 校验通过"
                    : exportResult.status === "draft"
                      ? "排版草稿已生成"
                      : exportResult.status === "unchecked"
                        ? "尚未执行 EPUBCheck"
                        : "校验未通过"}
                </strong>
                <span>{exportResult.filename}</span>
                {exportResult.validation.epubcheck.reason && (
                  <small>{exportResult.validation.epubcheck.reason}</small>
                )}
                {exportResult.validation.internal.errors.map((message) => (
                  <small key={message}>{message}</small>
                ))}
                {exportResult.validation.epubcheck.messages?.map(
                  (message, index) => (
                    <small key={index}>
                      {message.severity}: {message.message}
                    </small>
                  ),
                )}
                {exportResult.validation.epubcheck.report && (
                  <button
                    className="text-command"
                    onClick={() =>
                      downloadBlob(
                        new Blob([exportResult.validation.epubcheck.report!], {
                          type: "application/json",
                        }),
                        `${exportResult.filename}.report.json`,
                      )
                    }
                  >
                    <Download size={14} />
                    校验报告
                  </button>
                )}
              </div>
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-footer">
            <span className="privacy-label">
              <FileText size={15} />
              可重排文字
            </span>
            {exportResult?.can_download ? (
              <button
                className="button primary"
                disabled={!!busy}
                onClick={() => void download()}
              >
                <Download size={16} />
                下载 EPUB
              </button>
            ) : (
              <button
                className="button primary"
                disabled={
                  !!busy ||
                  (!exportDraft &&
                    (book?.review.status !== "reviewed" || dirty))
                }
                onClick={() => void runExport()}
              >
                {busy ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <FileCheck2 size={16} />
                )}
                {busy || "制作并校验"}
              </button>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
