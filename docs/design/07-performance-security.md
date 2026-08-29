# 07. 性能与安全

> 状态：Approved design baseline 0.1  
> 所有者：Platform  
> 主要需求：PERF-VIEWPORT-001、PERF-OPEN-001、PERF-TAB-001、PERF-LARGE-001、SAFE-DATAURI-001、SAFE-IPC-001、SAFE-URL-001、SAFE-RENDER-001、EXT-CAP-001、OPS-LOG-001  
> 依赖：[02-system-architecture.md](02-system-architecture.md)、[06-file-assets-recovery.md](06-file-assets-recovery.md)

## 1. 目标

本项目的性能目标不是“能把任意巨型文件塞进富渲染编辑器”，而是：

1. 用户真实文档的编辑、切换和导航始终轻快。
2. 正常的大文本有明确降级模式。
3. 病态输入在进入 WebView 和主编辑器前被阻断。
4. 单个 Mermaid、图片或插件故障不能拖垮整个文档。
5. 本地文件、剪贴板和文档内容默认不越过用户授权边界。

安全与性能共同设计：不受限的字符串复制、DOM、SVG、IPC 和解码既是卡死风险，也是拒绝服务与数据泄露风险。

## 2. 真实语料基线

2026-08-29 对用户指定“阅读”目录的本机只读扫描结果（绝对路径不写入仓库）：

| 指标 | 结果 |
|---|---:|
| Markdown 文件 | 79 |
| Markdown 总字节 | 1,066,143 B |
| 总行数 | 9,507 |
| 中位文件大小 | 7,072 B |
| 最大文件 | 248,920 B，约 243 KiB |
| 最大物理行 | 3,277 B |
| 含 GFM 表格的文件 | 76 / 79 |
| 估算表格 | 约 279 |
| 表格行 | 约 3,668 |
| Markdown 本地链接 | 约 1,106 |
| Mermaid 块 | 4，分布于 3 个文件 |
| Markdown 图片链接 | 2 |
| data URI / Base64 图片 | 0 |
| 两个现有图片资产合计 | 约 897,985 B |

结论：

- P0 性能优化首先覆盖表格、文档导航、链接解析和零差异保存。
- Mermaid 和图片必须可靠，但不是页面数量上的主负载。
- 10 MiB Base64 属于低频事故防护，不应反向绑架正常编辑器架构。
- 真实语料只作为本机验收输入，不复制进公开仓库或 CI；CI 使用脱敏的等价合成语料。

## 3. 性能不变量

| ID | 不变量 |
|---|---|
| PERF-INV-001 | 预检前不得把整个文件解码为 JavaScript String |
| PERF-INV-002 | EditorView 不得接收被 SafetyBlocked 的正文 |
| PERF-INV-003 | 昂贵 decoration、图片、表格预览和 Mermaid 只处理视口及有限 overscan |
| PERF-INV-004 | 同一 DocumentSession 正文不得因多个 Tab 复制为多份长期缓存 |
| PERF-INV-005 | 异步解析/渲染结果必须携带 generation 或 revision，过期结果直接丢弃 |
| PERF-INV-006 | Tab 切换不得等待磁盘、索引或 Mermaid 完成 |
| PERF-INV-007 | 输入热路径不得同步调用 Tauri IPC、文件系统、网络或全量 Markdown 序列化 |
| SEC-INV-001 | 文档文本、HTML、SVG、URL、路径和未来插件输入均视为不可信 |
| SEC-INV-002 | WebView 只能使用声明的窄 IPC；不得拥有通用文件或 shell 能力 |
| SEC-INV-003 | 本地资源解析最终由 Rust 在授权根和符号链接解析后判断 |
| SEC-INV-004 | 诊断数据不得包含正文、剪贴板、恢复内容或完整敏感路径 |

## 4. 模式与默认阈值

所有阈值集中在版本化 PerformancePolicy，由 Rust 通过 app_capabilities_v1 返回给前端用于展示、降级 UI 和诊断；最终判定仍在 Rust。握手字段必须与第 03 章 AppCapabilities.limits 一致。

