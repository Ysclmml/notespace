# 06. 文件、资产与恢复

> **历史参考（baseline 0.1）**：当前只保留轻量预检、截图落盘和原子保存；staging journal、repair、quarantine、资产 GC 与完整 crash recovery 均已延期。见 [ADR-0005](../decisions/0005-lean-local-editor-boundary.md)。编辑 transaction、`sourceOnly` 与未编辑/首次可视编辑的序列化语义以 [ADR-0006](../decisions/0006-visual-editor-explicit-source-mode.md) 为准。

> 状态：Historical design baseline 0.1；当前文件/编辑交界基线为 0.3
> 所有者：Native Core  
> 主要需求：FILE-PREFLIGHT-001、FILE-SAVE-001、FILE-WATCH-001、ASSET-PASTE-001、ASSET-BASE64-001、ASSET-STAGING-001、ASSET-UNDO-001、RECOVERY-DIRTY-001、RECOVERY-LOOP-001  
> 依赖：[03-domain-model-and-contracts.md](03-domain-model-and-contracts.md)、[0004-pathological-input-guard.md](../decisions/0004-pathological-input-guard.md)

## 1. 目的与边界

本章记录 baseline 0.1 的完整生命周期探索。当前 Rust 文件能力和前端 DocumentSession 的执行契约只保留 `DESIGN.md`/`REQUIREMENTS.md`/ADR-0005 明确采用的轻量部分；编辑表面与序列化遵循 ADR-0006。

本章不规定编辑器视觉行为、Tab 历史或第三方插件 API；这些分别见第 04、05、08 章。

## 2. 不变量

后续实现和重构必须保持以下不变量。编号是稳定引用，不得悄悄改变含义。

| ID            | 不变量                                                                            |
| ------------- | --------------------------------------------------------------------------------- |
| FILE-INV-001  | 文件正文进入 WebView/任一编辑表面前必须完成 Rust 流式预检                         |
| FILE-INV-002  | 正常打开返回的正文必须对应一个不可伪造的 DocumentId 和 DiskRevision               |
| FILE-INV-003  | 保存必须使用 expected DiskRevision 做并发检查，禁止静默覆盖外部变化               |
| FILE-INV-004  | 成功保存只能确认请求中 snapshotSessionRevision 对应的快照；期间新增编辑仍为 dirty |
| FILE-INV-005  | 未编辑文档打开后直接保存必须保持原始字节一致                                      |
| ASSET-INV-001 | 图片字节成功持久化前，正文和编辑 Undo 栈不得改变                                  |
| ASSET-INV-002 | 图片粘贴不得把 data URI 或 Base64 内容写入 Markdown                               |
| ASSET-INV-003 | 正文 Undo 只撤销 Markdown 链接；资产删除由引用检查和延迟回收处理                  |
| REC-INV-001   | 恢复数据不得自动覆盖用户磁盘文件                                                  |
| REC-INV-002   | 上次导致打开失败的资源不得在下一次启动时自动进入主编辑器                          |
| PATH-INV-001  | WebView 传入的路径或链接只作为 locator 提示，最终规范化与授权判断由 Rust 完成     |

## 3. 文件标识与修订

### 3.1 DocumentId

DocumentId 是应用生命周期内用于会话去重的不透明标识。已持久化文件的 ID 由 Rust 根据已授权工作区、规范化绝对路径和平台文件身份生成；未命名文档由 `document_create_draft_v1` 在 Rust 中同时生成 DraftId/DocumentId。前端在两种情况下都不得自行拼接。

- macOS 首版至少执行绝对化、分隔符标准化、Unicode 规范化和符号链接解析。
- 路径大小写规则跟随所在文件系统，不可在 TypeScript 中统一转小写。
- 文件被重命名但底层身份可追踪时，Rust 可以保持 DocumentId；无法可靠追踪时产生新 ID 并显式迁移会话。
- DocumentId 不得写入 Markdown。
- 同一 `draftIntentId` 的创建重试必须返回同一 draft identity；空白新建本身建立 dirty session，关闭/退出仍走未命名文档确认。

