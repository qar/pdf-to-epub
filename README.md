# PDF to EPUB

把 PDF 制作为可搜索、可调字号的文字 EPUB。仓库包含一个 agent skill，以及 skill 和后续本地网页 app 共用的 Python 转换核心。

目前提供原生文字提取、复制限制处理、段落候选、可编辑制作方案、出版物风格排版和 EPUBCheck 校验。章节与段落仍需要语义复核，首版不承诺任意 PDF 一键达到出版质量。

## 使用 Skill

将 `skills/pdf-to-epub` 链接或复制到 agent 的 skills 目录。例如，在仓库根目录执行：

```bash
ln -s "$PWD/skills/pdf-to-epub" "$HOME/.codex/skills/pdf-to-epub"
```

已有同名目录时先检查它。新会话中可使用：

```text
使用 $pdf-to-epub 将这份 PDF 转成文字 EPUB，按现代精装小说的风格排版。
```

Skill 包含脚本和所需模板，可独立复制使用。它不会上传书籍内容。

## 命令行

需要 Python 3.10+。macOS 的提取依赖可用 `brew install poppler qpdf` 安装。正式校验还需要 Java 和 [EPUBCheck](https://github.com/w3c/epubcheck/releases)，下载后保留完整的发布目录。

```bash
python3 skills/pdf-to-epub/scripts/epub.py doctor
python3 skills/pdf-to-epub/scripts/epub.py extract input.pdf --work-dir .work/book --language en
```

检查 `.work/book/source.json` 的文字与警告，编辑 `book.json` 的章节和段落。每个文字片段都必须被使用一次，或明确记录排除理由。完成复核后将 `review.status` 设为 `reviewed`。

```bash
python3 skills/pdf-to-epub/scripts/epub.py build .work/book/book.json --output .work/book.typeset.epub
python3 skills/pdf-to-epub/scripts/epub.py validate .work/book.typeset.epub --epubcheck-jar /path/to/epubcheck.jar
```

预览草稿时使用 `build --allow-draft`。已有文件不会被覆盖。打开密码通过 `--password-file` 传入，原 PDF 保持不变。模型详见 [文档模型](skills/pdf-to-epub/references/document-model.md)。

命令向 stdout 返回 JSON。退出码 `0` 表示命令完成，`1` 表示输入、制作或校验失败，`2` 表示 EPUBCheck 尚未执行。`built` 表示完成打包；只有 `validate` 返回 `valid` 才表示通过内部检查与实际 EPUBCheck。`--internal-only` 只做有限的本地结构检查。

扫描件需要先执行 OCR。复杂表格、公式、插图、注释链接与逐字校订尚未自动化。不能通过封装页面图片来冒充文字 EPUB。

## 开发与测试

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
.venv/bin/python -m coverage run -m unittest discover -s tests -v
.venv/bin/python -m coverage report
```

设置 `EPUBCHECK_JAR` 后，测试会运行实际 EPUBCheck。涉及 PDF 的测试使用自建合成文本，不包含用户书籍。测试验证跨页续句、斜体、密码与复制限制、来源覆盖、原文件保护、目录与资源完整性。

根目录 Python 包与独立 skill 使用同一份 `skills/pdf-to-epub/scripts/pdf_epub`。源码布局是为了让 skill 可以独立复制，app 则可以通过 Python API 或 JSON 命令行接口调用同一核心。

后续 app 已确定采用本地网页工具：浏览器中校对和预览，文件在本机处理。当前仓库尚不包含 app 界面，相关工作使用 `bd` 跟踪。

附带的 Source Serif 4 来自 [Adobe Source Serif](https://github.com/adobe-fonts/source-serif)，使用 [SIL Open Font License](skills/pdf-to-epub/scripts/pdf_epub/assets/fonts/OFL.txt)。