| 参数 | 默认值 | 目的 |
|---|---:|---|
| normalFileBytes | 8 MiB | 完整编辑与渲染上限 |
| maxEditableFileBytes | 32 MiB | 内置大文本模式上限 |
| maxNormalLineBytes | 256 KiB | 避免长行让语言服务与 layout 退化 |
| safetyBlockLineBytes | 1 MiB | 单行严格大于该值时进入安全页 |
| safetyBlockDataImageDecodedBytes | 512 KiB | data image 估算解码量严格大于该值时进入安全页 |
| mermaidSourceBytes | 256 KiB | 单图源码上限 |
| mermaidMaxNodes | 5,000 | 单图复杂度上限 |
| mermaidRenderTimeoutMs | 2,000 ms | 单图渲染到局部超时错误的上限 |
| imageDecodedPixelMax | 100,000,000 | 防止解压炸弹，后续基准可收紧 |
| previewMaxUtf8Bytes | 64 KiB | Peek 单次返回的 UTF-8 摘要硬上限，禁止退化为完整打开 |
| previewMaxLines | 200 | Peek 单次摘要行数硬上限 |
| nativeOpenQueueMaxTargets | 64 | capabilities handshake 前原生 open/drop target 的有界队列 |
| workspaceScanPageMaxEntries | 1,000 | workspace authoritative rescan 的单页条目上限；仍受 1 MiB response 限制 |
| ipcDefaultPayloadBytes | 1 MiB | 普通命令载荷上限 |
| ipcDocumentRawContentBytes | 32 MiB | 所有完整 Markdown content variant 的原始 UTF-8 上限；不是 JSON wire 长度 |
| ipcDocumentWireBytes | 193 MiB | 32 MiB raw 的 6x 最坏 JSON escaping 加 1 MiB envelope；仅正文 variant 可用 |

禁止通过前端查询参数或文档 front matter 提高安全上限。开发设置可以降低阈值用于测试，但生产版提高阈值必须有 ADR 与基准证据。

## 5. 用户可感知预算

### 5.1 基准环境

绝对延迟受机器影响。CI 必须同时记录：

- 参考机器型号、CPU、内存、macOS 版本；
- debug/release 构建；
- 冷/热缓存；
- 文档规模和 fixture 摘要；
- p50、p95、最大值和样本数。

门禁以 release 构建和固定参考机器为准；其他 CI 主机使用相对基线回归阈值。默认允许的性能回归不超过既有 p95 的 15%，且不能突破硬预算。

### 5.2 P0 硬预算

| 场景 | 预算 | 测量边界 |
|---|---:|---|
| 真实最大约 243 KiB 文档冷开可输入 | p95 < 500 ms | 点击到 EditorView 接收输入 |
| 任意已缓存、已打开文档/资源的 Tab 切换 | p95 < 100 ms | 触发到目标首帧稳定；同 session/跨 session 分别记录 |
| 普通键入到绘制 | p95 < 50 ms | beforeinput 到 animation frame |
| 主线程长任务 | 单次 < 100 ms | PerformanceObserver |
| Back 恢复已缓存文档 | p95 < 150 ms | 命令到定位完成 |
| 1 MiB 文档查找首结果 | p95 < 100 ms | 提交查询到高亮 |
| 10 MiB 普通多行文本 | < 2 s 进入可编辑大文本模式 | 点击到纯文本编辑器可输入 |
| 10 MiB 单行 data URI | < 1 s 显示安全页 | 点击到 SafetyBlocked 页面 |
| 粘贴 10 MiB data URI | < 200 ms 阻断并提示 | paste 到 UI 反馈 |
| 普通截图粘贴 | p95 < 1 s 插入链接 | paste 到 Markdown transaction |
| Mermaid 首次进入视口 | 2 s 内成功或可操作错误 | 可见到渲染/错误 |

目标值不是通过隐藏失败达成。超过预算时必须记录结构化阶段耗时，以便定位预检、IPC、解析、layout 或 I/O。

## 6. 前端性能设计

### 6.1 EditorView 热路径

- CodeMirror transaction 是正文变更唯一入口。
- Markdown 语法树使用增量解析；禁止每次按键重新解析完整文档。
- 只为当前视口加有限 overscan，默认上下各 1–2 个 viewport。
- decoration 计算必须可按 ChangedRange 增量更新。
- React 不订阅完整正文；只订阅派生摘要、状态和当前资源 ID。
- 禁止把完整正文放入全局 immutable store 的历史快照。
- 正文变化不得触发整个 React 文档树重新渲染。
- IME composition 期间暂停结构切换和昂贵派生计算。
- 表格网格预览、Outline 和链接索引使用 revision 标记的后台/空闲任务。

### 6.2 Tab 与会话内存