### 3.2 DiskRevision

DiskRevision 是磁盘版本的不透明 token，用于 compare-and-save。实现可以综合文件身份、长度、mtime 和内容摘要，但前端只能进行相等比较和原样回传。

### 3.3 SessionRevision

SessionRevision 是前端 DocumentSession 的单调递增整数。每次正文 transaction 成功应用后加一；视图滚动、选择和导航不得改变它。

保存请求必须携带：

```text
documentId
expectedDiskRevision
snapshotSessionRevision
content 或受控内容句柄
encoding/newline/BOM 策略
```

保存结果必须携带：

```text
newDiskRevision
savedSessionRevision = snapshotSessionRevision
bytesWritten
```

前端仅在当前 SessionRevision 等于 savedSessionRevision 时标记 clean，否则更新磁盘基线但保持 dirty。

## 4. 打开与预检

### 4.1 打开流水线

```text
ResourceRef
  -> resource_resolve_v1：授权、规范化、分类
  -> document_open_v1：流式预检
  -> 判定 DocumentOpenOutcome
       editable(mode=normal)    -> 创建或复用完整 DocumentSession
       editable(mode=sourceOnly) -> 创建或复用 CodeMirror 降级 DocumentSession
       safetyBlocked            -> 打开安全处理页面，不创建 EditorView
       unsupported              -> 提示并建议交给外部程序
       AppError                 -> 错误页
```

系统文件关联、Finder “打开方式”和文件/目录拖入不把 OS path 交给 WebView。Rust 原生层先规范化并建立 grant-backed target，再通过 `app.openResourcesRequested` 有序投递：目录续接 workspace open，Markdown 文件进入同一 ResourceRouter/open 流水线；同一 native request 去重，批次内单项失败不阻断其他项。

预检禁止先整体读取为 String 再统计。Rust 必须以有上限的缓冲区流式统计：

- 总字节数；
- 前若干 KiB 的编码特征和 BOM；
- 最大物理行长度；
- 可疑 data URI 起点、MIME、估算解码大小和区间；
- NUL 字节及明显二进制比例；
- 换行风格；
- 在策略需要时计算内容摘要。

### 4.2 默认模式

阈值属于版本化 `PerformancePolicy`，不可散落硬编码在 UI。首版默认值：

| 结果                  | 默认条件                                                    | 行为                                                                                  |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| editable / normal     | 文件不超过 8 MiB，最大行不超过 256 KiB，未发现超限 data URI | 默认 Milkdown/ProseMirror 可视编辑，可显式切换 CodeMirror 源码                        |
| editable / sourceOnly | 超过 8 MiB 的普通 UTF-8 多行文本，或较长但未阻止的物理行    | 保留 CodeMirror 纯文本编辑、搜索和保存；关闭可视编辑、Outline、Mermaid 和全量链接索引 |
| safetyBlocked         | 单行超过 1 MiB，或图片 data URI 估算解码量超过 512 KiB      | 不向 WebView 返回正文；展示简短说明                                                   |
| unsupported           | 二进制、无法无损支持的编码或策略明确拒绝                    | 不承诺内置编辑，可在系统编辑器打开                                                    |

阈值是保守初始值，只有基准测试和 ADR 可以调整。用户单次选择“仍以大文本打开”只能越过性能提示，不能越过安全页对病态内容的阻断。

### 4.3 编码与字节保持

P0 支持 UTF-8、UTF-8 BOM 和常见 LF/CRLF。为满足零差异：

