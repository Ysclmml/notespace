# 编辑器与渲染设计

> 状态：Approved design baseline 0.3
>
> 所有者：Editor / Rich Render
>
> 决策来源：[ADR-0006](../decisions/0006-visual-editor-explicit-source-mode.md)
>
> 主要需求：EDIT-LIVE-001、EDIT-UNDO-001、EDIT-IME-001、EDIT-LINK-001、EDIT-TABLE-001、EDIT-MERMAID-001

本文件是编辑器实现的当前规范。旧的 CodeMirror decoration/source-first 方案已经退役，不再作为实现参考。

## 1. 产品行为

- `normal` 文档默认进入 Milkdown/ProseMirror 可视编辑器。
- 标题、列表、链接、图片、代码块、Mermaid 和 GFM 表格在可视模式始终保持结构化视觉形态；移动光标或选择内容不会展开 Markdown 源码。
- 用户只有通过工具栏“源码”或 `⌘/` 才进入 CodeMirror；`sourceOnly` 文档始终使用 CodeMirror。
- 可视与源码是同一 Markdown 正文的两个显式表面，不是同时挂载的两份编辑器，也不是分屏预览。
- 打开、导航、滚动、选择和切换模式不属于正文编辑，不得标记 dirty。

## 2. 当前结构

```text
DocumentSession.text (authoritative Markdown)
        │
        ├─ visual surface: Milkdown / ProseMirror / Crepe
        │     ├─ structured GFM table editing
        │     ├─ standard CommonMark image node
        │     └─ Mermaid fenced-block preview
        │
        └─ source surface: CodeMirror 6

Tab.ViewState
        ├─ editorMode
        ├─ visualScrollTop + visualSelection
        └─ sourceScrollTop + sourceSelection
```

每个 Tab 独立保存两个表面的滚动和选择。模式切换只卸载当前表面、挂载目标表面并恢复目标表面自己的位置，禁止用一份 `scrollTop` 互相覆盖。

## 3. Markdown 往返与保存

1. 打开文件时，`DocumentSession.text` 保留 Rust 返回的原始字符串。
2. 编辑器初始化、组件挂载和异步预览不得调用 `onChange`。
3. 每次真正的 ProseMirror 正文 transaction 必须同步序列化并调用 `onChange`；不能依赖 Milkdown 的防抖 listener，否则紧接着的 `⌘S` 可能漏字。
4. CodeMirror 正文 transaction 同样同步调用 `onChange`。
5. 外部 `value` 更新替换编辑器内容时不得进入 Undo history，也不得制造 dirty 回环。
6. 未发生正文 transaction 时，保存必须与打开字节级一致；首次正文编辑后允许 serializer 做语义等价的常规格式化，但不得改变图片 alt、链接目标、代码、表格数据或 Mermaid 源码。

当前同步序列化由 ProseMirror plugin 的 `appendTransaction` 完成。未来替换编辑器内核时也必须保留“正文 transaction 与待保存 Markdown 同步提交”的不变量。

## 4. 表格

- GFM pipe table 在可视模式解析为真实 table，单元格直接 contenteditable。
- 点击单元格、移动光标或滚动都不得切回 pipe 源码。
- 行列操作使用 Crepe table feature；超宽表格在块内横向滚动，不扩大整篇文档。
- 插入尺寸网格不是常驻 chrome，只在用户点击“插入表格”后临时出现。已有表格通过就地工具调整行列目标数量和当前列 alignment，并保留直接单元格编辑。
- 源码模式仍可直接编辑 pipe table。
- 表格编辑完成后 serializer 可以规范化分隔线与对齐空格，但必须保持行列、单元格文本和 alignment 语义。

## 5. 图片与截图粘贴

Crepe `ImageBlock` 7.22.1 会把独占段落图片的 Markdown alt 当作缩放比例并序列化成数值，存在语义数据损失，因此当前实现明确禁用它。

可视模式使用标准 CommonMark `imageSchema`，并只通过自定义 NodeView 改写 DOM 展示：

- ProseMirror node 的 `src`、`alt`、`title` 保持原始 Markdown 语义；
- DOM `src` 可解析为 Tauri 本地 asset URL，但序列化仍写原始相对路径；
- Markdown alt 同时作为图片替代文本；
- 单击图片或在图片上按 Enter/Space 打开统一 viewer，不修改正文；
- round-trip 测试必须覆盖 `![说明](relative.png)` 在编辑其他正文后仍保留 `说明`。

