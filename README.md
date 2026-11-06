# PDF to EPUB

把 PDF 制作为可搜索、可调字号的文字 EPUB。仓库包含网页工作台、agent skill，以及两者共用的 Python 转换核心。

目前提供原生文字提取、复制限制处理、段落候选、可编辑制作方案、出版物风格排版和 EPUBCheck 校验。章节与段落仍需要语义复核，首版不承诺任意 PDF 一键达到出版质量。

## 网页工作台

公开入口：[PDF to EPUB](https://xm5pvv.otimififi.site/)。网页由 Otimififi 提供。书籍由你电脑上的转换服务处理，文件不会上传到 Otimififi。

当前公开入口已发布，但完整应用仍受平台 CSP 限制。本机工作台可正常使用。平台所需变更见 [部署阻碍](docs/otimififi-platform-requirements.md)。

需要 Python 3.10+、Node.js 22.12+、Poppler 和 qpdf。正式导出还需要 Java 与完整的 [EPUBCheck 发行包](https://github.com/w3c/epubcheck/releases)。在仓库根目录安装并启动：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
npm --prefix web ci
npm --prefix web run build
.venv/bin/pdf-to-epub serve \
  --allowed-origin https://xm5pvv.otimififi.site \
  --epubcheck-jar /path/to/epubcheck.jar
```

打开公开入口，选择“连接本机”，在本机确认页完成连接。浏览器询问本地网络权限时允许连接。也可直接打开 [本机入口](http://127.0.0.1:48291)，无需外网配对。

工作台提供书库、PDF 导入、章节与段落整理、排除记录、原稿对照、经典／现代／紧凑版式和 EPUB 排版预览。正式下载需要内容复核与实际 EPUBCheck 通过。草稿导出会标记 `.draft.epub`。

默认工作目录是 `~/.local/share/pdf-to-epub`。用 `--data-dir` 指定其他目录，用 `--port` 更改端口。服务只监听 `127.0.0.1`。移动布局可用于窄窗口；手机上的 localhost 指手机自身，无法直接连接电脑服务。

详细架构、API、部署命令和验收方法见 [网页实现记录](docs/web-workspace.md)。

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

前端检查：

```bash
npm --prefix web test
npm --prefix web run format:check
npm --prefix web run build
```

启动本机服务后，在 `web` 中执行 `npx playwright install chromium` 和 `npm run smoke`，可复现浏览器验收。验收产物放在忽略的 `.work/browser`。开发与验收进展使用 `bd` 记录。

附带的 Source Serif 4 来自 [Adobe Source Serif](https://github.com/adobe-fonts/source-serif)，使用 [SIL Open Font License](skills/pdf-to-epub/scripts/pdf_epub/assets/fonts/OFL.txt)。