- DocumentSession 保存原始编码标记、BOM 和主换行风格。
- 未发生正文 transaction 时，“保存”不得重新序列化文件。
- 仅打开、导航、选择、滚动或切换可视/源码模式不得序列化或标 dirty。
- 首次可视正文编辑后 Milkdown/ProseMirror serializer 可以规范化整篇等价 Markdown，包括表格空格和换行表达；源码模式仍按文本 transaction 精确修改。
- 无法无损解码的文件进入 Unsupported 或显式转码流程，不得替换非法字节后静默保存。

### 4.4 安全页

SafetyBlocked 是正常产品状态，不是崩溃兜底。页面至少展示：

- 文件名和近似大小；
- 阻断原因，不展示完整可疑行；
- 可疑区间数量、MIME 和估算解码大小；
- “备份并删除可疑片段”；
- “提取图片并替换为相对链接”；
- “使用系统程序打开”；
- 取消。

所有修复由 Rust 基于 repairToken 流式执行。token 必须绑定文件身份和 DiskRevision；文件改变后旧 token 返回 ERR_STALE_TOKEN，禁止按旧偏移修改新内容。

P0 修复采用唯一写入语义：用户明确确认后先生成可定位的同目录备份，再对原文件执行 revision 检查和原子替换。另存修复副本可在 P1 通过新增契约提供，P0 不允许实现端自行选择另一种模式。

## 5. 保存协议

### 5.1 正常保存

FILE-SAVE-001 的最小算法：

1. 前端捕获 immutable 文本快照和 snapshotSessionRevision。
2. Rust 校验 capability、DocumentId、expectedDiskRevision、请求大小和编码策略。
3. 在目标文件同目录创建仅当前用户可访问的随机临时文件。
4. 完整写入并 flush；平台支持时 fsync 文件。
5. 再次验证目标 revision 未变化。
6. 使用平台适配的原子 replace/rename。
7. 平台支持时 fsync 父目录。
8. 返回 newDiskRevision；清理临时文件。

禁止在目标文件上 truncate 后原地写入。保存失败不得改变磁盘基线或把会话标为 clean。

### 5.2 Save As

Save As 使用第 03 章冻结的 durable-intent 两阶段契约：

1. Application Core 生成稳定 saveAsIntentId；document_prepare_save_as_v1 通过原生对话框取得目标授权，校验冲突、持久化 intent journal，并返回短期 saveAsToken 与 staging URI replacement plan；此阶段不写用户 Markdown。
2. 前端短暂冻结该 session 的正文输入，以 addToHistory=false 且可反向的单个 transaction 应用全部 replacement。
3. 前端把规范化后的正文、snapshotSessionRevision、intent 和 token 交给 document_save_as_v1；Rust 在任何用户文件提交前把 final-content handle 与 committing phase 落入 journal。
4. Rust 先安全提交目标资产，再原子保存 Markdown 并持久化 committed outcome；失败时清理本次目标产物，前端反向应用 replacement，原 staging 和恢复稿保持有效。提交成功后在前端 ack 前也保留原 staging/recovery alias。
5. 成功后当前 DocumentSession 保持原 DocumentId，更新 locator、descriptor 和磁盘基线；draft 晋升不得创建第二份正文会话。已有文件 Save As 时，当前显示该 session 的 NavEntry 以 replace 更新到新 locator，不 push 历史；非当前旧历史仍指向原文件，未来打开原文件会得到新的 DocumentId。rebind 和必要恢复状态落地后，前端以 committed disk revision ack，Rust 才清旧 staging/alias/journal payload。

`document_save_as_v1` 按 intent 幂等；提交后响应丢失时调用 status，重启时由 app reconcile/recovery 发现未 ack journal。crash 位于任意 committing 子阶段时，Rust 依据 commit marker、目标 revision 与资产 manifest 确定性完成或回滚，不能让前端通过“文件似乎存在”猜终态。

prepare 返回后用户若在相对链接警告或确认阶段取消，必须调用 `document_save_as_abort_v1` 幂等终止 prepared journal；前端若已应用 URI plan，先保持冻结，待 abort 成功后以非 undo 反向 transaction 恢复。abort 不得作用于 committing/committed，遇到该状态只能 status/reconcile 并接纳唯一终态。

