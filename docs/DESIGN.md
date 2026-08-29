# Markdown Workspace 总体设计

## 1. 文档信息

| 字段 | 值 |
|---|---|
| 状态 | Approved design baseline 0.1 |
| 日期 | 2026-08-29 |
| 产品阶段 | 设计完成后进入技术验证 |
| 首发平台 | macOS |
| 后续平台 | Windows、Linux |
| 数据模型 | 本地 Markdown 文件为唯一真相 |

本文是项目设计总纲。详细行为和可执行契约位于分领域文档；发生冲突时，已接受的 ADR 优先于本文，领域契约优先于描述性示例。

### 1.1 规范词

本文档包使用以下词义：

- **MUST / 必须**：实现和评审不可违反。
- **MUST NOT / 禁止**：实现不可出现。
- **SHOULD / 应该**：默认遵守；偏离时必须在任务交接中说明原因。
- **MAY / 可以**：实现可选，不构成验收门禁。

文档优先级从高到低：

1. 已接受 ADR。
2. [01-product-ux.md](design/01-product-ux.md) 的用户可观察行为，以及 [03-domain-model-and-contracts.md](design/03-domain-model-and-contracts.md) 的数据/安全契约；二者冲突时必须阻断并同步修订，不能任选其一。
3. [REQUIREMENTS.md](REQUIREMENTS.md) 的工程需求与交叉映射。
4. 其他分领域设计。
5. 本总纲。
6. 实施计划和描述性示例。

聊天历史、代理记忆和临时评论不构成项目规范。

## 2. 产品定义

Markdown Workspace 是一个**可编辑的本地文档浏览器**，而不仅是 Markdown 渲染器。

核心体验由四部分组成：

1. Typora 风格的单画面 Markdown 编辑。
2. 浏览器风格的本地文档导航、Tab 和历史。
3. 面向文件与资产的可靠桌面能力。
4. 可承载搜索、图谱、Git 和 AI 等未来页面的资源路由系统。

## 3. 问题陈述

### 3.1 编辑与渲染割裂

传统双栏编辑器会重复占用空间并造成视线跳转。目标是在一个编辑画面中保持原文可编辑，同时让非活动 Markdown 元素以渲染结果显示。

### 3.2 图片粘贴有配置和安全摩擦

剪贴板截图应直接保存为普通图片文件并插入相对链接。未保存文档、写入失败、撤销、重做、并发粘贴都必须有确定行为。

### 3.3 文档之间缺乏浏览器语义

本地 Markdown 中存在大量导航和索引链接。普通点击应原地跳转，用户可以后退到精确阅读位置，也可以用修饰键在新 Tab 或未来分栏中打开。

### 3.4 视觉块缺少深度查看

Mermaid 和大图片在文内适宽后可能不可读。它们需要保留矢量质量的全屏缩放、平移、适应窗口和导出。

### 3.5 病态输入会拖死普通编辑器

十几 MiB 的单行 Base64 会触发多份字符串、DOM 和图片解码开销。产品不需要成为巨型文件编辑器，但必须在异常内容进入 WebView 前拦截，并提供安全处理路径。

## 4. 设计原则

### 4.1 Markdown 原文唯一

- EditorState.doc 是前端编辑期的唯一文本真相。
- AST、HTML、目录、链接索引和预览都是可重建派生数据。
- 未编辑文档直接保存必须字节一致。
- 不以富文本树或数据库格式替代用户的 Markdown 文件。

### 4.2 Tab 不等于文件

- DocumentSession 表示共享文档内容。
- Tab 表示一次独立浏览会话。
- NavEntry 表示一次导航目标及可恢复视图状态。
- 同一文件可以出现在多个 Tab 或 Pane，内容共享、视图独立。

### 4.3 重数据不穿越脆弱边界

- 图片、超大 data URI、修复重写尽量留在 Rust。
- IPC 使用窄接口、不透明句柄、版本化负载和明确上限。
- WebView 不获得任意文件系统或命令执行能力。

### 4.4 正常路径简单，异常路径隔离

- 绝大多数小文档走快速完整模式。
- 大文本关闭昂贵派生功能，但保留编辑、查找、保存。
- 病态长行或大 data URI 进入安全页面，不创建主编辑器。
- 不为低频异常自研 mmap 或分块文本编辑器。

