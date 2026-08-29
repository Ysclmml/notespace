# 08. 扩展模型

> 状态：Approved design baseline 0.1  
> 所有者：Extensions / Architecture  
> 主要需求：EXT-ROUTER-001、EXT-COMMAND-001、EXT-BLOCK-001、EXT-CAP-001  
> 依赖：[02-system-architecture.md](02-system-architecture.md)、[03-domain-model-and-contracts.md](03-domain-model-and-contracts.md)、[05-navigation-tabs.md](05-navigation-tabs.md)

## 1. 目标

扩展模型的首要目标是让全文搜索、反向链接、知识图谱、Git、AI、导出和更多 Markdown 块类型能够逐步加入，同时不破坏：

- Markdown 原文唯一真相；
- DocumentSession / DocumentView / Tab / NavEntry 的分离；
- ResourceRouter 的统一导航语义；
- Rust capability 和路径授权边界；
- 输入、保存、恢复和大文件安全路径；
- 多代理可按模块并行实现的稳定契约。

P0 建立“内部扩展点”，不承诺公开第三方插件 SDK。只有同一接口经过至少两个内部功能验证、完成安全审计并有版本兼容策略后，才考虑对外。

## 2. 非目标

- P0 不加载工作区中的任意 JavaScript、WASM 或 shell 脚本。
- P0 不兼容 VS Code、Obsidian、Typora 或浏览器扩展 API。
- P0 不允许扩展直接访问 Tauri invoke、任意文件系统、网络、剪贴板或进程。
- 扩展不得创建第二套正文、导航、命令或保存系统。
- 扩展不得替换 Markdown 为专有数据库格式。
- 本章不保证未来公开插件的二进制或源码兼容；只定义内部边界和演化条件。

## 3. 扩展不变量

| ID | 不变量 |
|---|---|
| EXT-INV-001 | 所有可导航页面必须表示为 ResourceRef 并经过 ResourceRouter |
| EXT-INV-002 | 菜单、快捷键、命令面板和上下文菜单触发同一 CommandDefinition |
| EXT-INV-003 | 扩展不得直接修改 DocumentSession 内部状态，只能提交受验证的 transaction/command |
| EXT-INV-004 | BlockRenderer 只渲染给定源码范围，禁止偷偷重写正文 |
| EXT-INV-005 | 扩展不得直接调用 Tauri invoke；原生能力只能经版本化 capability façade |
| EXT-INV-006 | 每个异步结果必须关联 resource、revision 和 generation，过期即丢弃 |
| EXT-INV-007 | 新持久化状态必须有 schemaVersion、迁移和丢弃/重建策略 |
| EXT-INV-008 | 扩展关闭、失败或未安装时，用户 Markdown 仍必须可读、可编辑、可保存 |
| EXT-INV-009 | 扩展声明的快捷键、资源类型、命令 ID 和设置 key 必须全局命名空间唯一 |

## 4. 扩展宿主分层

~~~text
Feature UI
  -> ExtensionHost
       ├─ CommandRegistry
       ├─ ResourceProviderRegistry
       ├─ LinkResolverRegistry
       ├─ BlockRendererRegistry
       ├─ EditorExtensionRegistry
       ├─ SidebarContributionRegistry
       ├─ ExportProviderRegistry
       └─ CapabilityBroker
              -> typed frontend ports
              -> Rust capability API
~~~

ExtensionHost 负责注册、生命周期、版本、冲突检测、能力代理、故障隔离和诊断。具体 feature 不得越过 registry 直接修改 AppShell 私有结构。

前端源代码使用与 `AGENTS.md`/第 02 章一致的 canonical ownership：