已有普通相对链接默认不自动重写。若目标基目录变化，prepare 返回 `relativeLinkImpact=baseDirectoryChanged`，UI 统一警告“普通相对链接可能改变解析结果”并允许取消；P0 不声称已经逐条分析链接。旧文件保持不变；当前 entries 随 session rebind replace 为新 `ResourceRef`，非当前历史保留旧 `ResourceRef`/locator，历史不保存 `DocumentId` 或正文。

### 5.3 保存冲突

当 expectedDiskRevision 与当前磁盘版本不同，Rust 返回 ERR_REVISION_CONFLICT，并提供最新 revision 和有限元数据，不直接返回第二份大正文。

前端必须提供：

- 通过 document_read_disk_snapshot_v1 查看差异，不修改当前 dirty session；
- 重新加载磁盘版本；
- 保留当前内容并另存；
- 用户明确确认后覆盖；
- 取消。

有 dirty 缓冲时禁止自动 reload。覆盖必须走 document_resolve_conflict_v1，并携带用户确认时观察到的 observedDiskRevision；磁盘再次变化时再次冲突，普通 save 没有 force 开关。

### 5.4 自动保存与恢复写入

P0 默认手动保存，恢复 checkpoint 始终开启；P1 可提供默认关闭的用户级或工作区级自动保存。两者必须明确区分：

- checkpoint 不改变 DiskRevision；
- checkpoint 不触发文件 watcher 的业务事件；
- checkpoint 失败必须记录且在适当时提示，但不能阻断正文输入；
- checkpoint 只用于灾难恢复，不能作为长期文档存储。

## 6. 外部修改与文件监听

### 6.1 事件模型

Rust watcher 事件只表示“可能发生变化”，不是权威事务日志。事件必须去抖、归并，并通过重新 stat/hash 得出 authoritative change。

事件类别：

| 事件             | clean 会话                                                                                            | dirty 会话                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 内容修改         | 可自动重载，并保留可映射视图状态                                                                      | 标记 Conflict，禁止静默覆盖                               |
| 删除             | 标记 Missing，允许另存或重新创建                                                                      | 进入 Conflict(reason=deleted)，保留内存正文且不得自动重建 |
| 重命名/移动      | 能可靠配对时更新 locator                                                                              | 更新 locator，同时保持 dirty                              |
| 权限丢失         | 保留 session/buffer，设置 `descriptor.readOnly=true` 并显示 typed banner；连读取也失败时仍不丢 buffer | 保留 dirty，标记 readOnly，并提供重新授权或另存           |
| watcher overflow | 工作区权威重扫                                                                                        | 工作区权威重扫，会话逐个核对                              |

应用自身保存产生的 watcher 事件通过 canonical `writeId + observedDiskRevision` 归并为 `source="ownWrite"`，不能触发“外部修改”提示。`operationId` 只用于任务关联/取消，不代替磁盘写入身份。

权限变化通过第 03 章的 `document.externalChanged(change="permissionChanged")` 与 `workspace.capabilityChanged` 表达，不伪造成文件内容变化。前端立即更新 `descriptor.readOnly`、使旧 capability epoch/token 失效；无论 clean/dirty 都保留 buffer，dirty session 继续 checkpoint 并提供重新授权或 Save As。

### 6.2 冲突状态机