### 4.5 扩展通过稳定内核接入

- 导航统一经过 ResourceRouter。
- 编辑扩展统一经过命令、BlockRenderer 和受控 EditorExtension。
- 文件能力统一经过 Rust capability API。
- 公共插件 API 在内部扩展点稳定之前不对外承诺。

## 5. 系统总览

~~~text
┌──────────────────────── Tauri Window ────────────────────────┐
│ React Shell                                                   │
│ ├─ Workspace / File Tree / Outline                           │
│ ├─ TabGroup / PaneLayout / NavigationController              │
│ ├─ ResourceRouter                                             │
│ ├─ DocumentSessionRegistry                                    │
│ └─ CodeMirror EditorView + visible BlockRenderers             │
│                         │ typed IPC                            │
├─────────────────────────┼──────────────────────────────────────┤
│ Rust Core               │                                      │
│ ├─ WorkspaceRegistry / scoped handles                          │
│ ├─ Document preflight / open / atomic save                     │
│ ├─ AssetService / clipboard image / staging                    │
│ ├─ File watcher / external change detection                    │
│ ├─ Recovery journal / session persistence                      │
│ └─ Safe repair / export                                        │
└────────────────────────────────────────────────────────────────┘
             │
             ├─ user .md files and assets/
             └─ app-local settings, cache and recovery data
~~~

## 6. 不可破坏的系统约束

以下约束视为实现期间的硬性不变量：

1. 任何本地文件打开前都必须经过 Rust 预检策略。
2. 任何图片粘贴都不得将 Base64 写入 Markdown。
3. 文件写入失败不得产生指向不存在资产的链接。
4. 历史记录不得保存完整文档副本。
5. 后退、前进与编辑 Undo、Redo 是两个独立系统。
6. 同一路径的可编辑文档只能有一个 DocumentSession。
7. 多个视图编辑同一会话时必须按 revision 顺序应用变更。
8. raw HTML、Mermaid SVG 和外部 URL 按不可信内容处理。
9. 慢加载、渲染和索引任务必须支持 generation 或 cancellation，迟到结果不得覆盖新状态。
10. dirty 文档即使没有可见 Tab 也不能被释放。
11. 插件或扩展不得绕过 ResourceRouter、DocumentSession 和 Rust capability 边界。
12. 任何跨模块契约变更必须更新领域文档、测试和 ADR。

## 7. 功能范围

### 7.1 P0：可用产品

- 打开文件和工作区、文件树、Outline、Quick Open。
- CodeMirror source-first 编辑，标题、强调、列表、链接、代码块、图片等基础显隐。
- GFM 表格可读、可回到源码编辑，保存零差异。
- 中文 IME、撤销重做、查找替换、亮暗主题。
- 本地相对链接和 heading anchor。
- 单击原地跳转；新 Tab；每 Tab 独立前进后退。
- 精确恢复文件、锚点、顶部可见块和光标。
- 截图保存到 assets 后插入相对链接。
- Mermaid 文内预览与全屏缩放平移。
- 原子保存、外部修改检测、崩溃恢复。
- 大文本模式和病态输入安全页面。

### 7.2 P1：高价值增强

- 右侧分栏与拖拽 Tab。
- Peek 快速预览。
- 反向链接、断链诊断、文件重命名后的链接修复。
- 工作区全文搜索。
- 真正的表格网格编辑浮层。
- 数学渲染、Focus Mode、Typewriter Mode。
- SVG、PNG、HTML、PDF 基础导出。
- 最近关闭 Tab、会话恢复、历史菜单。

### 7.3 P2：扩展平台

- 相关文档、知识图谱和高级索引。
- Git diff、历史版本和冲突合并。
- AI 引用、问答和基于工作区的检索。
- 内部插件 SDK 和受限第三方插件。
- Pandoc 导出矩阵、同步、协作和发布。

## 8. 非目标

