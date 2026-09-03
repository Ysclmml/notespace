# ADR-0006：默认真可视编辑与显式源码模式

- 状态：Accepted
- 日期：2026-08-30
- 取代：ADR-0002
- 修订：ADR-0001、ADR-0005 中“CodeMirror 是普通文档唯一产品编辑内核”的部分；桌面容器、Rust 文件层与精简护栏不变

## 背景

CodeMirror decoration/Widget 版本已经证明能把非活动 Markdown 块渲染出来，但真实文档验收暴露了结构性问题：

- 光标进入标题、列表、链接、表格或代码块就展开 Markdown 标记，视觉形态与块高度频繁变化。
- 表格只是只读 Widget，点击后退回难读的管道源码，无法直接编辑单元格。
- 光标移动、滚轮和文件切换会互相影响，出现页面上下漂移或新文件停留在未渲染源码状态。
- 默认画面处于“阅读态和源码态之间”，不符合 Typora 式稳定可视编辑的产品目标。

这些问题不是继续增加 marker 隐藏规则可以可靠解决的。普通文档需要真正的结构化可视编辑器；精确源码编辑仍然重要，但必须成为用户主动选择的独立模式。

## 决策

### 1. 两个明确的编辑表面

- `normal` 文档默认进入 **可视模式**，由 Milkdown/ProseMirror 提供真正的 WYSIWYG 编辑。
- 可视模式中标题、强调、引用、列表、链接、代码块和 GFM 表格始终以其视觉结构编辑；光标、选择和 composition 不得自动展开 Markdown 标记。
- 工具栏提供明确的“可视 / 源码”切换；`⌘/` 可作为快捷键。只有用户执行该切换时，普通文档才进入 CodeMirror 源码模式。
- `sourceOnly` 是文件预检得出的性能降级模式，强制使用 CodeMirror；可视切换禁用并显示简短原因。
- `normal/sourceOnly` 是文件打开能力，`visual/source` 是 Tab 的编辑表面，两者不得共用一个含混的 `mode` 含义。

旧 `livePreview.ts` 的“活动块显示源码、非活动块显示 Widget”路线退役：它不得再作为普通文档默认编辑器、回退路径或新功能承载层。CodeMirror 只负责显式源码模式与 `sourceOnly` 文档。

### 2. Markdown 仍是唯一持久化真相

- 磁盘上的 Markdown 与相邻资源文件仍是唯一持久化真相；不引入专有富文本文件格式。
- 打开文件后保留原始 Markdown 字符串。仅打开、导航、选择、滚动、切换模式或关闭未编辑文件，不得触发序列化或 dirty，保存必须保持零差异。
- 可视模式首次发生正文变更后，ProseMirror 文档通过 Markdown serializer 回写 `DocumentSession`；从这次编辑开始，serializer 可以规范化整篇文档的等价 Markdown 表达。
- 不受当前 parser/serializer 支持的语法不能悄悄丢弃。至少要保持未编辑文件零差异，并允许用户切到源码模式处理；增加可视语法支持时用明确插件和 round-trip fixture 验证。

这里的“Markdown 是真相”是持久化与保存格式约束，不要求 CodeMirror 文本必须成为可视编辑时的交互 DOM 模型。

### 3. 同步更新不得让保存漏字

- 每个 ProseMirror 正文 transaction 必须在同一同步链路中完成 Markdown 序列化，并更新保存所读取的最新文本引用与 `DocumentSession`。
- 不允许用 200 ms（或其他时间）debounce 延后权威正文同步；用户输入后立刻按 `⌘S` 必须保存刚输入的字符。
- Outline、字数、搜索索引和其他可重建投影可以 debounce。保存前若仍有编辑器内部待提交状态，必须先同步 flush，再调用 Rust 原子保存。

### 4. 表格、链接与图表

- GFM 表格在可视模式中是真正的 ProseMirror table：单元格直接编辑，Tab/Shift-Tab 可在单元格间移动；只有进入源码模式才显示管道语法。高级增删行列/对齐工具可迭代，但不能用点击回源码代替单元格编辑。
- 链接采用明显的蓝色下划线样式。内部 Markdown 链接仍统一进入应用导航路由：普通点击当前 Tab，修饰键或中键按既有 disposition 打开新 Tab，不使用 `window.location`。
- Mermaid fenced block 在可视模式默认显示 SVG 预览并可进入缩放查看器；渲染失败显示就地错误，不导致整个文档切回源码。
- Mermaid 生成的 SVG 依赖内联样式。生产 Tauri CSP 允许 `style-src 'self' 'unsafe-inline'`，同时继续禁止远程脚本和文档上传；这是本地渲染兼容性设置，不扩展成通用安全框架。