```text
Clean
  -- local edit --> Dirty
Clean
  -- external change --> Reloading --> Clean
Reloading
  -- local edit --> Dirty（取消/作废迟到 reload；不得替换新编辑）
Clean
  -- external delete --> Missing
Dirty
  -- external change --> Conflict
Dirty
  -- external delete --> Conflict(reason=deleted)
Conflict
  -- reload disk --> Clean
Conflict
  -- save as --> Dirty or Clean
Conflict
  -- confirmed overwrite --> Clean or Dirty
SaveError
  -- retry --> Saving
  -- edit --> Dirty
  -- save as --> Saving
  -- close request --> Closing
Missing
  -- save as --> Saving
  -- confirmed recreate(expected=absent) --> Saving
  -- edit --> Dirty（仍须显式 recreate/save as）
  -- close request --> Closing
Closing
  -- confirm save --> Saving
  -- confirm don't save --> Discarding
  -- cancel --> previous state
Discarding
  -- success --> Closed
  -- failure --> previous state
```

Conflict 状态允许继续编辑和生成恢复 checkpoint，但普通 Save 必须持续被拒绝，直到用户选择解决策略。reload/recreate 的完整 outcome、SafetyBlocked 回退和竞态规则以第 03 章为准；任何失败出边都保留当前 buffer。

## 7. 剪贴板图片事务

### 7.1 触发规则

粘贴时前端只读取剪贴板类型摘要，真实图片字节由 Rust 原生能力读取。处理优先级：

1. 存在系统图片表示：执行图片导入。
2. 只有文件 URL 且文件为允许的本地图片：执行受控复制或引用策略。
3. 只有 HTML 且包含 data URI：不得直接插入；可提示提取为资产。
4. 普通文本：进入 data URI 粘贴闸门，安全后交给编辑器。

截图图片默认编码优先：

- 保留无损像素且含透明通道时 PNG；
- 原剪贴板明确为 JPEG 且无需重编码时可保留 JPEG；
- P0 不自动转 WebP/AVIF，以避免兼容差异。

### 7.2 两阶段流程

```text
PasteIntent(pasteIntentId, sessionId, anchorRevision, selection)
  -> asset_import_clipboard_v1
       -> 读取图片、校验维度和解码上限
       -> 计算摘要、选择名字
       -> 若资产目录未授权，返回 needsGrant(grantRequestId, owner, pasteIntentId)
          -> resource_grant_v1 -> assetDirectoryGranted
          -> 以同一 owner/pasteIntentId 幂等重试
       -> 写 staging 或最终 assets
       -> 原子提交
  <- imported(AssetRef(assetId, state, markdownUri, mime, dimensions))
  -> 前端验证 session 仍存在且锚点可映射
  -> 当前编辑表面的单个正文 transaction 插入 Markdown 链接
  -> 插入失败或被取消时调用 asset_release_v1
```

任意步骤失败：

- 正文、dirty 和 undo 栈不变；
- 已落盘但未插入的资产通过 asset_release_v1 标为 orphan candidate；
- 错误可重试但同一 pasteIntentId 必须幂等，禁止生成重复文件。

资产目录只读、权限撤销、磁盘/配额耗尽、名称冲突与路径冲突由 `AppErrorDetails.kind="assetWrite"` 的稳定 `cause` 区分；UI 禁止匹配错误 message。授权缺失使用 `needsGrant` 正常 outcome，不冒充通用写入失败。

若用户在图片处理期间继续输入，锚点通过 session revision/change mapping 前移；可视与源码表面都必须映射到最新正文位置。无法可靠映射时，在当前光标处确认插入或取消，禁止默默插到错误段落。

### 7.3 资产路径策略

默认工作区配置：

```text
assetDirectory: "./assets"
pathStyle: "relative-to-document"
namePattern: "{documentStem}-{yyyyMMdd-HHmmss}-{hash8}.{ext}"
deduplicateByContent: true
```

工作区外单文件使用同一相对规则，默认目标为该文档同级的 assets 目录。已保存的工作区/standalone 文档使用 `owner={kind:document, documentId}`；未保存草稿使用 `owner={kind:draft, draftId}`。Rust 由 locator 映射 canonical `ResourceScope`：workspace locator 使用 workspace scope，grantedFile 使用 document scope，draft staging 使用仅限 app recovery ledger 的 draft scope；Save As 晋升后才转成 document/workspace scope。若平台授权只覆盖单文件而不覆盖相邻目录，asset import 返回绑定 owner/`pasteIntentId` 的 `needsGrant(assetDirectory)`，通过 `resource_grant_v1` 原生授权后幂等重试；禁止改用绝对链接或 Base64 规避权限。