- 一个规范化文件只保留一个 DocumentSession 文本状态。
- 每个 DocumentView 只持 selection、scroll anchor、folds 和有限 widget 状态。
- 非当前 Tab 可以卸载 EditorView，但不能丢失 view state。
- clean 且无引用会话按 LRU 回收；dirty、保存中、冲突中或有恢复任务的会话禁止回收。
- Mermaid DOM/SVG 在离开 overscan 后可卸载，只保留带版本的安全缓存或重新渲染输入。
- 缓存必须有总预算和单项上限，内存压力时按资源类型逐级释放。

### 6.3 异步工作

每个可能超过一帧的任务至少带：

~~~text
operationId
documentId
sourceRevision
generation
cancellation token
~~~

包括 Mermaid、全文索引、Outline、链接扫描、图片元数据和未来 AI 请求。完成时若 resource、revision 或 generation 不匹配，结果必须丢弃，不得尝试“智能合并”过期派生数据。

Web Worker 可用于纯解析和索引，但不是安全边界。大原文传入 worker 可能复制内存，因此必须基于测量选择 transferable、增量片段或仅在大文本模式禁用功能。

### 6.4 渲染隔离

- 每个 BlockRenderer 有独立错误边界、超时和尺寸上限。
- 超时门禁必须可抢占：主线程同步渲染无法被 `setTimeout`/AbortSignal 中断，因此必须先做 source/node 上限，并对无法证明合作取消的库使用可终止 worker/隔离执行域；不可行时禁用该 renderer 并显示源码。
- Mermaid 失败只替换当前代码块为错误卡片。
- 图片先读取元数据并保留占位尺寸，避免加载后大幅 layout shift。
- 大 SVG/PNG 查看器采用独立 overlay，文内只展示缩略/适宽版本。
- 缩放和平移使用 transform，避免每次指针移动重新排版整个文档。

## 7. Rust 与 IPC 性能

### 7.1 流式 I/O

- 预检、hash、Base64 修复和大文件复制使用 bounded buffer。
- 禁止为了统计最大行先构造 Vec<String>。
- 能在同一遍扫描完成的指标不得重复读取；安全性需要二次校验时记录原因。
- 取消长任务时尽快关闭句柄和清理临时文件。
- 保存正文不可同时长期保留多个 Rust String 副本；接口实现需用 profiling 验证峰值。

### 7.2 IPC 载荷

- 普通命令的 JSON 载荷默认上限 1 MiB。
- 文档 open/save/reload/conflict/compare/checkpoint/recovery 等所有完整正文方向使用第 03 章列出的专用 schema、raw/wire 双上限和计时，不得误落普通 1 MiB invoke 限制。JSON/wire 上限必须按最坏转义开销从原始上限派生，不能用固定 40 MiB 拒绝合法 32 MiB 正文；Phase 0 也可据实选择受控二进制/句柄传输。
- 图片字节不得经过 Base64 JSON；由 Rust 直接写盘或使用受控二进制通道。
- 错误响应只返回摘要、范围和 token，不返回触发错误的大段原文。
- 高频进度事件节流到人眼可用速率，默认不超过 10 Hz。

如果 Tauri 实际桥接对 10–32 MiB 文本产生不可接受的复制，技术验证阶段必须比较：

1. 单次专用 invoke；
2. 临时受控句柄/asset protocol；
3. 分块但有顺序与摘要校验的传输。

选择必须记录 ADR，不能在业务层自行分块。

## 8. 威胁模型

### 8.1 保护对象

- 用户 Markdown 正文、恢复草稿和剪贴板；
- 工作区内其他文件；
- 工作区外文件和系统凭据；
- 应用的 Tauri capability；
- 用户浏览器身份与网络隐私；
- 应用可用性和未保存内容。

### 8.2 攻击/故障来源

- 恶意或意外的 Markdown、HTML、SVG、Mermaid；
- 超长行、压缩炸弹、图片解码炸弹和递归结构；
- 路径遍历、符号链接逃逸和大小写/Unicode 混淆；
- 危险 URL scheme；
- 被篡改的恢复文件、工作区配置或未来插件；
- IPC 参数伪造、重放、超大载荷；
- 外部程序与本应用并发写文件；
- 渲染库和依赖供应链漏洞。

P0 不假设打开的工作区可信。

## 9. WebView 安全

### 9.1 CSP 和应用导航

生产构建必须：

- default-src 限制为 self 或 Tauri 必需来源；
- script-src 禁止远程脚本、eval 和动态未受控代码；
- object-src none；
- frame-src none，除非未来 ADR 引入隔离预览；
- connect-src 默认无公网目标；
- img-src 仅允许应用自有受控协议、必要 data 小图标和显式允许的来源；
- 禁止 WebView 顶层导航到文档链接或 HTTP 页面；
- 外部 HTTP(S) 使用系统浏览器。

