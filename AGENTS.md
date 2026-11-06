# 项目约定

回复与面向人的文档使用简体中文。使用 `bd` 跟踪工作；app 工作已记录为本地网页工具。

## 代码边界

`skills/pdf-to-epub/scripts/pdf_epub` 是唯一转换实现。根目录 Python 包从这里打包，skill 自带脚本也从这里导入。app 通过同一 API 或 CLI 调用，避免复制实现。

源 PDF、EPUB、密码文件、提取证据和个人书籍内容属于工作产物，放入临时目录或忽略的 `.work/`。测试使用自建文本。字体必须保留嵌入许可。

## 质量门禁

运行 `python3 -m unittest discover -s tests -v`。设置 `EPUBCHECK_JAR` 时包含实际合规检查。使用 coverage 检查核心覆盖率。转换成功同时要求文字完整性、结构复核、实际 EPUBCheck 和视觉检查；内部 ZIP 校验不是合规结论。

来源覆盖是制作边界：每个 source ID 恰好引用一次，或者带理由排除。修改模型时同时检查 skill 的模型参考与相应行为测试。
