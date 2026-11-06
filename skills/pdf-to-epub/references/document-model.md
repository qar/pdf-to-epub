# 文档模型

`source.json` 是提取证据。`book.json` 是可编辑的制作方案。提取时写入源文件 SHA-256，制作时检查它。来源检查检查实际片段覆盖，不用“删掉空格和标点后相等”来证明内容相同。

## 制作方案

```json
{
  "version": 1,
  "source": "source.json",
  "source_sha256": "提取时生成的摘要",
  "metadata": {"title": "书名", "author": "作者", "language": "zh-Hans"},
  "review": {"status": "draft", "notes": [], "resolved_warnings": []},
  "sections": [{
    "id": "chapter-1",
    "title": "第一章",
    "kind": "chapter",
    "blocks": [{"kind": "paragraph", "sources": ["p0001-l0001", "p0001-l0002"]}]
  }],
  "omissions": []
}
```

`section.id` 使用 ASCII 字母开头的唯一标识符，后接字母、数字、`_` 或 `-`。`title` 和 `contents` 留给自动生成的扉页和目录。

章节 `kind` 支持 `chapter`、`part`、`preface`、`dedication`、`copyright-page`、`acknowledgments`、`afterword`、`appendix`、`notes`。章节标题进入目录，并在该章节开头显示。

原文中有章节标题时，在章节上添加 `title_sources` 数组，引用这些标题的源 ID。标题按源文字和字形显示，`title` 用作目录标签。不要再把这些 ID 放入正文块，否则会被识别为重复。只包含标题的篇章页可以使用空的 `blocks` 数组。

多行标题可以使用 `title_joins` 指定行连接方式，格式和正文块的 `joins` 相同。将正文提升为章节标题或替换已有标题时，应同时保留对应连接设置。

文字块 `kind` 支持 `paragraph`、`heading`、`source`、`verse`、`scene-break`、`signature`、`thought`。每块按 `sources` 的顺序读取源文字。`quote` 是引文容器，使用 `blocks` 子数组，而不是 `sources`。

```json
{
  "kind": "quote",
  "blocks": [
    {"kind": "source", "sources": ["p0007-l0001"]},
    {"kind": "paragraph", "sources": ["p0007-l0002", "p0008-l0001"]}
  ]
}
```

## 连接与排除

默认连接方式为 `auto`：普通英文行之间加入空格；相邻汉字或中文标点直接连接；行末连字符保留并接到下一行字母。该规则不判断连字符是否属于单词，复核时检查断词。

`joins` 以当前块中非最后一个源 ID 为键，指定该源之后的连接方式：`space` 加空格，`none` 直接连接，`line` 显式换行，`auto` 使用默认规则。诗行 `verse` 总是换行。

```json
{"kind":"paragraph","sources":["p0001-l0001","p0001-l0002"],"joins":{"p0001-l0001":"space"}}
```

排除内容必须说明原因。已经使用的 ID 不能再次排除。

```json
{"source":"p0002-l0001","reason":"已核实为重复页眉，正文中已有对应书名。"}
```

草稿不接受 `text` 或 `html` 字段替换源文。需要纠正 OCR 或拆分源片段时，重新生成经过核实的提取证据，保留原证据与变更记录，再更新方案的源路径和摘要。单纯为了通过校验而重算摘要会破坏来源证明。

## 复核状态

`review.status` 初始为 `draft`。完成章节、段落、阅读顺序和提取警告检查后设为 `reviewed`。`resolved_warnings` 列出逐项核实的警告 ID，`notes` 解释处理结果。

网页服务还保存 `review.resolutions`，以警告 ID 为键记录处理说明。修改制作方案后必须重新复核。

## 版式设置

可选的 `appearance` 字段控制正文版式。省略时沿用经典版式。

```json
{"appearance":{"template":"classic","font_size":1,"line_height":1.5,"indent":1.25}}
```

`template` 支持 `classic`、`modern`、`compact`。现代版使用系统无衬线字体，其余使用嵌入的 Source Serif。`font_size` 范围为 0.85 至 1.4，单位为 em；`line_height` 范围为 1.2 至 2；`indent` 范围为 0 至 2，单位为 em。数值必须有限。章首、诗行、署名等专门的缩进规则仍优先。

`build --allow-draft` 仍检查来源覆盖，但允许未复核的排版预览，返回 `draft_built`。正常制作返回 `built`，尚不表示 EPUBCheck 已通过。

首版模型处理文本结构和字形。它没有自动插图、表格、注释链接或 OCR 编辑器。遇到这些内容时，保留证据并完成专项处理；不能用排除项隐藏无法处理的正文。
