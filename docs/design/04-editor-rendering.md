# 编辑器与渲染设计

> 状态：Approved design baseline 0.1  
> 所有者：Editor / Rich Render  
> 主要需求：EDIT-LIVE-001、EDIT-UNDO-001、EDIT-IME-001、EDIT-LINK-001、EDIT-TABLE-001、EDIT-MERMAID-001、EDIT-MERMAID-002  
> 契约依赖：[03-domain-model-and-contracts.md](03-domain-model-and-contracts.md)

## 1. 目标

编辑器必须同时满足：

- Markdown 原文是唯一真相。
- 非活动内容具有 Typora 风格的渲染外观。
- 光标进入元素后可以可靠编辑原始语法。
- 中文输入、选区、撤销、复制粘贴行为可预测。
- 表格、链接密集文档和较大文档保持流畅。
- 未识别语法以普通文本保留，不得因打开和保存而丢失。

## 2. 核心结构

~~~text
EditorState.doc
    │
    ├─ Lezer incremental syntax tree
    ├─ active edit ranges
    ├─ visibleRanges
    └─ DecorationSet
          ├─ style marks
          ├─ hidden syntax markers
          ├─ inline widgets
          └─ block widgets: image / table / math / Mermaid
~~~

### 2.1 唯一真相

- 所有用户输入、Undo、Redo、保存均以 CodeMirror transaction 为准。
- 渲染结果不得反向修改文档。
- 格式化命令必须产生明确 ChangeSet。
- 只有用户主动修改的语法范围可以被规范化。
- 目录、链接、预览缓存可以随时丢弃重建。

### 2.2 派生状态

| 状态 | 作用 | 生命周期 |
|---|---|---|
| SyntaxTree | Markdown 结构 | CodeMirror 增量维护 |
| ActiveRanges | 当前应显示源码的安全范围 | 随选择和 composition 更新 |
| DecorationSet | 样式、隐藏标记和 Widget | 仅覆盖必要范围 |
| RenderCache | Mermaid、数学、图片元数据 | 以源码 hash、主题和版本为键 |
| Outline | 标题和位置 | 后台增量更新 |
| LinkIndexDelta | 当前文档出链变化 | 防抖后提交索引 |

## 3. 标记显隐状态机

每个可渲染语法节点有三种视觉状态：

1. **Rendered**：隐藏不必要标记，显示样式或 Widget。
2. **Editing**：显示完整、可安全编辑的 Markdown 源码范围。
3. **Invalid**：语法不完整或解析失败，按普通源码显示并提供轻量错误提示。

进入 Editing 的条件：

- 主选择或任一选区与节点源码范围相交。
- 节点处于输入法 composition 范围。
- 用户通过“编辑源码”命令激活 Widget。
- 节点包含尚未提交的异步操作占位。

退出 Editing 的条件：

- 所有选择离开该安全范围。
- composition 已结束。
- 节点语法重新解析成功。

安全范围必须覆盖完整结构。例如进入链接时展开整个 `[label](target)`；进入图片时展开完整图片语法；进入 fenced block 时展开 fence、语言标识和内容。不能只隐藏或展开光标旁单个标记，以免产生不可解释的光标位置。

## 4. 元素行为

| 元素 | 非活动状态 | 活动状态 | P0 说明 |
|---|---|---|---|
| 标题 | 隐藏井号并应用标题样式 | 显示完整井号和文本 | 保持源码行不变 |
| 强调/删除线 | 隐藏标记并应用样式 | 展开完整标记 | 嵌套时展开最小完整祖先 |
| 链接 | 显示 label 和链接样式 | 显示完整链接源码 | 渲染态单击导航；编辑态单击移动光标 |
| 图片 | 显示受限图片 Widget | 显示图片 Markdown | 错误图片显示占位和路径 |
| 列表/任务 | 样式化 marker 和 checkbox | 当前项显示原始 marker | Enter、Tab、Backspace 需单独测试 |
| 引用 | 样式化边线 | 当前块显示 marker | 多级引用保留层级 |
| 代码 | 行内样式或 fenced block | 编辑源码并高亮 | 未知语言仍可编辑 |
| 表格 | HTML table 预览 | P0 回到 pipe table 源码 | 见第 5 节 |
| 数学 | 数学 Widget | 显示公式源码 | P1，可配置渲染器 |
| Mermaid | SVG 预览 Widget | 显示 fenced source | P0 支持全屏查看 |
| raw HTML | P0 显示源码 | 始终可编辑源码 | P1 净化预览需另行决定 |

## 5. 表格设计

真实语料约 96% 文件包含 GFM 表格，因此表格不是边缘功能。

### 5.1 P0

- 非活动表格以 HTML table 显示。
- 点击单元格或“编辑源码”后，整个表格块回到原始 pipe table。
- 未修改表格不得重新格式化。
- Tab、Shift+Tab 在 P0 源码表格中遵循普通编辑器键位；逻辑单元格导航只属于 P1 structuredEditing。
- 支持复制渲染表格为 TSV 和复制源码两种命令。
- 超宽表格在块内横向滚动，不扩大整篇文档宽度。
- 超大表格只渲染可见行或退回源码卡片。