规范：

- 实际写入路径由 Rust 解析并校验仍在授权根内。
- Markdown 使用正斜杠和 URI 百分号规则；显示文本不使用绝对路径。
- 同内容摘要已存在时可复用资产，但不得用不可信文件名覆盖已有文件。
- 文件名冲突使用确定性后缀。
- alt 文本默认 screenshot，可由用户直接编辑；不得把剪贴板敏感元数据自动写入 alt。
- EXIF 默认不主动解析；若未来做隐私清理，必须是显式且可配置的导入策略。

### 7.4 未保存文档

未保存文档没有稳定相对路径，图片必须先写到应用恢复目录中的 draft staging：

```text
appData/recovery/drafts/{draftId}/assets/{assetName}
```

首次 Save As 的 AssetMigration 必须复用第 5.2 节 durable-intent 协议：prepare 返回所有 URI replacement，前端一次应用，Rust 在 document_save_as_v1 中先提交资产再提交 Markdown。任一步失败都回滚 replacement 并保留 staging，允许以同 intent 查询/重试；已提交但未 ack 也保留 recovery alias，禁止提前删除导致崩溃恢复断链。

草稿正文和预览只使用 Rust 返回的 `AssetRef.markdownUri`；它解析为 `{kind:"asset", scope:{kind:"draft", draftId}, ...}`，Rust 每次按恢复 ledger/AssetId 校验，前端不得自行拼装 scheme。checkpoint 持久化 draft ledger 引用，`recovery_open_v1` 重新绑定同一 draft scope，故崩溃恢复后图片仍可预览。该临时 URI 只能存在于恢复稿，`document_save_as_v1` 必须验证最终 Markdown 中不再含任何 staging URI。

### 7.5 Undo、Redo 与回收

- 图片链接插入是一个正文 transaction，Undo/Redo 与普通文本一致。
- Undo 不同步删除文件，因为 Redo、其他文档或并发视图可能仍引用它。
- Asset GC 只处理应用创建且带元数据记录的 orphan candidate。
- GC 必须满足：超过宽限期、无打开会话引用、工作区引用扫描未发现、没有活动 migration。
- 默认宽限期至少 24 小时；产品可选择只提供人工清理。
- 用户原有资产文件永不由自动 GC 删除。

## 8. 大 data URI 的粘贴防护

文本粘贴在创建 ProseMirror 或 CodeMirror transaction 前检查：

- 剪贴板文本总长度；
- 是否匹配 data:image/...;base64,；
- 单行长度；
- 估算解码大小。

若 data image 估算超过 512 KiB 或文本行超过 1 MiB：

- 禁止把文本交给 EditorView；
- 正文长度、selection、dirty、SessionRevision 和 Undo 栈保持不变；
- 可解码的图片 data URI 提供“保存为图片资产并插入链接”“取消”；解码/校验失败只提供“复制安全诊断详情”“取消”；
- 提取必须由 Rust 流式解码，校验 MIME、魔数、像素尺寸和解码上限；
- 解码失败只显示摘要错误，日志不得记录 data URI。

小 data URI 默认也不直接写入 Markdown；可以提取为资产。用户如果确实要粘贴代码示例，必须选择“作为代码文本粘贴”，并继续受文档大小策略约束。

## 9. 崩溃恢复

### 9.1 恢复内容

每个 dirty DocumentSession 保存独立 checkpoint：