- 第一版不复刻 Typora 全部 UI、主题 DOM 和导出格式。
- 第一版不支持协同富文本或云端文档数据库。
- 第一版不编辑任意百 MiB 或 GiB 文件。
- 第一版不提供 Base64 专用编辑器。
- 第一版不运行 Markdown 中的脚本或不受控 iframe。
- 第一版不允许插件获得任意 shell、网络和文件系统权限。
- 第一版不把每段文本转为永久块 ID。

## 9. 成功指标

### 9.1 正确性

- 真实回归语料打开后直接保存零差异。
- 本地链接、锚点、中文路径和重复标题解析符合约定。
- 任何失败的图片粘贴都不改变正文和 undo 栈。
- 异常退出后不会覆盖磁盘新版本或进入重复崩溃循环。

### 9.2 体验

- 真实最大约 243 KiB 文档冷开可交互目标小于 500 ms。
- 已缓存 Tab 切换目标小于 100 ms。
- 普通输入到绘制 p95 小于 50 ms，避免超过 100 ms 的主线程长任务。
- 前进后退恢复到此前阅读位置，而不是只回到文件顶部。

### 9.3 防护

- 10 MiB 普通多行 Markdown 在 2 秒内进入大文本模式并保持可编辑。
- 10 MiB 单行 Base64 在 1 秒内进入安全页面，正文不进入主 EditorView。
- 粘贴 10 MiB data URI 后，正文长度、dirty 状态和 undo 栈不变。

## 10. 文档导航

| 领域 | 文档 | 主要所有权 |
|---|---|---|
| 产品行为 | [01-product-ux](design/01-product-ux.md) | Product / UX |
| 需求追踪 | [REQUIREMENTS](REQUIREMENTS.md) | Product / QA |
| 当前状态 | [PROJECT_STATE](PROJECT_STATE.md) | Tech lead |
| 系统边界 | [02-system-architecture](design/02-system-architecture.md) | Architecture |
| 模型与 IPC | [03-domain-model-and-contracts](design/03-domain-model-and-contracts.md) | Core contracts |
| 编辑内核 | [04-editor-rendering](design/04-editor-rendering.md) | Editor |
| Tab 与链接 | [05-navigation-tabs](design/05-navigation-tabs.md) | Navigation |
| 文件与资产 | [06-file-assets-recovery](design/06-file-assets-recovery.md) | Native core |
| 性能安全 | [07-performance-security](design/07-performance-security.md) | Platform |
| 扩展点 | [08-extension-model](design/08-extension-model.md) | Extensions |
| 测试 | [09-testing-observability](design/09-testing-observability.md) | Quality |
| 交付 | [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md) | Tech lead |

## 11. 已确定决策

| ADR | 决策 |
|---|---|
| [0001](decisions/0001-application-stack.md) | Tauri 2 + React/TypeScript + CodeMirror 6 + Rust |
| [0002](decisions/0002-source-first-editor.md) | Markdown 文本为唯一编辑真相 |
| [0003](decisions/0003-session-tab-navigation-separation.md) | DocumentSession、Tab、NavEntry 分离 |
| [0004](decisions/0004-pathological-input-guard.md) | 预检、粘贴闸门和安全页面替代巨型编辑器 |

## 12. 当前开放问题

以下问题不阻塞技术验证，但进入对应阶段前必须通过 ADR 收束：

1. 数学渲染优先采用 MathJax 兼容性还是 KaTeX 性能。
2. P1 表格网格编辑采用独立浮层还是块级临时编辑器。
3. 工作区索引首版采用内存索引还是 SQLite FTS。
4. Linux 是否进入首个公开版本，或只作为持续构建目标。
5. P1 是否在 P0 源码显示之外提供净化后的 raw HTML 预览。

## 13. 变更流程

- 小型领域内部行为：修改对应设计文档并补测试。
- 跨领域接口或不变量：新增或替换 ADR。
- P0 范围变化：同时更新本文、产品规格和实施计划。
- 已冻结 IPC、持久化格式、资源 URI：必须提供迁移方案和兼容测试。
- 代理开始任务前必须遵守根目录 AGENTS.md。
- 每个任务开始和结束必须更新 PROJECT_STATE.md；上下文压缩后不得根据聊天记录猜测进度。
- 实现、测试、任务卡和 ADR 必须引用稳定需求 ID。
