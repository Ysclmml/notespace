# 规范化需求与追踪矩阵

状态：Approved design baseline 0.1  
日期：2026-08-29

## 1. 使用方式

本文件为持久化需求索引，服务于人类评审、自动化测试和上下文压缩后的代理执行。

- 每条需求拥有稳定 ID；修改描述不得复用 ID 表达不同含义。
- 删除需求时保留 ID 并标记 Superseded 或 Rejected。
- 实施任务、测试名称、PR/提交说明和 ADR 必须引用相关 ID。
- P0 是首个可用版本门禁；P1 是高价值增强；P2 是扩展方向。
- 验收证据记录到 PROJECT_STATE.md 或对应任务交接。

### 1.1 两层需求与唯一命名空间

- [01-product-ux.md](design/01-product-ux.md) 的 UX-* 是用户可观察行为的规范需求；UX-* 永远不是测试 ID。
- 本文件的 DATA/EDIT/NAV/FILE 等 ID 是跨模块工程约束与追踪入口。
- 端到端产品验收使用 AC-*；领域测试使用 RT/EDT/IME/TABLE/HISTORY 等第 8 节命名空间；跨语言/跨模块契约证据使用 CONTRACT-*。
- 用户可见任务必须同时引用相关 UX-* 与工程需求；若本节 crosswalk 明确写“产品直接验收”，则该项以 UX-* + 对应 AC-* 作为唯一例外。纯基础设施任务可以引用 ARCH/DOM/PROC 不变量及 phase gate。
- 01 的用户行为与 03 的数据/安全不变量都属于领域事实来源；若二者冲突，不得用文档排序猜测，必须阻断相关实现并由 Integration 同步修订需求/ADR。

### 1.2 产品需求交叉映射

“产品直接验收”表示该要求无需复制成第二条工程需求，仍由对应 UX-* 和 AC-* 直接作为门禁。

| 产品需求 | 工程需求或直接门禁 |
|---|---|
| UX-FILE-001 | DATA-SOURCE-001、DATA-UNKNOWN-001、FILE-OPEN-001 |
| UX-FILE-002 | DATA-ROUNDTRIP-001、DATA-UNKNOWN-001 |
| UX-EDIT-001 | EDIT-LIVE-001、DATA-UNKNOWN-001 |
| UX-EDIT-002 | EDIT-LIVE-001 |
| UX-EDIT-003 | EDIT-IME-001、EDIT-UNDO-001 |
| UX-DOC-001 | NAV-MODEL-001、DATA-REVISION-001 |
| UX-DRAFT-001 | FILE-DRAFT-001、RECOVERY-DIRTY-001 |
| UX-WORKSPACE-001 | NAV-WORKSPACE-001、FILE-WATCH-001、EXT-ROUTER-001 |
| UX-FIND-001 | EDIT-FIND-001 |
| UX-NAV-001 | EXT-ROUTER-001、NAV-DISPOSITION-001、NAV-ANCHOR-001 |
| UX-NAV-002 | NAV-HISTORY-001 |
| UX-NAV-003 | NAV-RESTORE-001、NAV-ASYNC-001 |
| UX-NAV-004 | NAV-DISPOSITION-001、EDIT-LINK-001 |
| UX-TAB-001 | NAV-MODEL-001、NAV-HISTORY-001 |
| UX-TAB-002 | NAV-MODEL-001、RECOVERY-DIRTY-001 |
| UX-TAB-003 | NAV-REOPEN-001 |
| UX-TAB-004 | NAV-REORDER-001 |
| UX-SESSION-001 | RECOVERY-DIRTY-001、RECOVERY-LOOP-001 |
| UX-SESSION-002 | RECOVERY-WINDOW-001 |
| UX-IMAGE-001 | ASSET-PASTE-001、ASSET-BASE64-001 |
| UX-IMAGE-002 | ASSET-STAGING-001 |
| UX-IMAGE-003 | SAFE-DATAURI-001、ASSET-BASE64-001 |
| UX-MATH-001 | EDIT-MATH-001 |
| UX-DIAGRAM-001 | EDIT-MERMAID-001、EDIT-MERMAID-002 |
| UX-DIAGRAM-002 | EDIT-MERMAID-001、SAFE-RENDER-001 |
| UX-TABLE-001 | EDIT-TABLE-001 |
| UX-TABLE-002 | EDIT-TABLE-001、DATA-ROUNDTRIP-001 |
| UX-TABLE-003 | EDIT-TABLE-002 |
| UX-SAFE-001 | FILE-PREFLIGHT-001、PERF-LARGE-001、SAFE-DATAURI-001 |
| UX-SAFE-002 | FILE-SAVE-001、SAFE-DATAURI-001 |
| UX-ERROR-001 | FILE-SAVE-001、ASSET-PASTE-001、RECOVERY-DIRTY-001 |
| UX-ERROR-002 | DATA-CONFLICT-001、FILE-WATCH-001 |
| UX-KEY-001 | 产品直接验收 AC-KEY-001 |
| UX-PERF-001 | PERF-OPEN-001、PERF-TAB-001 |
| UX-PERF-002 | PERF-VIEWPORT-001、NAV-ASYNC-001 |
| UX-PEEK-001 | NAV-PEEK-001 |
| UX-SPLIT-001 | NAV-SPLIT-001 |
| UX-A11Y-001 | 产品直接验收 AC-A11Y-001/002/003 |
| UX-A11Y-002 | 产品直接验收 AC-A11Y-002/004 |
| UX-PLATFORM-001 | 产品直接验收 AC-PLATFORM-001 |
| UX-EXT-001 | EXT-ROUTER-001、EXT-COMMAND-001（P0 内建资源/命令）和 P0 typed feature flags；EXT-CAP-001 仅约束 P1 第三方插件能力 |

