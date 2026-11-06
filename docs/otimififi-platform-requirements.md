# Otimififi Site 部署记录

2026-11-06，纯浏览器版已通过 Site API 发布为第 7 版，修复长章节预览的白底截断。真实公开网址的完整 Playwright 验收通过：文字 EPUB、实际 EPUBCheck、断网制作、刷新恢复、备份恢复均正常；后端请求与书籍上传均为 0。桌面、平板、手机的长短章节预览共六组检查通过。无需修改平台基础设施。

## 发布范围

通过 Otimififi Site API 发布现有站点 `xm5pvv`，首页 ID 为 `eafd635b-2a57-4349-89e2-d9c6059f2033`。不需要 Cloudflare 登录，不修改平台服务、数据库或路由。

应用与原创示例是公开资源。用户 PDF、校对内容、打开密码和导出文件均留在浏览器。

## 现有策略适配

站点当前的 CSP 允许内嵌脚本和样式，禁止跨域应用脚本、blob Worker 和 iframe。应用采用以下实现：

| 站点约束 | 应用实现 |
| --- | --- |
| 外部脚本只允许同源 | IIFE 构建经 gzip、base64 编码，通过 Site 的 inlineScripts 发布 |
| Worker 受限 | 使用 PDF.js 支持的页面内处理器，EPUBCheck 也在页面内执行 |
| iframe 被禁用 | 从真实 EPUB 生成预览，以 Shadow DOM 隔离样式 |
| 字体 URL 不允许 data | 从内嵌字体字节创建 FontFace，无网络请求 |
| connect-src 仅同源 | 示例 PDF 从内存解码；书籍制作不依赖网络 |

加载器使用浏览器原生 DecompressionStream 解压，再添加内嵌脚本。压缩后的源码不会被服务端模板解析为模板表达式。应用保持文字提取与真实 EPUBCheck 校验，不使用页面图片代替正文。

Vite 静态预览使用站点现有 CSP，供开发和 CI 验证。平台仍可能注入被自身 CSP 阻止的 Alpine 脚本；应用不依赖该脚本。

本站 description 保持空值，因为早期发布曾复现平台模板对非空描述返回 HTTP 500。

## 发布命令

环境提供 `OTIMIFIFI_API_BASE` 和 `OTIMIFIFI_ACCESS_TOKEN`。凭据不进入公开内容。脚本先查询站点和首页，再构建、更新草稿、提交版本、切换线上版本。

```bash
.venv/bin/python scripts/deploy_otimififi.py --website xm5pvv
```

发布回执写入忽略的 `.work/deployment.json`。包含版本、公开地址和构建摘要，不包含凭据。

## 公开验收

发布后必须从真实网址运行：

```bash
EPUB_APP_URL=https://xm5pvv.otimififi.site npm --prefix web run smoke
EPUB_APP_URL=https://xm5pvv.otimififi.site npm --prefix web run smoke:preview
```

验收包括示例打开、PDF 导入、原稿 canvas、EPUB 版式与字体、内容复核、浏览器 EPUBCheck、文字下载、断网制作、刷新恢复和备份导入。网络记录要求没有本机 API 请求和书籍上传。HTTP 200 或发布成功本身不算完成。

站点地址：`https://xm5pvv.otimififi.site`。首页地址：`https://xm5pvv.otimififi.site/`。