截图粘贴顺序固定为：

```text
paste 包含 image/*
  -> preventDefault
  -> Rust 从系统剪贴板读取并写入相邻 assets/
  -> Rust 成功返回相对 URI
  -> CommonMark insertImageCommand 插入一个正文 transaction
```

写入失败、取消或组件已经卸载时不插链接。产品路径不生成 Base64 Markdown。

## 6. Mermaid

- fenced `mermaid` 块在可视模式默认显示 SVG 预览；编辑图表源码只通过该块的明确按钮或全局源码模式进入。
- 每次预览调用先同步返回唯一 mount marker，异步 SVG 只能更新仍在 DOM 中的同一 marker。旧源码任务即使迟到，也不能覆盖新图或污染 viewer 的源码映射。
- viewer 源码只和当前可见预览按钮用 `WeakMap` 关联；不得永久缓存每次输入的整段 Mermaid 源码。
- 等待 marker 挂载必须可取消且有上限；编辑器卸载时释放 observer、timer 和异步落点。
- 单块失败只在该块显示错误，不切换整篇文档或阻止正文编辑。
- production Tauri CSP 允许 Mermaid SVG 所需的内联样式；远程脚本仍不开放。
- 当前版本会为 Crepe 已挂载的 Mermaid block 启动渲染。大量图表的视口虚拟化是后续性能项，文档不得声称已经实现。

## 7. 链接与导航

- 可视链接始终使用明显的蓝色下划线和 hover/focus 状态。
- 当前 Tab、后台新 Tab、前台新 Tab 的 disposition 由应用 Router 处理，编辑器不直接替换页面。
- 同页 heading、跨文件 heading 和 Outline 点击都生成一次性 reveal request；目标表面确认消费后必须删除，模式切换不得重放旧 reveal。
- 重复标题按 Markdown slug 顺序匹配 `title`、`title-1`、`title-2`。
- 同页锚点也是可后退导航，必须进入 Tab history。

## 8. IME、Undo 与输入纪律

- 中文 composition 由 ProseMirror/CodeMirror 原生 transaction 管线处理；业务层不得在 composition 中替换整个 DOM。
- 候选确认使用的 Enter、Space、数字键不得被全局命令抢占。
- 可视表面和源码表面各自维护编辑器 Undo；导航、滚动、reveal 和模式切换不进入正文 Undo。
- 全局 `⌘/` 在 window capture phase 拦截并停止传播，避免 CodeMirror 先执行 `Mod-/` 注释命令。
- 异步截图完成后按捕获的选区插入；未来支持长时间并发编辑时，应使用 transaction mapping 将该位置映射到最新文档。

## 9. 病态输入与大文档

- paste handler 在创建 transaction 前阻止超大 `data:image/...;base64` 文本。
- Rust 打开预检在正文进入 WebView 前识别病态长行/大 data URI；普通较大多行文本进入 `sourceOnly`，不创建 ProseMirror、图片或 Mermaid 组件。
- 这些是为避免真实卡死保留的少量实用护栏，不扩展成通用安全平台。

## 10. 测试与验收

自动化至少覆盖：

1. 初始化 Mermaid、图片和 table 不标 dirty。
2. 表格单元格输入后仍是 table，不出现 pipe 源码。
3. 图片 alt 往返不变，本地 URL 可展示，图片 viewer 有可达入口。
4. 截图先落盘后插入；失败不改变正文。
5. Mermaid A→B 快速变化时，迟到的 A 不得覆盖 B；observer 可取消且不泄漏源码缓存。
6. 可视/源码各自恢复滚动与选区；旧 reveal 不因模式切换重放。
7. 后台 Tab anchor 激活后定位正确；重复 slug 与同页 back/forward 正确。
8. `⌘/` 往返不修改正文、不标 dirty。
9. production `.app` 中 Mermaid 文字/节点清晰，图片与 Mermaid viewer 的 Fit、缩放、平移、Esc 正常。

真实工作文档只能做只读验收；截图写入 smoke 必须使用隔离临时工作区。