## 2. 数据与兼容

| ID | 优先级 | 规范要求 | 验收 |
|---|---|---|---|
| DATA-SOURCE-001 | P0 | Markdown 文件必须是内容唯一真相，派生树或缓存不得替代它 | RT-001 |
| DATA-ROUNDTRIP-001 | P0 | 未编辑文档打开后直接保存必须字节一致 | RT-001 |
| DATA-UNKNOWN-001 | P0 | 未识别语法必须作为原文保留 | RT-002 |
| DATA-REVISION-001 | P0 | 同一 DocumentSession 的变更必须按单调 revision 应用 | CORE-001 |
| DATA-CONFLICT-001 | P0 | 磁盘外部变化与 dirty 缓冲冲突时禁止静默覆盖 | FILE-004 |

## 3. 编辑器

| ID | 优先级 | 规范要求 | 验收 |
|---|---|---|---|
| EDIT-LIVE-001 | P0 | 非活动 Markdown 元素必须可渲染，活动安全范围必须显示源码 | EDT-LIVE-001 |
| EDIT-UNDO-001 | P0 | 所有正文编辑必须进入统一 Undo/Redo，导航不得进入编辑历史 | EDT-UNDO-001 |
| EDIT-IME-001 | P0 | composition 期间禁止装饰切换和自动格式化 | IME-001 |
| EDIT-LINK-001 | P0 | 渲染态链接可导航，编辑态单击只移动光标 | LINK-EDIT-001 |
| EDIT-FIND-001 | P0 | 当前文档 Unicode literal 查找/替换必须可撤销且在 largeText 可用 | FIND-001 |
| EDIT-TABLE-001 | P0 | GFM 表格必须可预览并无损返回源码编辑 | TABLE-001 |
| EDIT-TABLE-002 | P1 | 网格编辑只可替换用户明确提交的表格块 | TABLE-010 |
| EDIT-MERMAID-001 | P0 | Mermaid 必须懒渲染且单块失败不影响编辑器 | VIS-001 |
| EDIT-MERMAID-002 | P0 | Mermaid 必须支持全屏缩放、平移、Fit 和返回源码 | VIS-002 |
| EDIT-MATH-001 | P1 | 行内和块级数学必须安全渲染、保留源码并局部降级 | AC-MATH-001 |

## 4. 导航与 Tab

| ID | 优先级 | 规范要求 | 验收 |
|---|---|---|---|
| NAV-MODEL-001 | P0 | DocumentSession、DocumentView、Tab 和 NavEntry 必须分离 | NAV-CORE-001 |
| NAV-HISTORY-001 | P0 | 每个 Tab 必须拥有独立 back/forward 历史 | HISTORY-001 |
| NAV-RESTORE-001 | P0 | Back 必须恢复来源阅读位置、光标和折叠状态 | HISTORY-RESTORE-001 |
| NAV-DISPOSITION-001 | P0 | 当前、新前台、新后台打开行为必须跨入口一致 | NAV-DISP-001 |
| NAV-ANCHOR-001 | P0 | 必须支持本地相对链接和跨文件 heading anchor | LINK-001 |
| NAV-WORKSPACE-001 | P0 | 文件树、当前文档大纲与 Quick Open 必须消费权威索引并通过统一路由 | WORKSPACE-001 |
| NAV-ASYNC-001 | P0 | 迟到加载结果禁止覆盖更新导航目标 | NAV-CORE-002 |
| NAV-PEEK-001 | P1 | Peek 不得进入历史或创建可编辑会话 | PEEK-001 |
| NAV-SPLIT-001 | P1 | 分栏必须创建独立 View 并共享 DocumentSession | SPLIT-001 |
| NAV-REOPEN-001 | P1 | 恢复关闭的 Tab 必须恢复完整历史和 ViewState | AC-NAV-005 |
| NAV-REORDER-001 | P1 | 重排 Tab 不得改变其资源、历史或 ViewState | AC-NAV-006 |

## 5. 文件、资产与恢复

