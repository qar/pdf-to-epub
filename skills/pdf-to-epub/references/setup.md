# 本地工具

运行环境为 Python 3.10 或更新版本。转换核心没有 Python 第三方运行时依赖。输入文件留在本机。

macOS 使用 Homebrew 安装 PDF 工具：

```bash
brew install poppler qpdf
```

Linux 使用发行版提供的 `poppler-utils` 和 `qpdf`。`pdfinfo` 提供元数据；`pdftohtml` 提供文字坐标和字形；`pdftotext` 提供独立的文字顺序对照。

从 [W3C EPUBCheck 官方发布页](https://github.com/w3c/epubcheck/releases) 下载发布包。保留解压后的完整目录，JAR 需要同目录下的 `lib/`。使用该版本要求的 Java 运行时。

```bash
export EPUBCHECK_JAR=/path/to/epubcheck/epubcheck.jar
python3 /path/to/pdf-to-epub/scripts/epub.py doctor
```

如果系统已有 `epubcheck` 命令，可直接使用。工具以 `--failonwarnings` 运行校验；有警告时也会要求处理。内部校验只能发现 ZIP、XML、资源、导航和链接的常见问题。

`extract` 的工作目录包含书籍全文。使用临时目录或仓库忽略的 `.work/`。交付时只复制用户需要的成品，不把书籍、密码文件或提取材料提交到工具仓库。

Source Serif 4 字体随核心附带，许可证位于 `scripts/pdf_epub/assets/fonts/OFL.txt`。替换字体时确认嵌入许可，并随 EPUB 保留对应许可证。字体不是文字提取的前提。