~~~text
src/domain/extensions/**                    (纯契约与纯函数)
        ↑
src/app/router | commands | sessions | settings
        ↑
src/features/<feature>/extension.ts
        ↑
src/app/registerBuiltins.ts
~~~

`src/domain/extensions/**` 只能包含类型、纯函数和稳定错误；不能依赖 React、CodeMirror、Tauri 或具体 feature。不得另建并行的 `src/core/**` 或 `src/extensions/contracts/**` 架构。

## 5. 扩展描述符

内部扩展也必须有显式描述符，以验证公开 SDK 之前的真实需求：

~~~ts
interface ExtensionManifestV1 {
  manifestVersion: 1
  id: string
  version: string
  displayName: string
  apiRange: string
  activationEvents: ActivationEvent[]
  capabilities: CapabilityRequest[]
  contributes: ContributionSummary
}
~~~

规则：

- id 使用反向域名或项目命名空间，例如 app.markdown.search。
- 内建扩展也不得使用未声明能力。
- activationEvents 必须可枚举，例如 onCommand、onResource、onLanguage、onWorkspaceReady。
- 禁止 onAnyInput 之类无界激活。
- manifest 不能声明脚本路径、shell 命令或任意 URL 作为执行入口。
- P0 描述符可以是编译期 TypeScript 常量；不得把未签名工作区 manifest 当代码加载。

## 6. CommandRegistry

### 6.1 定义

~~~ts
interface CommandDefinition<Args, Result> {
  id: CommandId
  title: string
  category: string
  argsSchema: Schema<Args>
  isEnabled(ctx: CommandContext): boolean
  run(ctx: CommandContext, args: Args, signal: AbortSignal): Promise<Result>
}
~~~

每个跨 UI 操作必须注册为 Command，包括打开、保存、后退、图片粘贴、Mermaid 全屏、搜索结果导航和未来 Git/AI 操作。

### 6.2 规则

- 命令 ID 稳定且带命名空间。
- 菜单、快捷键、命令面板、按钮和测试通过 ID 调用同一命令。
- CommandContext 只暴露只读 selection/resource/session 摘要和受限服务。
- 正文变更必须返回或提交 EditorTransactionSpec；不得直接替换 store。
- 命令不得捕获过期 React 组件引用。
- 长任务必须接受 AbortSignal 并报告结构化进度。
- destructive 或越权操作必须返回 NeedsConfirmation/NeedsGrant，由宿主统一显示。
- 命令错误为稳定判别联合；不能靠匹配 message 字符串处理。

### 6.3 快捷键

快捷键是 Command 的平台映射，不属于命令实现。冲突处理顺序：

1. 用户自定义；
2. 产品核心保留命令；
3. 内建 feature；
4. 未来第三方扩展。

冲突必须可见且可重新绑定。扩展不得在 DOM 上注册绕过 CommandRegistry 的全局 keydown。

## 7. ResourceRouter 与 ResourceProvider

### 7.1 资源模型

资源统一使用第 03 章的 ResourceRef，不得由扩展重新定义判别联合：

~~~ts
type ResourceRef =
  | { kind: "markdown"; locator: DocumentLocator; anchor?: DocumentAnchor }
  | { kind: "asset"; scope: ResourceScope; relativePath: RelativePath; mediaType?: string }
  | { kind: "externalUrl"; url: string }
  | {
      kind: "virtual"
      providerId: string
      resourceId: string
      params?: Record<string, string>
    }
~~~

只有 markdown 资源可绑定可编辑 DocumentSession；其他资源创建各自 ResourceViewModel。搜索、图谱、Git diff 和 AI 分别使用 virtual providerId，例如 app.search、app.graph、app.git-diff 和 app.ai-answer。Tab 和 NavEntry 始终只依赖同一个 ResourceRef。

### 7.2 Provider 接口

~~~ts
interface ResourceProvider {
  providerId: string
  schemaVersion: number
  canHandle(ref: ResourceRef): boolean
  resolve(ctx: ResolveContext, ref: ResourceRef, signal: AbortSignal): Promise<ResolvedResource>
  preview?(
    ctx: PreviewContext,
    intent: PreviewIntent,
    limits: { maxUtf8Bytes: number; maxLines: number },
    signal: AbortSignal,
  ): Promise<ResourcePreviewOutcome>
  createViewModel(ctx: ViewContext, resource: ResolvedResource): ResourceViewModel
  serialize?(ref: ResourceRef): PersistedResourceRef
  migrate?(old: PersistedResourceRef): PersistedResourceRef | Unsupported
}
~~~

规则：

- ResourceRouter 是唯一入口，feature 不得直接 push TabStore。
- resolve 必须无 UI 副作用；授权或确认以 typed outcome 返回。
- provider 未安装或版本不兼容时，历史项显示 Unsupported Resource，可关闭但不能导致恢复失败。
- payload 有大小和深度上限，禁止在 NavEntry 存正文、搜索全集或 AI 大响应。
- view state 与 resource identity 分开存储。
- provider 的迟到结果不得覆盖已经导航到的新 ResourceRef。
- preview 必须有界、只读、可取消且不创建长期 session/view/history；核心 Markdown provider 通过第 03 章 `resource_preview_v1` 实现，virtual provider 返回同一 `ResourcePreviewOutcome` 语义。不实现时显式返回 `ERR_UNSUPPORTED`。

### 7.3 导航 disposition

所有可导航 provider 必须接受第 03 章冻结的核心 disposition：

~~~text
current
newForegroundTab
newBackgroundTab
splitRight（P1）
~~~

Peek 使用第 03 章的独立 `PreviewIntent`，不创建 NavEntry，也不是 OpenDisposition。feature 不得发明“自己的新窗口/Tab”语义。若某资源不支持 `splitRight` 或 preview，必须返回带 action context 的 `ERR_UNSUPPORTED`，不得默默改成另一种打开方式。

## 8. LinkResolver

LinkResolver 把可点击目标转成 ResourceRef：

~~~ts
interface LinkResolver {
  id: string
  priority: number
  match(input: LinkResolveInput): Match | NoMatch
  resolve(ctx: LinkResolveContext, match: Match): Promise<LinkResolveOutcome>
}
~~~

核心 resolver 固定优先级：

1. 当前文档 heading/块锚点；
2. 本地相对 Markdown；
3. 工作区 wiki/别名语法（若启用）；
4. 工作区资产；
5. HTTP(S)/mailto；
6. 扩展 scheme；
7. unsupported/rejected。

安全规则先于扩展优先级。扩展不能接管 javascript、file、command 等核心拒绝 scheme，也不能通过高 priority 绕过 Rust 路径校验。

## 9. BlockRenderer

### 9.1 用途

BlockRenderer 用于 Mermaid、数学、图片预览、未来 PlantUML/Graphviz 等“源码块的派生视觉”。它不是富文本正文模型。

~~~ts
interface ReadonlySourceSlice {
  text: string
  from: number
  to: number
  sessionRevision: SessionRevision
}

interface RendererLimits {
  maxSourceBytes: number
  maxOutputBytes: number
  maxNodes?: number
  timeoutMs: number
}

interface RendererDiagnostic {
  code: "unsupported" | "invalidSource" | "limitExceeded" | "timeout" | "internal"
  messageKey: string
  safeDetails?: Record<string, string | number | boolean>
}

interface ParseContext {
  mode: OpenMode
  readOnly: boolean
  syntaxKind: string
  language?: string
}

interface RenderContext {
  mode: OpenMode
  readOnly: boolean
  themeId: string
  securityPolicyVersion: number
}

type ParseResult<Input> =
  | { kind: "parsed"; value: Input; sourceHash: ContentHash }
  | { kind: "fallback"; diagnostic: RendererDiagnostic }

type RenderResult<Output> =
  | { kind: "rendered"; artifact: Output; sourceHash: ContentHash; rendererVersion: string }
  | { kind: "fallback"; diagnostic: RendererDiagnostic }

interface BlockRenderer<Input, Output> {
  id: string
  rendererVersion: string
  languageOrKind: string
  apiVersion: 1
  limits: RendererLimits
  parse(
    source: ReadonlySourceSlice,
    ctx: ParseContext,
    signal: AbortSignal
  ): ParseResult<Input> | Promise<ParseResult<Input>>
  render(input: Input, ctx: RenderContext, signal: AbortSignal): Promise<RenderResult<Output>>
  dispose(result: Extract<RenderResult<Output>, { kind: "rendered" }>): void
}
~~~

### 9.2 规则

- ReadonlySourceSlice 带 from/to/revision，禁止修改正文。
- 只有视口附近的匹配块可实例化。
- 输出只能进入宿主提供的隔离容器。
- HTML/SVG 输出先经过核心 sanitizer；renderer 不能自带放宽策略。
- renderer 声明源码、节点、输出尺寸和时间上限。
- 错误和超时只影响当前块，必须可返回源码编辑。
- `AbortSignal` 和 `Promise.race` 本身不是同步 JS 的硬中断。任何无法在预算中合作取消的 renderer 必须运行在可终止的 worker/隔离执行域；如果在目标 WebView 上做不到，必须关闭该渲染器并退回源码，不得用主线程 `setTimeout` 声称已满足超时。
- 编辑源码的动作通过核心 command 提交 transaction。
- 全屏、缩放、复制和导出使用宿主 Viewer API，保证交互一致。
- 缓存 key 至少包含 rendererVersion、sourceHash、theme、securityPolicyVersion。

## 10. EditorExtension

CodeMirror 扩展能力最强，也最容易破坏输入性能。P0 仅允许编译期内建 EditorExtension：

~~~ts
interface EditorExtensionContribution {
  id: string
  create(ctx: RestrictedEditorContext): Extension
  appliesTo(ctx: { mode: OpenMode; readOnly: boolean }): boolean
  performanceClass: "input-critical" | "viewport" | "idle"
}
~~~

限制：

- RestrictedEditorContext 不暴露 Tauri、文件服务或 React store。
- input-critical 扩展必须有键入基准。
- largeText 模式默认只加载基础语法、查找、selection 和保存所需扩展。
- 禁止每次 transaction 扫描完整正文。
- 状态字段必须可在 view 卸载时释放，不能持有重复正文。
- 扩展发起异步任务时遵守 revision/generation/cancel 契约。
- 未经 ADR 不允许运行来自工作区或网络的 CodeMirror 扩展代码。

## 11. Sidebar 与面板贡献

文件树、Outline、搜索、反向链接、图谱等通过 slot 注册：

~~~ts
interface ViewContribution {
  id: string
  slot: "left.primary" | "left.secondary" | "right.inspector" | "bottom.panel"
  title: string
  icon: CoreIconId
  when: ContextExpression
  component: LazyComponent
}
~~~

- AppShell 拥有布局、尺寸、焦点、无障碍和持久化。
- feature 只提供内容，不直接操作其他面板 DOM。
- when 使用受限 context keys，不执行任意表达式。
- 懒加载失败不影响编辑器。
- 关闭 feature 后，未知持久化面板状态被忽略并可安全清理。

## 12. CapabilityBroker

### 12.1 能力分类

| 能力 | 示例 | 默认 |
|---|---|---|
| document.readCurrent | 读当前正文快照 | 内建按需 |
| document.applyEdit | 提交受验证编辑 | 显式声明 |
| workspace.readMetadata | 文件树、链接摘要 | 显式声明 |
| workspace.readFile | 读取授权根内指定文件 | 默认拒绝 |
| asset.create | 创建图片/导出资产 | 显式声明 |
| network.fetch | 访问指定域 | P0 不开放 |
| clipboard.readImage | 读取系统图片 | 仅核心图片粘贴 |
| process.spawn | 启动进程 | P0 禁止 |
| secrets.read | 凭据 | P0 禁止 |

本表是应用内部 `CapabilityBroker` 的逻辑能力，不等于 Tauri WebView ACL。`clipboard.readImage` 只能授给 Rust 核心资产 adapter，不得转化为前端插件或 guest JS 的通用剪贴板权限。

能力由主体、工作区、范围、操作和生命周期组成：

~~~text
CapabilityGrant {
  subjectId
  capability
  workspaceId?
  scope
  expiresAt / sessionOnly
}
~~~

### 12.2 规则

- 未声明即拒绝。
- manifest 声明不等于用户授权。
- 内建扩展也只能通过 broker，避免安全边界逐渐失效。
- 工作区授权不能自动提升为全磁盘授权。
- 网络能力未来按域名、方法、响应大小和凭据策略细分。
- capability 变更进入审计日志，但不记录正文或参数敏感值。
- 撤销权限后取消活动 operation，并把 feature 降级为只读/不可用。

## 13. 设置与持久化

每个扩展设置使用命名空间：

~~~text
extensions.<extensionId>.<settingKey>
~~~

设置 schema 必须声明：

- schemaVersion；
- 类型、默认值、枚举和范围；
- workspace/user 层级；
- 是否影响安全或性能；
- migration；
- 删除扩展后的清理策略。

持久化 ResourceRef、view state 或缓存也必须带 provider/extension ID 与版本。派生缓存必须可以完整删除并从 Markdown 重建。正文、恢复快照和用户资产不得只存在于扩展存储中。

## 14. 生命周期与故障隔离

~~~text
Discovered
  -> Validated
  -> Activated
  -> Suspended
  -> Deactivated
  -> Disposed

任意阶段 -- error/timeout --> Failed
Failed -- retry policy --> Validated or Disabled
~~~

- 激活可取消且幂等。
- 一个扩展失败不得阻止 AppShell、文件打开、正文保存和恢复。
- 扩展 disposal 必须注销命令、provider、listener、timer、worker 和缓存引用。
- 连续崩溃或超时的扩展自动禁用，并提供 Safe Mode。
- extension failure 不得卸载 DocumentSession 或丢弃 dirty 状态。
- 诊断记录 extensionId、版本、阶段和错误码，不记录用户正文。

P0 内建扩展与主包一起发布，仍需经过相同 registry 和故障边界。

## 15. 计划中的内部扩展

| 功能 | 主要扩展点 | 资源类型 | 数据真相 |
|---|---|---|---|
| Mermaid | BlockRenderer、Command | document 内 overlay | Markdown 代码块 |
| 数学 | BlockRenderer | document 内 widget | Markdown 公式源码 |
| 全文搜索 | Sidebar、ResourceProvider、Command | search | 可重建索引 |
| 反向链接 | Sidebar、LinkResolver | document/search | 可重建链接索引 |
| 知识图谱 | ResourceProvider、Sidebar | graph | 可重建链接索引 |
| Git diff | ResourceProvider、Command | git-diff | Git 与磁盘文件 |
| AI 问答 | ResourceProvider、Command、Capability | ai-answer | 外部响应缓存，引用回到 Markdown |
| 导出 | ExportProvider、Command | export job | Markdown + 版本化配置 |

这张表用于验证核心抽象。若某功能必须绕过 ResourceRouter、CommandRegistry 或 DocumentSession 才能实现，应先重新评审抽象，而不是增加私有通道。

## 16. 新功能设计清单

代理在新增 feature 前必须在任务文档回答：

1. 它是 markdown document 内行为还是新的 virtual Resource provider？
2. 用户数据的唯一真相在哪里？是否可重建？
3. 需要哪些命令、导航 disposition 和快捷键？
4. 是否修改正文？通过哪个 transaction 和 requirement ID？
5. 是否需要 Rust 能力？能否使用更窄的 capability？
6. 输入、输出、运行时间和缓存上限是什么？
7. 大文本、Safe Mode、离线和权限撤销时如何降级？
8. 如何取消？迟到结果如何识别？
9. 需要何种 schemaVersion 和 migration？
10. 扩展未安装或失败时，历史和文档如何显示？
11. 安全、隐私和许可证影响是什么？
12. 对应哪些自动化测试、性能基准和观察 span？

答案不完整时，只能做隔离原型，不得并入 P0 主路径。

## 17. API 版本与演化

- 内部契约从 V1 开始，判别联合新增成员属于需要消费者处理的变化。
- 接口字段只可新增可选字段；删除、改义或改变默认值需主版本。
- 命令 ID、Resource kind 和错误码在同一主版本内稳定。
- 持久化 ref 必须支持至少当前和前一个 schema 版本迁移。
- 未知字段应忽略，未知必需能力应拒绝，未知 Resource kind 应显示占位。
- 公共插件 SDK 前必须建立兼容测试套件、弃用周期、签名/来源、权限 UI 和隔离执行方案。
- 任何声称“第三方插件可用”的里程碑必须新增 ADR；本章本身不构成该承诺。

## 18. 测试与验收

- EXT-001：document、search、graph 三种 ResourceRef 使用同一 disposition 和每 Tab 历史模型。
- EXT-002：菜单、快捷键、按钮和命令面板调用同一命令 ID，enabled 状态一致。
- EXT-010：BlockRenderer 的超时、恶意 SVG、离屏卸载和版本缓存行为符合约束。
- SEC-010：未声明/未授权 capability 默认失败，撤销后活动任务被取消。
- provider 未安装时，恢复含未知资源的窗口不会崩溃。
- 扩展激活失败时仍能打开、编辑、保存和恢复 Markdown。
- generation 变化后，搜索、图表或 AI 的迟到结果不会覆盖当前资源。
- 大文本模式只激活声明支持的 EditorExtension。
- 扩展 disposal 后没有遗留命令、listener、worker 或定时器。

## 19. 代理实施边界

- 首个实现只建立最小 registry 和内建贡献，不创建动态第三方加载器。
- 每个 registry 由一个明确模块拥有；feature 只能在组合根注册。
- 跨扩展契约变更必须更新本章、第 03 章、类型测试和 PROJECT_STATE.md。
- 原型若绕过核心接口，必须位于 experimental feature flag 后并注明删除日期。
- 不得仅根据聊天内容新增扩展能力；以本章、ADR 和需求 ID 为准。