具体 CSP 根据 Tauri 2 官方机制配置并由自动化测试检查产物，不能只写在 README。

### 9.2 HTML

P0 默认不渲染 raw HTML，只显示源码。若以后启用：

- 通过固定 allowlist sanitizer；
- 移除 script、style、iframe、object、embed、form、meta、base；
- 移除所有 on* handler、srcdoc 和危险 URL；
- id/class/style 也按策略过滤，防止覆盖应用 UI；
- 净化器前后都设输入/输出大小上限；
- 必须增加 SEC-003 的恶意 fixture。

不得使用 dangerouslySetInnerHTML 注入未经净化的文档结果。

### 9.3 Mermaid 和 SVG

Mermaid 使用 strict 安全配置，禁止可执行 HTML 标签和任意脚本能力。官方 [securityLevel schema](https://mermaid.js.org/config/schema-docs/config-properties-securitylevel.html) 说明 `strict` 为默认且会编码 HTML/禁用 click；但这只是第一层，不得代替输出净化。通过官方 [`mermaid.render`](https://mermaid.js.org/config/usage) 获得 SVG 字符串后再次净化：

- 删除 script、foreignObject、事件属性和外部资源；
- URL 统一交给 ResourceRouter；
- 禁止 file:、javascript:、data:text/html 等 scheme；
- 限制元素数、属性长度、画布尺寸和渲染时间；
- 超限显示源码与错误，不影响编辑。

SVG 在全屏查看器中仍按不可信 DOM 处理。导出 SVG 也必须导出净化版本。

### 9.4 图片与远程资源

- 本地图片只通过受控 asset protocol 按 workspace/document/draft capability 读取；draft 资源只能由应用恢复 ledger 中的授权记录解析。
- file:// 绝对路径不直接暴露给 WebView。
- HTTP(S) 远程图片 P0 默认不自动加载，显示占位并让用户选择。
- 若未来允许远程图片，使用无凭据请求、无 Referer 或隐私代理策略，并提供每工作区设置。
- 解码前检查文件头、声明尺寸、总字节和像素上限；失败隔离到单图。
- SVG 图片走 SVG 净化路径，不能按普通位图信任。

## 10. 路径、URL 与协议

### 10.1 允许的资源类别

ResourceRouter 解析后返回判别联合，而不是任意字符串：

| 类别 | 行为 |
|---|---|
| WorkspaceDocument | 在应用内导航 |
| WorkspaceAsset | 受控预览 |
| Anchor | 当前或目标文档内定位 |
| ExternalHttp | 用户策略下交系统浏览器 |
| Mailto | 用户明确点击/命令后交系统邮件应用；程序性触发拒绝 |
| NeedsGrant | 请求用户授权新的目录/文件 |
| Unsupported | 提示，不执行 |
| Rejected | 安全拒绝 |

默认拒绝 javascript:、vbscript:、data:text/html、任意 command、未经授权的 file:、自定义 shell 协议。未知 scheme 不能自动交给系统。

### 10.2 路径校验

Rust 解析本地链接的顺序：

1. 以来源文档目录为 base 解析 URL 编码和路径分隔符。
2. 拒绝 NUL、非法编码和平台保留形式。
3. lexical normalize，但不能仅据此授权。
4. 解析现有父级与符号链接得到 canonical target。
5. 检查 target 位于授权根或已有单文件 capability 内。
6. 对不存在目标验证最近存在父级，防止后续创建时逃逸。
7. 返回不透明 ResourceRef/handle。

展示层可以显示友好相对路径，但不得把展示路径当授权依据。

## 11. Tauri IPC 安全

- capability 配置只列出实际命令和窗口。
- 主 WebView capability 禁止授予 `clipboard-manager:allow-read-image` 或等价 guest API；系统剪贴板图片只能由 Rust `asset_import_clipboard_v1` 内的平台 adapter 读取，图片字节不穿过通用 IPC。
- 所有命令在 adapter 层验证 apiVersion、大小、枚举和 ID 格式。
- 前端不能传入任意绝对写路径；保存目标来自已授权 document handle 或原生 Save As。
- operationId 绑定创建它的窗口、命令类型和过期时间，避免跨用途重放。
- repairToken、saveAsToken 和 assetId 都不可猜测；token 短期有效并绑定对应 revision/capability。
- 错误不得泄露工作区外路径或 Rust backtrace 给普通 UI。
- 生产版禁止任意 shell 命令、开发服务器 fallback 和打开 DevTools 的隐藏链接。
- IPC schema 由 Rust 生成 TypeScript，并有版本兼容测试。

未来插件不得直接调用 Tauri invoke；只能调用扩展宿主暴露的 capability façade。

## 12. 恢复、配置与日志安全

- 恢复正文位于用户私有 app data，权限尽可能设为仅当前用户。
- checkpoint、staging 和诊断包有明确配额、保留期和清理入口。
- 工作区配置视为数据，不允许声明脚本、任意命令或提高安全上限。
- 日志路径用 workspaceId/documentId 或 salted 短 hash，默认不记录完整绝对路径。
- 禁止记录正文片段、剪贴板、Base64、恢复正文、搜索词和外部 URL 查询参数。
- 错误卡片展示必要上下文可以包含用户当前可见文件名，但遥测中必须脱敏。
- P0 默认不上传遥测；如果未来加入，必须 opt-in、列明字段并增加隐私 ADR。
- 用户导出诊断包前显示包含项，正文和恢复数据默认排除。

## 13. 依赖与供应链

- JavaScript 和 Rust 依赖使用 lockfile，release 构建可重现。
- CI 执行许可证检查、已知漏洞扫描和 Tauri 配置审计。
- Mermaid、Markdown parser、sanitizer、图片解码和 WebView 相关安全更新优先处理。
- 不从 CDN 运行编辑器、主题、Mermaid 或插件脚本。
- 新依赖必须说明用途、许可、维护状态、包体/性能影响和替代方案。
- copyleft 项目可用于研究行为，但不得复制不兼容代码进入本项目；具体许可策略由仓库 LICENSE/NOTICE 决定。

## 14. 性能诊断

开发/测试构建记录阶段 span：

~~~text
resource.resolve
document.preflight
document.read
ipc.document.transfer
session.construct
editor.mount
markdown.viewport.decorate
mermaid.parse
mermaid.sanitize
asset.clipboard.read
asset.encode
asset.persist
navigation.restore
save.serialize
save.atomic_replace
~~~

每个 span 只带：

- operationId；
- 文档大小 bucket；
- 行长度 bucket；
- mode；
- duration；
- outcome/error code；
- revision/generation 的非敏感摘要。

不得带正文、路径或用户输入。超过预算时开发版可以生成 profile marker；生产版只保留环形缓冲中的有限摘要，并由用户主动导出。

## 15. 降级顺序

遇到负载或内存压力时按以下顺序降级，正文编辑优先：

1. 取消屏外 Mermaid、图片元数据和索引任务。
2. 清理离屏 BlockRenderer DOM 与派生缓存。
3. 暂停 Outline、反向链接和全文索引更新。
4. 关闭 live rendered decorations，切到 source-only。
5. 保留纯文本编辑、查找、保存和恢复。
6. 若继续不安全，保存恢复 checkpoint 并进入安全页。

任何降级都应显示非阻塞状态，并允许在负载恢复后重试。不得通过丢弃 Undo、dirty 正文或未落盘资产来释放内存。

## 16. 测试与验收

最低门禁：

- PERF-001：含大量表格、链接和屏外 Mermaid 的文档滚动时只渲染视口附近块。
- PERF-002：真实最大约 243 KiB 文档在参考机满足 500 ms 冷开预算。
- PERF-003：已缓存 Tab 满足 100 ms 切换预算。
- PERF-010：10 MiB 普通多行文本进入 LargeText 且输入、查找、保存可用。
- SAFE-003：10 MiB 单行 Base64 的打开和粘贴都不创建主 EditorView transaction。
- SEC-001：WebView 无法调用白名单外命令，超限载荷被 adapter 拒绝。
- SEC-002：路径遍历、符号链接逃逸和危险 scheme 全部被拒绝。
- SEC-003：HTML/SVG/Mermaid 恶意语料不能执行脚本、发起未允许请求或访问本地文件。
- SEC-010：未来扩展未声明 capability 时调用默认失败。
- OBS-001：日志扫描确认无正文、Base64、剪贴板和绝对敏感路径。

详见 [09-testing-observability.md](09-testing-observability.md)。

## 17. 变更规则

以下变化必须同时更新本章、测试和 ADR：

- 调高文件、行、data URI、图片或 IPC 上限；
- 让远程资源自动加载；
- 开启 raw HTML；
- 引入新 WebView、iframe、本地服务器或远程脚本；
- 增加通用文件、网络、shell 或插件能力；
- 改变日志/遥测收集字段；
- 将正文从前端传输改为句柄或分块协议。