### 5. Tab 级视图状态

- 编辑表面选择保存在当前 Tab 的 `ViewState`，不是共享 `DocumentSession` 的属性。两个 Tab 可以查看同一正文，但分别停留在可视或源码模式。
- `ViewState` 保存当前表面及其选择/滚动恢复信息；文件切换、back/forward 和 Tab 激活后恢复该 Tab 的状态。
- 新打开的 `normal` 文档默认 `visual`；新打开的 `sourceOnly` 文档固定 `source`。
- 模式切换不得制造导航历史项、正文 Undo transaction 或 dirty。

## 技术边界

运行时技术栈为 **React 19 + TypeScript + Milkdown/ProseMirror（默认可视编辑）+ CodeMirror 6（显式源码与 source-only）+ Tauri 2 + Rust**。Node 只用于构建、测试与轻量检查；不引入 Ruby。

建议的前端职责：

- `VisualMarkdownEditor`：Milkdown/ProseMirror 生命周期、Markdown parser/serializer、表格和可视节点。
- `SourceMarkdownEditor`：CodeMirror、source-only 和源码级粘贴护栏。
- `MarkdownEditor`：根据文档能力和 Tab `ViewState` 选择明确表面，并维护同步文本桥接。
- `viewer`：消费 Mermaid/图片渲染结果，不修改正文。

## 后果与代价

- 默认交互稳定，不再因光标经过结构块而发生高度跳变；表格可直接编辑。
- CodeMirror 与 ProseMirror 都需要维护，但二者不同时争夺同一 DOM，也不做逐帧双向光标同步。
- 首次可视正文编辑后可能产生整篇 Markdown 格式规范化；必须在产品说明和测试中接受这一边界。
- 模式切换需要 parser/serializer，选择位置只能尽量恢复到语义相近位置；每个表面自己的位置按 Tab 保留。
- Milkdown/ProseMirror 的 IME、Undo/Redo、表格和序列化成为编辑器回归重点。

## 被拒绝方案

- 继续给 CodeMirror live preview 增加 marker 显隐和块级 Widget：无法提供稳定的表格编辑与固定布局，已被真实验收否定。
- 点击任意渲染块后临时展开其 Markdown 源码：这正是滚动漂移和模式含混的根因。
- 可视和源码两个编辑器使用 200 ms 防抖同步：存在输入后立即保存漏掉最后字符的确定性风险。
- 将 ProseMirror JSON 保存为正文：破坏本地 Markdown 唯一持久化真相。

## 最低验证

1. 打开或切换不同普通文档后始终显示完整可视内容，标题、列表、链接和 fenced code 不泄露 Markdown 标记。
2. 光标穿过标题、列表、链接、代码和表格时块高度稳定，滚轮不因模式自动切换漂移。
3. 表格单元格可直接输入、选择、Tab 移动、Undo/Redo，并能保存与重开。
4. 可视输入一个字符后立即 `⌘S`，磁盘包含该字符；测试不得依赖等待 200 ms。
5. 未编辑文件切换模式再保存仍字节一致；首次可视正文编辑后的 serializer 结果可重开。
6. 每个 Tab 独立恢复可视/源码选择、滚动与导航历史；同一 session 的正文仍共享。
7. Mermaid 在 production CSP 下文字和节点颜色清晰，预览失败不影响正文，查看器缩放正常。
8. 链接有明显蓝色下划线，所有内部跳转 disposition 仍经过应用路由。

## 受影响需求

- `DATA-SOURCE-001`、`DATA-ROUNDTRIP-001`
- `EDIT-LIVE-001`、`EDIT-MODE-001`、`EDIT-SYNC-001`、`EDIT-TABLE-001`
- `NAV-VIEW-001`、`NAV-LINK-001`
- `DIAGRAM-MERMAID-001`、`PERF-TYPE-001`、`PERF-LAYOUT-001`
