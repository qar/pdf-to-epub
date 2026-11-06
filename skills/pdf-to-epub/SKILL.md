---
name: pdf-to-epub
description: "将 PDF 制作为可搜索、可调字号的文字 EPUB，恢复段落并按出版物风格排版。用于 PDF 转电子书或重做转换后的排版；扫描件先完成 OCR。"
---

# PDF 转 EPUB

交付可重排的文字 EPUB。图片可以保留为插图或封面，正文必须是文字。扫描件先做 OCR；图片页封装不满足文字转换要求。

本 skill 自带命令行工具和排版模板。`scripts/epub.py` 仅依赖 Python 标准库；PDF 提取调用本机 Poppler，权限限制由 qpdf 处理。以下命令中的 `<skill>` 指本文件所在目录。

## 提取与判断

1. 运行 `python3 <skill>/scripts/epub.py doctor`。按缺失项安装依赖；EPUBCheck 通过 `EPUBCHECK_JAR` 或 `--epubcheck-jar` 指定。环境配置见 [references/setup.md](references/setup.md)。
2. 用 `extract input.pdf --work-dir <新目录> --language <语言>` 生成 `source.json` 和 `book.json`。工具先读取原始文字层；复制限制阻止提取时，在临时副本上用 qpdf 解密。需要打开密码时使用 `--password-file`，凭据留在本机。
3. 检查 `source.json` 的页数、文字、字形、坐标与警告。`ocr_required` 表示没有可用文字层。逐页核对无文字页和 `page_images` 警告；有文字页码不代表扫描正文已提取。需要 OCR、遇到多栏或表格时读 [references/extraction.md](references/extraction.md)。

提取完成只得到草稿。段落候选不是已校对的出版结构。使用首、中、末页，以及所有警告页，核对阅读顺序和文字完整性。

## 结构与排版

编辑 `book.json` 前，读 [references/document-model.md](references/document-model.md)。各段引用稳定的源文本 ID；源证据保持不变。每个 ID 必须恰好使用一次，或出现在带理由的 `omissions` 中。只排除已核实的页码、重复页眉或重复字形。

依据内容分配章节、自然段、对白、引文、诗行和署名。接回跨页续句；保留斜体、粗体与原有文字。对行末连字符逐项判断，必要时指定连接方式。书名、作者、语言来自文档或用户；章节与引文区间来自当前书籍。

将原有章节标题的源 ID 放入章节的 `title_sources`，不要同时保留为正文块。这样标题只显示一次，并继续参加来源覆盖检查。

用户要求精装书或出版物风格时，读 [references/typography.md](references/typography.md)。默认模板适合文学作品，可按题材调整。正文词语校订与排版是不同工作；发现已有错字时如实说明，保留方言和刻意拼写。

只有实际检查后才将 `review.status` 改为 `reviewed`。把警告的处理结果写入 `review.notes`，在 `resolved_warnings` 中列出已核实的警告 ID。需要检查排版草稿时使用 `build --allow-draft`，并将输出标为预览。

## 制作与验收

```bash
python3 <skill>/scripts/epub.py build <工作目录>/book.json --output <新文件>.epub
python3 <skill>/scripts/epub.py validate <新文件>.epub --epubcheck-jar /path/to/epubcheck.jar
```

成品验收同时满足以下条件：

- 来源检查通过；正文没有未经说明的遗漏、重复或替换。
- EPUBCheck 实际执行并通过。`internal_passed` 与 `unchecked` 都不等于 EPUB 合规。
- 阅读器或浏览器截图中的扉页、章节页、正文、引文和特殊结构可读。至少检查窄屏、平板和放大字号；目录能跳转，已制作的注释能往返。
- 源文件保持不变，成品使用新的文件名。报告实际完成的检查及剩余限制。

脚本不会自动保证语义分段正确，也不会自动提供 OCR、逐字校订或复杂表格重建。对这些环节使用当前环境中合适的工具，完成后再进入成品验收。独立 app 与 skill 应共用 `scripts/pdf_epub`，避免维护两套转换逻辑。