| ID | 优先级 | 规范要求 | 验收 |
|---|---|---|---|
| FILE-PREFLIGHT-001 | P0 | 文件正文进入 WebView 前必须经过 Rust 预检策略 | SAFE-001 |
| FILE-OPEN-001 | P0 | 工作区和工作区外单文件必须通过原生 scoped grant 打开，禁止 raw path capability | FILE-SCOPE-001 |
| FILE-DRAFT-001 | P0 | 未命名文档的 DraftId/DocumentId 必须由 Rust 幂等创建，初始 dirty 且首次持久化只走 Save As | CONTRACT-022 |
| FILE-SAVE-001 | P0 | 保存必须采用同目录临时文件和平台适配的原子替换 | FILE-001 |
| FILE-WATCH-001 | P0 | 外部修改必须集中进入 DocumentSession 冲突流程 | FILE-002 |
| ASSET-PASTE-001 | P0 | 图片粘贴必须先落盘成功再插入相对链接 | ASSET-001 |
| ASSET-BASE64-001 | P0 | 图片粘贴禁止将 Base64 写入 Markdown | SAFE-002 |
| ASSET-STAGING-001 | P0 | 未保存文档的图片必须使用可恢复 staging | ASSET-002 |
| ASSET-UNDO-001 | P0 | Undo 只撤销链接，资产使用延迟回收 | ASSET-003 |
| RECOVERY-DIRTY-001 | P0 | dirty 文档必须有独立快照或 journal，不依赖 Tab 历史 | REC-001 |
| RECOVERY-LOOP-001 | P0 | 上次打开失败的文件禁止下次启动直接进入主编辑器 | REC-002 |
| RECOVERY-WINDOW-001 | P1 | 完整会话恢复必须恢复 Tab、历史、ViewState 和布局摘要 | AC-SESSION-001 |

## 6. 性能与安全

| ID | 优先级 | 规范要求 | 验收 |
|---|---|---|---|
| PERF-VIEWPORT-001 | P0 | 昂贵装饰和图表必须只处理可视区 | PERF-001 |
| PERF-OPEN-001 | P0 | 真实最大约 243 KiB 文档冷开目标小于 500 ms | PERF-002 |
| PERF-TAB-001 | P0 | 已缓存 Tab 切换目标小于 100 ms | PERF-003 |
| PERF-LARGE-001 | P0 | 10 MiB 普通多行文本必须进入可用大文本模式 | PERF-010 |
| SAFE-DATAURI-001 | P0 | 大 data URI 或病态长行不得进入主 EditorView | SAFE-003 |
| SAFE-IPC-001 | P0 | WebView 只能调用版本化、限权、限载荷的 IPC | SEC-001 |
| SAFE-URL-001 | P0 | 危险 scheme 必须拒绝，外部网页默认系统打开 | SEC-002 |
| SAFE-RENDER-001 | P0 | raw HTML 和 SVG 必须禁用或净化后渲染 | SEC-003 |

## 7. 扩展性与操作性

| ID | 优先级 | 规范要求 | 验收 |
|---|---|---|---|
| EXT-ROUTER-001 | P0 | 新资源页面必须通过 ResourceRouter 接入 | EXT-001 |
| EXT-COMMAND-001 | P0 | 跨 UI 操作必须注册为类型化 Command | EXT-002 |
| EXT-BLOCK-001 | P0 | 内建及新增块渲染器必须使用受限 BlockRenderer 接口 | EXT-010 |
| EXT-CAP-001 | P1 | 插件能力必须显式声明并默认拒绝 | SEC-010 |
| OPS-LOG-001 | P0 | 诊断日志不得记录正文、剪贴板和完整敏感路径 | OBS-001 |
| OPS-CONTEXT-001 | P0 | 代理不得依赖聊天历史，必须通过仓库文档恢复上下文 | PROC-001 |
| OPS-HANDOFF-001 | P0 | 每个任务结束必须记录变更、验证、决定和剩余工作 | PROC-002 |
| OPS-BUILD-001 | P0 | 干净环境必须可用固定命令构建并启动桌面壳 | BUILD-001 |
| OPS-CI-001 | P0 | CI 必须执行格式、类型、Rust、契约、核心测试和产物构建门禁 | CI-001 |
| OPS-RELEASE-001 | P0 | 首发包必须可签名/公证、干净安装、文件关联启动、安全升级/回滚，并带隐私与依赖许可证清单 | RELEASE-001 |

## 8. 测试 ID 约定

- RT：round-trip 和语料兼容。
- AC：产品级端到端验收，定义于 01-product-ux。
- EDT / IME / TABLE / FIND：编辑器、输入法、表格和当前文档查找替换。
- HISTORY / NAV / LINK / PEEK / SPLIT / WORKSPACE：导航、链接与工作区浏览。
- CORE：领域状态和 revision。
- FILE / ASSET / REC：本地核心。
- PERF / SAFE / SEC：性能安全。
- EXT：扩展契约。
- CONTRACT：Rust schema、生成 TypeScript、IPC/realm 边界及跨模块不变量的契约证据；canonical 索引定义于 09，规范断言来源为 03 §17。CONTRACT-* 不取代 CORE/FILE/ASSET 等行为测试；共享 harness 时仍必须以各自稳定 ID 独立报告证据。
- OBS / PROC：可观测性与执行流程。
- BUILD / CI / RELEASE：可复现构建、流水线与发布产物。

具体用例定义见 [09-testing-observability.md](design/09-testing-observability.md)。
