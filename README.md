# PDF to EPUB

把 PDF 制作为可搜索、可调字号的文字 EPUB。仓库包含纯浏览器工作台、agent skill 和 Python 命令行工具。

目前提供原生文字提取、复制限制处理、段落候选、可编辑制作方案、出版物风格排版和 EPUBCheck 校验。章节与段落仍需要语义复核，首版不承诺任意 PDF 一键达到出版质量。

## 网页工作台

公开入口：[PDF to EPUB](https://xm5pvv.otimififi.site/)。网页由 Otimififi 提供。新版在浏览器内提取文字、校对、排版、执行 EPUBCheck 并导出，书籍不会上传。用户无需安装 Python、Java 或本机服务。

纯浏览器版通过 Otimififi Site 发布，适配现有站点策略。发布方式与验收记录见 [站点部署记录](docs/otimififi-platform-requirements.md)。

开发者可用 Node.js 24+ 在本机预览网页：

```bash
npm --prefix web ci
npm --prefix web run build
npm --prefix web run preview -- --port 5178 --strictPort
```

打开 [本地静态预览](http://127.0.0.1:5178)。该进程只提供应用资源，不处理书籍。页面加载后，即使断网也能完成制作；离线重新打开网页尚未提供安装式缓存。

工作台提供书库、PDF 导入、章节与段落整理、排除记录、原稿对照、经典／现代／紧凑版式和 EPUB 排版预览。正式下载需要内容复核与实际 EPUBCheck 通过。草稿导出会标记 `.draft.epub`。

书库保存在当前浏览器、当前网址的 IndexedDB 中。刷新后可以继续编辑。清除网站数据会移除书库。“浏览器书库”中可申请持久保存、下载项目备份、恢复备份和移除项目。备份包含原 PDF 和校对进度，不包含打开密码。每份 PDF 最大 32 MiB。

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

根目录 Python 包与独立 skill 使用同一份 `skills/pdf-to-epub/scripts/pdf_epub`。浏览器实现位于 `web/src/browser`，共用文档模型、CSS 和字体；对照测试检查正文、字形、标题连接和排版一致性。旧 Python 本机 API 保留兼容，网页不再调用它。

前端检查：

```bash
npm --prefix web test
npm --prefix web run format:check
npm --prefix web run build
```

启动上述静态预览后，在 `web` 中执行 `npx playwright install chromium` 和 `npm run smoke`，可复现浏览器验收。该脚本还需要 Python、qpdf；设置 `EPUBCHECK_JAR` 可与 Java 版交叉校验。验收产物放在忽略的 `.work/browser`。开发与验收进展使用 `bd` 记录。

附带的 Source Serif 4 来自 [Adobe Source Serif](https://github.com/adobe-fonts/source-serif)，使用 [SIL Open Font License](skills/pdf-to-epub/scripts/pdf_epub/assets/fonts/OFL.txt)。

浏览器校验使用 `epubcheck-standalone@5.4.0-build3`，这是第三方维护的 EPUBCheck 5.4.0 源码编译构建。许可与源码见 [第三方说明](web/licenses/SOURCES.md)，网页也可下载完整许可文本。