| 字段                      | 说明                                                            |
| ------------------------- | --------------------------------------------------------------- |
| recoverySchemaVersion     | 恢复格式版本                                                    |
| documentId / locator hint | 仅用于匹配，重新打开仍需授权与解析                              |
| baseDiskRevision          | 编辑开始时磁盘基线                                              |
| sessionRevision           | checkpoint 对应修订                                             |
| persistedSessionRevision  | checkpoint 时最后成功持久化的 session 修订，用于恢复 dirty 推导 |
| content                   | 压缩正文或受控增量 journal                                      |
| timestamp                 | 生成时间                                                        |
| stagingAssetRefs          | 草稿资产引用                                                    |
| pendingSaveAsIntentId     | 可选；把 checkpoint 与未 ack Save As journal 关联               |
| integrityHash             | 检测损坏                                                        |

P0 推荐周期性完整压缩快照配合防抖，而不是先实现复杂操作日志。触发条件：

- dirty 后静默 2 秒；
- 每 30 秒最多补一次；
- Tab/窗口关闭前；
- 应用进入后台或系统休眠前；
- 高风险资产迁移前。

checkpoint 写入使用应用数据目录中的临时文件和原子替换。正文内容必须有磁盘配额和保留策略。

### 9.2 启动恢复

启动顺序：

1. 标记本次启动为 in-progress。
2. 读取上次 clean-shutdown 标记、crash manifest 和未 ack Save As journal；先把 committing intent 确定性完成或回滚。
3. 如果上次异常退出，先进入恢复中心，不自动打开可疑文件；committed Save As 以新 descriptor/final snapshot 恢复，绝不重放旧 staging URI。
4. 对每个 checkpoint 比较当前 DiskRevision，并关联 pendingSaveAsIntentId。
5. 提供恢复到新缓冲、查看差异、丢弃、另存；不得自动覆盖磁盘。接纳 committed Save As 后才 ack/清旧 alias。
6. 应用稳定运行后更新启动健康标记；正常退出写 clean-shutdown。

### 9.3 崩溃循环保险

记录启动阶段最后正在打开的 ResourceRef、outcome 和失败计数。若上次启动在打开某资源期间异常退出，则紧接着的下一次启动：

- 禁止自动恢复该资源，先加载可操作的工作区外壳；
- 直接显示 Safe Mode；
- 不创建该资源的 EditorView 或 Mermaid renderer；
- 提供在安全页预检、移出最近列表、重命名或系统打开。

Safe Mode 必须同时禁用第三方扩展和恢复未提交布局，确保用户可进入应用。

## 10. 关闭语义

- 关闭一个 Tab 只释放 DocumentView；DocumentSession 是否释放由引用数、dirty、任务和恢复状态共同决定。
- 已保存文件的最后一个可见 View 关闭但会话 dirty 时不弹阻塞对话框；会话进入全局“未保存文档”列表并立即 checkpoint。
- 最后一个未命名 draft View 关闭时必须提供保存、不保存和取消；关闭工作区或应用时统一确认所有仍 dirty 的会话。
- “不保存”不是仅丢前端对象：Application Core 冻结 session 并以当前 revision 调用 `session_discard_v1`；成功后才关闭。已保存文档只清本次恢复记录/未提交 app 资产，draft 还把 recovery+staging 根先原子 tombstone 再释放 identity；失败保持 dirty UI 可重试，取消则不调用。
- 原生窗口关闭先由 Rust hold 并产生稳定 closeRequestId；监听器晚注册或 app-scope gap 时通过 `app_state_reconcile_v1` 取回同一请求。关闭窗口时汇总 dirty 会话，一次性展示；逐文件保存结果可失败，不得因为部分成功而丢弃其他缓冲。
- 用户取消时以匹配 id 调 `app_close_respond_v1(cancel)`；只有所有选择保存/不保存的 session 都成功到达安全终态后才调 `proceed`。任一 save/checkpoint/discard 失败都保持 hold 和 UI，禁止先关闭窗口；重复 response 按 id 幂等。
- checkpoint 只用于强制退出前尽力保护尚未解决的 dirty 内容，不能把 session 变 clean，也不能替代用户的保存/不保存选择；“只有 checkpoint 成功”仍不得发送 proceed。
- 应用强制退出前无法完成保存时，必须尽力完成已有 checkpoint，不得把不完整 snapshot 标为有效。

