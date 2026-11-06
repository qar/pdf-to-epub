# 项目约定

回复与面向人的文档使用简体中文。使用 `bd` 跟踪工作。

## 代码边界

网页必须独立在浏览器运行。`web/src/browser` 负责 PDF.js 提取、IndexedDB 书库、EPUB 构建和 EPUBCheck。使用页面内计算与 Shadow DOM 预览，兼容 Otimififi Site 的现有策略。网页不调用本机转换服务，书籍不上传。

`skills/pdf-to-epub/scripts/pdf_epub` 是 CLI 与 skill 的 Python 实现。两个运行时共用文档模型、排版 CSS 和字体。调整正文连接或排版时，同时更新对照测试，防止两种输出漂移。

源 PDF、EPUB、密码文件、提取证据和个人书籍内容属于工作产物，放入临时目录或忽略的 `.work/`。测试使用自建文本。字体必须保留嵌入许可。

## 质量门禁

运行 `python3 -m unittest discover -s tests -v`。设置 `EPUBCHECK_JAR` 时包含实际合规检查。使用 coverage 检查核心覆盖率。转换成功同时要求文字完整性、结构复核、实际 EPUBCheck 和视觉检查；内部 ZIP 校验不是合规结论。

来源覆盖是制作边界：每个 source ID 恰好引用一次，或者带理由排除。修改模型时同时检查 skill 的模型参考与相应行为测试。

修改网页存储、保存版本、备份或下载时，读取 `docs/web-workspace.md`。前端运行 `npm --prefix web test`、`npm --prefix web run format:check` 和 `npm --prefix web run build`。涉及完整制作流程时运行其中的浏览器验收，包含断网制作和零后端请求检查。

通过 Otimififi Site 发布前，读取 `docs/otimififi-platform-requirements.md`，验证真实公开地址的 CSP 和完整流程。部署脚本仅发布应用资源与原创示例。EPUBCheck 的 JavaScript 包是第三方编译构建，保留许可证与源码链接，不称为 W3C 官方浏览器发行包。