### 5.2 P1 网格编辑

采用独立浮层或块级 grid，而不是在 CodeMirror Widget 内嵌复杂 contenteditable。

提交规则：

1. 打开时解析当前表格块并记录原始文本、范围和 revision。
2. 用户在 grid 中修改局部数据。
3. 提交前确认表格块 revision 未冲突。
4. 仅替换该表格块，允许该块被规范化。
5. 取消时正文零变化。

rowspan、colspan 和单元格多块内容不属于 GFM，默认不得悄悄降级。

## 6. 中文 IME 与输入纪律

- composition 期间冻结当前语法节点的替换装饰。
- composition 期间不得执行 Markdown 自动转换、Widget 切换或格式化。
- 候选确认使用的 Enter、Space、数字键不得被快捷键抢占。
- compositionend 后在下一帧重新解析和生成装饰。
- macOS 拼音、Windows 微软拼音至少覆盖标题、列表、链接、表格、代码和标记边界。
- ViewPlugin 销毁或 Tab 切换不得中断未提交 composition；切换前显式完成或取消由平台测试决定。

## 7. 事务与命令

所有编辑命令统一返回可测试的 transaction spec：

~~~ts
interface EditorCommandContext {
  sessionId: string
  viewId: DocumentViewId
  revision: number
  selections: readonly SourceSelection[]
}

type EditorCommandResult =
  | { kind: "changes"; changes: readonly TextChange[]; selection?: SourceSelection }
  | { kind: "effect"; effect: EditorEffect }
  | { kind: "noop"; reason: string }
~~~

规则：

- 命令不得直接操作 DOM 内容。
- 文档变更必须标记 origin，例如 typing、paste-image、format、repair-sync。
- 多 View 同步变更不得重复进入发起 View 的 undo 历史。
- 导航命令不得进入编辑 undo 栈。
- 异步命令必须携带 sessionId、revision 和 cancellation token。

## 8. 粘贴管线

~~~text
capture paste
  ├─ image MIME → preventDefault → AssetService → insert link transaction
  ├─ large data URI → preventDefault → warning / externalize
  ├─ large plain text → confirmation / bounded insert
  └─ ordinary text or HTML → sanitize/normalize policy → transaction
~~~

编辑器 transaction filter 设置第二道长度和 data URI 闸门，防止插件、拖放或其他入口绕过 DOM paste handler。

## 9. 渲染器接口

内部块渲染器采用受控注册表，并直接使用 [08-extension-model.md](08-extension-model.md) 第 9 节的 canonical `BlockRenderer<Input, Output>`、`ReadonlySourceSlice`、`RendererLimits` 和结果包装。本章不重新定义第二套 parse/render 签名；Editor 只负责从当前视口生成只读 source slice、挂载宿主容器并在离开视口时 dispose。

P0 内置渲染器：

- image
- gfm-table
- mermaid
- code-block

Renderer 不可直接读取文件系统、发起任意网络请求或调用 Tauri IPC。资源读取通过受限 ResourceService。

## 10. Mermaid 与图片

- 仅进入可视区时渲染。
- 源码变化后防抖，旧任务取消。
- 缓存键包含源码 hash、主题、渲染器版本和安全配置。
- Mermaid 输出净化 SVG，并使用 strict 安全级别。
- 文内视图适宽；全屏视图保留 viewBox，P0 支持缩放、平移、Fit 和 100%，SVG/PNG 导出是 P1。
- 图片只允许 workspace asset、受控 app asset 和显式允许的远程协议。
- 大图片按解码像素预算加载缩略图；原图查看进入独立 viewer resource。

## 11. 性能规则

- Decoration 计算只遍历 visibleRanges 及必要边界。
- 不在每次输入后调用全文 toString、Markdown 全量解析或全文序列化。
- 目录、链接、lint 和导出放后台任务并可取消。
- Widget 以源码范围和 hash 复用，离开视口可释放 DOM。
- 大文本模式关闭软换行、拼写、图片、Mermaid 和高度变化装饰。
- 编辑器主线程出现超过 100 ms 任务视为性能缺陷。

## 12. 无障碍

- 渲染 Widget 必须提供可聚焦入口、aria-label 和“编辑源码”操作。
- 图片使用 Markdown alt 作为替代文本。
- Mermaid 提供标题、源码入口和可选文本描述。
- 链接在编辑态和渲染态的焦点行为必须可被键盘区分。
- 隐藏语法不得让屏幕阅读器得到与可编辑文本矛盾的内容；无障碍模式可选择总是显示源码。

## 13. P0 验收

1. 回归语料打开后直接保存零差异。
2. 中文输入法在六类关键节点中无丢字、重复或光标跳跃。
3. 标题、强调、链接、列表、代码块、图片的显隐状态可预测。
4. 真实最大表格文档冷开可交互小于性能预算。
5. 表格预览和源码切换不改变未编辑文本。
6. 100 个 Mermaid 块不会在文档打开时同时渲染。
7. 异常 Widget 只影响自身，不阻塞编辑器。
8. 大 data URI 无法通过 paste、drop 或扩展命令进入正文。