## 11. 稳定错误码

Rust 错误消息可本地化变化，但错误码和结构在同一 API 主版本内稳定：

| 错误码                     | 含义                        | 默认 UI                |
| -------------------------- | --------------------------- | ---------------------- |
| ERR_NOT_FOUND              | 目标不存在                  | 保留会话，定位或另存   |
| ERR_PERMISSION_DENIED      | 无权限                      | 重新授权或另存         |
| ERR_REVISION_CONFLICT      | 磁盘版本变化                | 冲突解决页             |
| ERR_INVALID_UTF8           | 无法无损解码                | 转码说明/系统打开      |
| ERR_UNSAFE_CONTENT         | 病态内容被阻断              | 安全页                 |
| ERR_FILE_TOO_LARGE         | 超出内置上限                | 外部工具建议           |
| ERR_STALE_TOKEN            | repair/save-as token 已失效 | 重新预检或准备         |
| ERR_CLIPBOARD_NO_IMAGE     | 无可导入图片                | 退回普通粘贴           |
| ERR_UNSUPPORTED_IMAGE      | 格式、维度或内容不安全      | 取消并说明             |
| ERR_ASSET_WRITE_FAILED     | 资产无法落盘                | 正文不变，允许重试     |
| ERR_ASSET_MIGRATION_FAILED | 草稿资产迁移失败            | 保留 staging，允许重试 |
| ERR_RECOVERY_CORRUPT       | checkpoint 校验失败         | 隔离文件，不自动删除   |
| ERR_CANCELLED              | 用户或新任务取消            | 静默或轻提示           |

## 12. 测试与验收

本章最低验收：

- FILE-001：故障注入覆盖临时文件创建、写入、flush、replace 各阶段；原文件要么旧版本完整，要么新版本完整。
- FILE-002：外部修改在 clean/dirty/Missing/rename 四种状态得到规定结果。
- FILE-004：保存与外部修改竞态不会静默覆盖。
- ASSET-001：并发连续粘贴 20 张图片，每个 pasteId 恰好生成一个链接和至多一个有效资产。
- ASSET-002：未保存文档崩溃重启后，staging 图片仍可预览并可在 Save As 后迁移。
- ASSET-003：Undo、Redo、关闭文档和 GC 不删除仍有引用或用户原有资产。
- SAFE-001：正文只在 DocumentOpenOutcome.kind=editable 且 mode=normal/sourceOnly 时返回 WebView。
- SAFE-002：所有图片剪贴板路径均不产生 Base64 Markdown。
- SAFE-003：粘贴或打开 10 MiB 单行 data URI 均不创建主 EditorView。
- REC-001：kill -9 后可恢复 dirty 内容，且磁盘原文件不被修改。
- REC-002：上次启动在打开资源时异常退出后，下一次启动隔离该资源并进入 Safe Mode。

完整测试矩阵见 [09-testing-observability.md](09-testing-observability.md)。

## 13. 实施边界与代理交接

实现该领域的代理必须：

1. 先读取根目录 AGENTS.md、PROJECT_STATE.md、本章、第 03 章和 ADR-0004。
2. 在代码和测试中引用本章不变量或 REQUIREMENTS ID。
3. 不改变阈值、错误码、恢复格式或保存语义而不更新文档和 ADR。
4. 在 PROJECT_STATE.md 记录新增命令、schema 版本、迁移、故障注入结果和未完成项。
5. 若前端和 Rust 契约未冻结，只能提交接口草案和契约测试，不得在两端各自猜测字段。
