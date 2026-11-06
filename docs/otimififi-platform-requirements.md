# Otimififi 部署阻碍

2026-11-06，站点 `xm5pvv` 已完成页面发布。应用在本机通过文字 EPUB 导出、真实 EPUBCheck、加密原稿和响应式布局验收。公开站点尚不能运行完整应用，原因是平台的固定 CSP。

## 已复现的响应

```bash
curl -sS -D - -o /dev/null https://xm5pvv.otimififi.site/
```

当前响应中的策略：

```text
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline' https:;
img-src 'self' data: https:;
font-src 'self' https:;
connect-src 'self';
frame-src 'none';
object-src 'none';
base-uri 'self';
```

该策略来自 pageserver 的 `BaseHandler.prepare()`。它没有按站点选择策略的入口。草稿与公开页面上传成功不表示应用获得运行权限。

## 建议修改范围

给平台增加由管理员启用的 `local-workspace` 策略。初次只为 `xm5pvv` 启用，其他站点保留原策略。应用需要的差异如下：

| 指令 | 需要的能力 | 原因 |
| --- | --- | --- |
| `script-src` | 增加 `https://static.otimififi.com` | 加载平台自己托管的应用脚本 |
| `connect-src` | 增加 `http://127.0.0.1:*`、`http://localhost:*` | 连接用户选择的本机转换端口 |
| `worker-src` | 增加 `'self' blob:` | PDF.js 在内存 worker 中渲染原稿 |
| `frame-src` | 改为 `'self'` | 显示无脚本权限的 srcdoc EPUB 预览 |
| `font-src` | 增加 `data:` | 预览使用 EPUB 自带字体 |

继续保留 `object-src 'none'`、`base-uri 'self'`、`X-Frame-Options: DENY` 和现有权限限制。应用本机 API 的 Host、Origin、bearer token 与保存版本检查继续生效。此方案不要求修改数据库。

平台还应修复站点 `description` 非空时的 HTTP 500。线上文字模板引用了未传入渲染上下文的 `meta`。本站目前使用空描述，已验证状态从 500 变为 200。

## 平台修改后的验收

平台默认策略的回归测试必须覆盖非目标站点。启用本站策略后，从真实公开地址运行 `EPUB_APP_URL=https://xm5pvv.otimififi.site npm --prefix web run smoke`，验证配对、原稿 canvas、iframe 字体、复核、EPUBCheck 和下载。检查浏览器的书籍请求全部发送至 loopback。

当前仅提交应用仓库内的实现与需求记录。尚未修改、提交或部署 Otimififi 平台代码，也没有通过禁用浏览器安全策略伪造线上验收。
