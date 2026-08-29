# 09. 测试、可观测性与质量门禁

> 状态：Approved design baseline 0.1  
> 所有者：Quality / Platform  
> 适用范围：全部 P0、P1 和未来扩展  
> 需求索引：[REQUIREMENTS.md](../REQUIREMENTS.md)  
> 实施编排：[IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md)

## 1. 目的

本章把需求、领域契约和性能安全目标转换成可重复的验证证据。它还规定多代理并行实现时如何命名测试、隔离 fixture、记录失败和完成交接。

测试不是实现后的补充。任何 P0 功能必须在开始实现前能指出对应 requirement ID、test ID、fixture 和所属测试层。

## 2. 质量不变量

| ID | 不变量 |
|---|---|
| QA-INV-001 | 每条 P0 requirement 至少有一个自动化 test ID 或有时限的人工验证理由 |
| QA-INV-002 | 测试名称必须包含稳定 test ID，任务/提交必须引用 requirement ID |
| QA-INV-003 | 测试不得修改用户真实语料；真实工作区只允许显式只读本机验收 |
| QA-INV-004 | 文件、恢复和资产测试必须在隔离临时目录运行并在失败时保留可诊断摘要 |
| QA-INV-005 | 性能结果必须标注构建、机器、fixture、样本数和测量边界 |
| QA-INV-006 | 日志与测试 artifact 禁止包含正文、剪贴板、Base64 或未脱敏绝对路径 |
| QA-INV-007 | flaky 测试不得静默重试后视为健康；重试结果必须可见并有负责人 |
| QA-INV-008 | 任何 schema、IPC、持久化格式或安全策略变更必须有兼容/迁移测试 |

## 3. 测试层次

~~~text
                    少量：桌面端到端
              应用集成 / 契约 / 故障注入
          组件交互 / 编辑器 harness / 可访问性
      大量：TypeScript 与 Rust 领域单元、属性测试
    Golden corpus / fuzz / 性能与安全专项横向覆盖
~~~

建议工具基线：

| 层 | 工具 | 用途 |
|---|---|---|
| TypeScript 单元 | Vitest | reducer、router、link、revision、命令 |
| React 组件 | Testing Library + Vitest | AppShell、错误态、面板和无障碍 |
| CodeMirror harness | Vitest + DOM 环境/真实浏览器 | transaction、IME、decoration、view state |
| Rust 单元/集成 | cargo test 或 nextest | 预检、路径、保存、恢复、资产 |
| 属性测试 | proptest / fast-check | 路径、Markdown round-trip、状态机序列 |
| Web UI 集成 | Playwright | 浏览器 harness 中的 Tab、导航、查看器 |
| Tauri 桌面 E2E | 平台可用的 WebDriver/Tauri harness | 原生对话框外的端到端主路径 |
| 性能 | Criterion + 浏览器 Performance API | Rust 流式任务和 UI 延迟 |
| 安全 | cargo-fuzz、恶意 corpus、依赖扫描 | parser、路径、HTML/SVG、IPC |

具体包在 Phase 0 技术验证后冻结；改变工具不改变本章测试 ID 和验收含义。

## 4. Fixture 体系

### 4.1 目录约定

~~~text
tests/
  fixtures/
    markdown/
      canonical/
      tables/
      links/
      mermaid/
      images/
      encodings/
      pathological/
      malicious/
    workspaces/
      navigation-basic/
      unicode-paths/
      conflicts/
    assets/
    recovery/
  golden/
  perf/
  e2e/
~~~

每个 fixture 旁放 manifest：

~~~yaml
fixtureVersion: 1
id: markdown.tables.dense-001
purpose: GFM 密集表格 round-trip
encoding: utf-8
newline: lf
expectedMode: editable
sensitive: false
generatedBy: tools/generate-fixtures
~~~

病态大 fixture 不必提交数十 MiB 文件；优先提交确定性生成脚本、摘要和参数。CI 在临时目录生成，测试验证 hash，避免仓库膨胀。

### 4.2 真实语料

用户指定的“阅读”目录只作为本机可选回归语料；绝对路径由本地测试参数提供，不写入仓库：

- 测试以只读方式复制到 mktemp 临时目录后运行；不得原地保存。
- 结果仅记录大小 bucket、通过数和脱敏错误码。
- 不提交内容、不上传 artifact、不在日志输出文件正文。
- CI 使用结构等价的脱敏合成语料：79 文件、密集 GFM 表格、约千条相对链接、中文路径、Mermaid 和图片。

### 4.3 核心语料族

| 族 | 必含情况 |
|---|---|
| canonical | 空文件、纯文本、标题、列表、引用、代码、强调、转义、HTML 源码 |
| tables | 对齐、空格、转义管道、代码内管道、宽表、连续约 300 表 |
| links | 相对路径、中文、空格、百分号、重复标题、跨文件 anchor、断链、目录链接 |
| mermaid | flowchart、中文节点、语法错误、超限节点、恶意 click/HTML |
| images | PNG/JPEG/SVG、透明、超大尺寸、损坏、错误 MIME、远程 URL |
| encodings | UTF-8、BOM、LF、CRLF、混合换行、非法 UTF-8 |
| pathological | 10 MiB 多行、10 MiB 单行 Base64、1 MiB 行边界、数千嵌套标记 |
| malicious | 路径逃逸、符号链接、javascript URL、HTML/SVG 事件、解码炸弹 |
| recovery | dirty 快照、损坏快照、磁盘 revision 变化、staging 资产、启动循环 |

## 5. 可追踪测试目录

以下 ID 是最低稳定目录。实现可以拆成多个用例，但不得降低验收含义。

### 5.1 数据与编辑

| Test ID | 覆盖需求 | 自动化断言 |
|---|---|---|
| RT-001 | DATA-SOURCE-001、DATA-ROUNDTRIP-001 | 全 canonical 与真实脱敏语料 open -> 无编辑 save，输出字节与输入 hash 一致 |
| RT-002 | DATA-UNKNOWN-001 | 未识别语法显示为源码，其他区域编辑保存后未知区间字节不变 |
| CORE-001 | DATA-REVISION-001 | 随机 transaction 序列中 SessionRevision 单调且迟到 revision 被拒绝 |
| EDT-LIVE-001 | EDIT-LIVE-001 | 光标跨标题/链接/表格/代码块时，仅安全活动范围切回源码 |
| EDT-UNDO-001 | EDIT-UNDO-001 | 正文事务可 Undo/Redo；滚动、导航、后退不进入编辑 Undo |
| IME-001 | EDIT-IME-001 | 中文拼音 composition 全程不切 decoration、不重复字符，结束后再更新 |
| TABLE-001 | EDIT-TABLE-001 | GFM 表格预览可读，进入源码再退出后未编辑字节不变 |
| TABLE-010 | EDIT-TABLE-002 | P1 网格只提交用户确认的单个表格区间，外围原文不变 |
| LINK-EDIT-001 | EDIT-LINK-001 | 渲染态链接可导航；编辑态单击只定位，显式命令才打开 |
| FIND-001 | EDIT-FIND-001 | Unicode literal 上/下一个与大小写切换正确；replace one/all 只改匹配范围、可 Undo，largeText 可用 |

### 5.2 Mermaid 与视觉块

| Test ID | 覆盖需求 | 自动化断言 |
|---|---|---|
| VIS-001 | EDIT-MERMAID-001 | 仅视口附近懒渲染；一块语法/超时失败不影响输入和其他块 |
| VIS-002 | EDIT-MERMAID-002 | 全屏支持 Fit、缩放、平移、复位、Esc、返回源码，SVG 保持清晰 |

### 5.3 导航与 Tab

| Test ID | 覆盖需求 | 自动化断言 |
|---|---|---|
| NAV-CORE-001 | NAV-MODEL-001 | 同文件两个 Tab 共享 Session 内容/dirty，View/History 独立 |
| NAV-CORE-002 | NAV-ASYNC-001 | A->B->C 快速导航时 B 的迟到加载不会覆盖 C |
| HISTORY-001 | NAV-HISTORY-001 | 每 Tab back/forward 独立，后退后新导航截断该 Tab forward |
| HISTORY-RESTORE-001 | NAV-RESTORE-001 | Back 恢复顶部源码块+像素偏移、selection 和 folds |
| NAV-DISP-001 | NAV-DISPOSITION-001 | 点击、修饰键、中键、文件树和搜索入口 disposition 一致 |
| PEEK-001 | NAV-PEEK-001 | Peek 只走有界、可取消 preview port，不取完整正文；不 push history、不创建可编辑 Session/View、不改变 dirty |
| SPLIT-001 | NAV-SPLIT-001 | P1 两 View 共享 Session，选择/滚动独立，revision 顺序一致；恢复保留左右各自 activeTab 与 focusedPane |
| LINK-001 | NAV-ANCHOR-001 | 中文/空格路径、相对链接、重复 heading slug 和跨文件 anchor 正确 |
| WORKSPACE-001 | NAV-WORKSPACE-001 | 文件树/大纲/Quick Open 键盘可用、消费完整 generation，旧查询可取消且所有结果走统一 Router；空工作区 reveal 只提交 workspaceRoot target |

### 5.4 文件、资产与恢复

| Test ID | 覆盖需求 | 自动化断言 |
|---|---|---|
| SAFE-001 | FILE-PREFLIGHT-001 | Rust 先完成有序预检；normal/largeText、SafetyBlocked、Unsupported 四类边界正确；binary 有独立 Unsupported reason/actions，且只有 editable outcome 可携带正文 |
| FILE-SCOPE-001 | FILE-OPEN-001 | 工作区与 standalone 文件均由原生 grant 打开；raw path、伪造/过期 grant 和 needsGrant 换目标被拒绝；native 批量 open/drop 去重、有序并遵守 focus/disposition policy |
| FILE-001 | FILE-SAVE-001 | 各 I/O 故障点后目标文件始终为完整旧版或完整新版，无半写 |
| FILE-002 | FILE-WATCH-001 | clean 自动重载、dirty 进入 conflict，Reloading 期间输入不被迟到结果覆盖；删除/move/permission/overflow 行为符合第 06 章；超 1 MiB 目录清单分页重扫只在完整 final page 后原子接纳 |
| FILE-004 | DATA-CONFLICT-001 | compare-and-save 与 watcher 竞态均不能静默覆盖；读取磁盘 compare snapshot 不修改 dirty/undo/history |
| ASSET-001 | ASSET-PASTE-001 | 工作区与 standalone 文件的资产原子落盘后才产生一个链接；needsGrant 以同 pasteIntentId 续接且不重复，typed I/O cause 可区分，授权/写入/插入失败正文按契约保持 |
| SAFE-002 | ASSET-BASE64-001 | 图片、HTML data image 和文件 URL 各粘贴入口均不写 Base64 Markdown |
| ASSET-002 | ASSET-STAGING-001 | 未保存文档图片以 draft ResourceScope/ledger 预览，崩溃恢复后仍可见；Save As 迁移完整且链接有效 |
| ASSET-003 | ASSET-UNDO-001 | Undo 仅撤链接；有引用、宽限期内和用户原有资产不被 GC |
| REC-001 | RECOVERY-DIRTY-001 | 强制终止后恢复最新合格 checkpoint，不改变磁盘文件 |
| REC-002 | RECOVERY-LOOP-001 | 上次启动在打开某资源时异常退出后，下次启动隔离该资源且不自动创建 EditorView |

### 5.5 性能与安全

| Test ID | 覆盖需求 | 自动化断言 |
|---|---|---|
| PERF-001 | PERF-VIEWPORT-001 | 屏外昂贵块未实例化，滚动增量创建/释放，内存有界 |
| PERF-002 | PERF-OPEN-001 | 参考机真实最大文档冷开 p95 < 500 ms |
| PERF-003 | PERF-TAB-001 | 已缓存 Tab 切换 p95 < 100 ms |
| PERF-004 | NAV-RESTORE-001 | 已缓存 Back 恢复资源与锚点定位 p95 < 150 ms；不与 Tab 切换样本混算 |
| PERF-010 | PERF-LARGE-001 | 10 MiB 普通多行文件 2 s 内进入 editable/largeText |
| SAFE-003 | SAFE-DATAURI-001 | 10 MiB 单行 data URI 打开 1 s 内安全页；粘贴不产生 transaction |
| SEC-001 | SAFE-IPC-001 | 未授权命令、伪造 ID、错误版本、超限载荷和重放被拒绝 |
| SEC-002 | SAFE-URL-001 | 路径遍历、symlink 逃逸和危险/未知 scheme 默认拒绝；http/https/mailto 只由用户命令交系统应用 |
| SEC-003 | SAFE-RENDER-001 | 恶意 HTML/SVG/Mermaid 无脚本、外部请求、本地读取或 UI 覆盖 |
| SEC-010 | EXT-CAP-001 | 未声明/未授权/已撤销 capability 均失败且活动任务取消 |

### 5.6 扩展与操作

| Test ID | 覆盖需求 | 自动化断言 |
|---|---|---|
| EXT-001 | EXT-ROUTER-001 | document/search/graph provider 均通过 Router 参与 Tab disposition/history |
| EXT-002 | EXT-COMMAND-001 | 所有入口调用同一命令 ID、args schema 和 enabled 判定 |
| EXT-010 | EXT-BLOCK-001 | BlockRenderer 遵守源码只读、视口、取消、净化和故障隔离 |
| OBS-001 | OPS-LOG-001 | 日志/诊断包 secret scan 无正文、Base64、剪贴板和敏感绝对路径 |
| PROC-001 | OPS-CONTEXT-001 | 新代理仅按仓库读取链可以确定状态、约束、下一任务和验证方式 |
| PROC-002 | OPS-HANDOFF-001 | 每个完成任务含变更、验证、决策、风险和剩余工作字段 |
| BUILD-001 | OPS-BUILD-001 | 干净 checkout 使用固定工具版本和单一命令可构建并启动 Tauri 壳 |
| CI-001 | OPS-CI-001 | CI 在干净 runner 执行规定门禁，任一失败阻止合并且 artifact 可定位 |
| RELEASE-001 | OPS-RELEASE-001 | macOS 首发包签名/公证可验证；干净机安装、文件关联、升级与回滚保留用户 Markdown/资产/恢复数据；隐私清单与依赖许可证完整且无未声明上传 |

### 5.7 跨语言与跨模块契约

`CONTRACT-*` 的 canonical 测试索引在本节，每项规范断言来源为 [03 §17 契约测试清单](./03-domain-model-and-contracts.md#17-契约测试清单)。本表固定 ID、测试层和建议落点，不复制或重解释 03 的契约语义；两处必须在同一契约变更中同步。

`CONTRACT-*` 专用于生成 schema、wire 兼容和跨模块不变量，不与 `CORE/FILE/ASSET/REC/...` 的行为验收争用 ID。一个 harness 可共享 fixture 或执行路径，但报告中必须保留每个独立稳定 ID；不得以 `CONTRACT-007` 通过替代 `FILE-001` 的完整故障注入证据。建议路径是所有权边界；Phase 0 冻结工具后可在目录内选用 Rust、TypeScript 或跨语言 runner，不得改变本表的测试层与断言。

| Test ID | 具体测试层 | 建议路径 | 规范来源 | Canonical 断言摘要 |
|---|---|---|---|---|
| CONTRACT-001 | CI schema-drift 契约 | `tests/contract/schema/contract-001-schema-drift/` | 03 §17（第 1 项） | 重新生成 Rust request/response/event 的 TypeScript 绑定后仓库无 diff |
| CONTRACT-002 | Rust serde + TypeScript fixture 跨语言往返 | `tests/contract/schema/contract-002-union-roundtrip/` | 03 §17（第 2 项） | 每个判别联合的 tag 与字段在 Rust -> JSON -> TypeScript 中一致 |
| CONTRACT-003 | TypeScript 前向兼容/安全默认测试 | `tests/contract/schema/contract-003-forward-compat/` | 03 §17（第 3 项） | 未知 event/error/optional field 不使前端崩溃，未知写入 action fail closed |
| CONTRACT-004 | Rust ResourceResolver 属性 + 集成契约 | `tests/contract/resource/contract-004-path-policy/` | 03 §17（第 4 项） | 大小写、Unicode、`..`、符号链接和越界授权满足 `RES-INV-*` |
| CONTRACT-005 | Resolver + SessionRegistry 跨模块集成契约 | `tests/contract/session/contract-005-document-identity/` | 03 §17（第 5 项） | 同一文件的不同拼写解析为同一 `DocumentId`，registry 只建一个 session |
| CONTRACT-006 | TypeScript session reducer + save fixture 契约 | `tests/contract/session/contract-006-save-snapshot/` | 03 §17（第 6 项） | 保存 snapshot 后继续编辑，接纳保存结果后 session 仍 dirty |
| CONTRACT-007 | Rust compare-and-save 故障注入集成契约 | `tests/contract/file/contract-007-save-cas/` | 03 §17（第 7 项） | 保存前或提交前 revision 不符都不替换目标文件 |
| CONTRACT-008 | Watcher + DocumentSession 跨模块集成契约 | `tests/contract/file/contract-008-external-change/` | 03 §17（第 8 项） | clean 自动重载；dirty 进入 conflict 且两份内容可恢复；Reloading 期间输入作废迟到结果 |
| CONTRACT-009 | TypeScript event consumer + app ingress 属性契约 | `tests/contract/events/contract-009-sequence-reconcile/` | 03 §17（第 9 项） | duplicate/gap 按 scope reconcile；snapshot(S) 与实时事件任意交错仍只丢 <=S/连续重放 >S，二次 gap 重试；native-open 幂等重投 |
| CONTRACT-010 | Rust task lifecycle + save 提交点集成契约 | `tests/contract/cancellation/contract-010-commit-point/` | 03 §17（第 10 项） | 提交点前取消返回 `ERR_CANCELLED`，提交点后只有与磁盘一致的唯一终态 |
| CONTRACT-011 | Rust preflight outcome serde 负向契约 | `tests/contract/safety/contract-011-blocked-envelope/` | 03 §17（第 11 项） | blocked 无正文/Base64；binary/编码/超限只产生 UnsupportedReport，且 schema/UI actions 无 extract/delete |
| CONTRACT-012 | CodeMirror harness + Asset gateway 故障集成契约 | `tests/contract/assets/contract-012-paste-failure/` | 03 §17（第 12 项） | 图片写入失败时 doc、session revision、dirty 和 undo history 全部不变 |
| CONTRACT-013 | 真实浏览器导航集成契约 | `tests/contract/navigation/contract-013-history-anchor/` | 03 §17（第 13 项） | back/forward 恢复块锚点，图片/Mermaid 改变布局高度后仍回到原阅读位置 |
| CONTRACT-014 | TypeScript SessionRegistry 引用计数集成契约 | `tests/contract/session/contract-014-tab-refcount/` | 03 §17（第 14 项） | 关闭一个同文档 Tab 不回收其他 Tab 仍在使用的 session |
| CONTRACT-015 | Rust recovery + TypeScript persistence 集成契约 | `tests/contract/recovery/contract-015-checkpoint-dirty/` | 03 §17（第 15 项） | checkpoint 成功不把 dirty 变 clean，checkpoint 失败不阻断显式保存 |
| CONTRACT-016 | Rust native grant/capability 集成契约 | `tests/contract/grants/contract-016-native-token/` | 03 §17（第 16 项） | document picker 与 needsGrant 续接只接受原生 token，伪造、过期或换目标均拒绝 |
| CONTRACT-017 | Rust AssetService 授权/存储集成契约 | `tests/contract/assets/contract-017-resource-scope/` | 03 §17（第 17 项） | workspace/standalone/draft scope 均合法；draft crash recovery 后可预览，权限不足只返回 needsGrant(assetDirectory) |
| CONTRACT-018 | Rust recovery preflight/丢弃集成契约 | `tests/contract/recovery/contract-018-recovery-preflight/` | 03 §17（第 18 项） | 恢复稿再预检；SafetyBlocked 不返回正文，丢弃不影响用户 Markdown/资产 |
| CONTRACT-019 | CommandBroker user-activation + Rust capability 跨边界安全契约 | `tests/contract/security/contract-019-external-policy/` | 03 §17（第 19 项） | 无 frontend activation receipt 默认拒绝；Rust 独立拒绝 raw path、未知 scheme、draft/失效/越权 target；授权 workspace root/entry 与 standalone file 可 reveal |
| CONTRACT-020 | Save As durable identity + Router/Registry 跨模块集成契约 | `tests/contract/save-as/contract-020-identity-rebind/` | 03 §17（第 20 项） | 同 intent 幂等返回 committed outcome；Save As 保持 identity/rebind/history；same target 与 target occupied 行为固定，接纳后才 ack |
| CONTRACT-021 | Save As journal 跨 Rust/Session 回滚与故障注入契约 | `tests/contract/save-as/contract-021-rollback/` | 03 §17（第 21 项） | prepared cancel/expiry 幂等 abort；committing 后 abort 拒绝；每个 commit 子阶段 crash/响应丢失均可 status/reconcile 为唯一 committed 或完整 rollback，ack 前 alias 有效 |
| CONTRACT-022 | Rust draft identity + SessionRegistry 幂等集成契约 | `tests/contract/session/contract-022-draft-create/` | 03 §17（第 22 项） | 同 draftIntent 只创建一个 DraftId/DocumentId；空白 draft 初始 dirty，普通 Save 拒绝且 Save As 原位晋升 |
| CONTRACT-023 | Native close + Session discard + Recovery/Asset 跨模块故障契约 | `tests/contract/recovery/contract-023-explicit-discard/` | 03 §17（第 23 项） | closeRequest cancel 零变化；checkpoint-only 不 proceed；每项 save/explicit discard 决议全成功才继续 native close，任一失败保持 hold |
| CONTRACT-024 | Tauri gateway + Rust/TypeScript 正文预算边界契约 | `tests/contract/ipc/contract-024-document-content-budget/` | 03 §17（第 24 项） | 所有正文方向共用 raw/wire 双预算；32 MiB 与最坏 escaping 往返，边界 +1 拒绝且不误用 1 MiB |

## 6. Round-trip 策略

### 6.1 零编辑

对每个支持编码 fixture：

1. 记录输入字节 hash、长度、BOM 和换行统计。
2. 通过正式 open/preflight 路径构造会话。
3. 不创建正文 transaction。
4. 调用正式 save 路径或验证 no-op save。
5. 逐字节比较。

不允许用“语义 AST 相等”代替字节一致。

### 6.2 局部编辑

在 fixture 中用 marker 标出编辑区和保护区：

- 在编辑区执行真实 CodeMirror transaction。
- 保存后断言预期 diff 仅落在允许区间。
- 未知语法、表格空格、围栏、链接目标和换行等保护区保持。
- 测试不得先经过 formatter。

### 6.3 属性测试

生成受约束 Markdown 片段及 transaction 序列，验证：

- apply + invert 回到原文；
- ChangeSet mapping 后 selection 合法；
- 多视图按 revision 应用得到相同正文；
- link parser 对 encode/decode 不产生越权路径；
- serializer 不丢未知 token。

属性测试失败必须保存最小化 seed 和脱敏 fixture，加入回归库。

## 7. 编辑器与 IME 测试

jsdom 对 selection、layout、composition 支持不足。编辑器测试分三层：

1. 纯状态测试：EditorState、transaction、range mapping。
2. 浏览器 harness：真实 Chromium/WebKit 环境的 decoration、selection、滚动。
3. macOS 人工/自动桌面矩阵：系统中文输入法、拼音候选、组合取消、Emoji、日文 IME。

IME 最低场景：

- 标题、粗体、链接文字、表格单元格、代码块中连续输入中文；
- composition 中鼠标点击和方向键；
- 候选确认/取消；
- 跨渲染边界输入；
- Undo 一次撤销一次逻辑输入，而非拆散 composition；
- 两个 View 共享 Session 时另一 View 同步但不打断本地 composition。

每次 CodeMirror、WebView 或输入层升级都必须运行 IME-001。

## 8. 导航模型测试

用纯 reducer/model test 生成动作序列：

~~~text
open(A,current)
scroll(A,a1)
open(B,current)
open(C,newBackgroundTab)
back()
forward()
edit(B)
close/reopen tab
externalRename(B)
~~~

断言：

- 每 Tab index 与 entries 合法；
- 当前 history item 与显示资源一致；
- 后退后新导航清除 forward；
- 滚动/selection 只 replace 当前 view state，不 push；
- history 不保存正文；
- 同 DocumentId 只存在一个 Session；
- async request token 只更新发起它的目标；
- 未知 provider 的持久化项安全降级。

scroll restore 在真实浏览器用稳定 block anchor + pixel offset 验证，不只比较 scrollTop。

## 9. 文件系统与故障注入

### 9.1 临时工作区

每个测试创建独立 mktemp 目录，路径显式保存于测试上下文，不使用 HOME、~ 或工作区根作为清理目标。测试结束仅删除已验证属于该上下文的目录。

### 9.2 I/O 故障点

FileStore 抽象必须允许在以下阶段注入错误：

- open/stat/read；
- create temp；
- partial write；
- flush/fsync；
- pre-replace revision check；
- replace/rename；
- directory fsync；
- cleanup；
- watcher 事件丢失/重复/乱序。

每个失败后验证原文件、临时文件、DiskRevision、dirty 和恢复状态。Windows 文件占用语义后续加入同等测试。

### 9.3 崩溃测试

通过独立测试进程：

1. 打开 fixture 并产生 dirty 内容。
2. 等待明确 checkpoint ack。
3. 在不同阶段强制终止进程。
4. 重启并检查恢复中心。
5. 验证磁盘原文不变、恢复正文正确、staging 完整。

不得用正常 shutdown 代替 crash。

## 10. 性能测试

### 10.1 合成矩阵

| Fixture | 规模 | 预期 |
|---|---:|---|
| normal-small | 8 KiB | editable/normal |
| real-shape-max | 243 KiB，密集表格/链接 | editable/normal |
| full-boundary | 恰好 8 MiB，多行且最大行不超过 256 KiB | editable/normal |
| large-10m | 10 MiB，多行 | editable/largeText |
| large-25m | 25 MiB，多行 | editable/largeText |
| unsupported-50m | 50 MiB | Unsupported |
| longline-256k | 最大行恰好 256 KiB、文件不超过 8 MiB | editable/normal |
| longline-256k-plus | 最大行 256 KiB + 1 B、文件不超过 8 MiB | editable/largeText |
| longline-1m | 单行恰好 1 MiB、文件不超过 8 MiB | editable/largeText |
| longline-1m-plus | 单行 1 MiB + 1 B | safetyBlocked |
| datauri-10m | 10 MiB 单行图片 Base64 | safetyBlocked |
| tables-300 | 约 300 张 GFM 表 | editable/normal、视口增量 |
| mermaid-many | 大量图块，仅少量可视 | 屏外不渲染 |

边界值测试同时覆盖 threshold-1、threshold、threshold+1，明确比较单位是 bytes 还是 decoded bytes。

### 10.2 采样

- 每个 UI 场景至少 30 次，丢弃或单独报告 warm-up。
- 冷开测试清理应用派生缓存，不清理系统状态时需注明。
- 输出 JSON 基准 artifact 和人类摘要。
- PR 对比基线，超过 15% 回归或硬预算失败即阻断。
- 性能测试失败不得自动通过“提高阈值”解决。
- 内存峰值至少覆盖同一大文档 5 个 Tab、10 个不同文档和 Mermaid 查看器反复开关。

## 11. 安全验证

### 11.1 静态与构建配置

- TypeScript/Rust lint 和禁止 API 规则；
- 扫描业务代码直接 invoke、dangerouslySetInnerHTML、shell/Command、file://；
- 解析 production Tauri capabilities 和 CSP；
- npm/cargo 依赖漏洞与许可证扫描；
- lockfile、release source map 和 devtools 配置审计。

### 11.2 动态

- IPC schema fuzz：错误类型、深度、长度、版本、token 重放；
- path fuzz：..、符号链接、Unicode、百分号、平台保留路径；
- Markdown/HTML/SVG/Mermaid corpus；
- 图片损坏、巨大尺寸、MIME 欺骗和解码上限；
- recovery/checkpoint 篡改；
- 外部链接确保交系统浏览器且应用 WebView 不导航；
- 网络监听验证打开恶意文档不产生意外请求。

安全缺陷修复必须把最小复现加入 malicious fixture，内容若敏感则保存生成器或 hash。

## 12. 可观测性

### 12.1 结构化事件

事件 envelope：

~~~ts
interface DiagnosticEventV1 {
  schemaVersion: 1
  timestamp: string
  level: "debug" | "info" | "warn" | "error"
  component: string
  event: string
  operationId?: string
  fields: Record<string, number | boolean | SafeEnum | SafeId>
}
~~~

允许字段示例：

- sizeBucket、lineBucket；
- mode、outcome、errorCode；
- durationMs、count；
- workspaceId/documentId 的会话随机 ID 或 salted 短 hash；
- renderer/extension ID 与版本；
- dirty、conflict、cancelled 布尔值。

禁止字段：

- 正文或片段；
- 剪贴板；
- Base64/data URI；
- recovery content；
- 完整绝对路径、文件名列表；
- 搜索词、AI prompt、URL query；
- 系统用户名、环境变量、token。

### 12.2 关键 span

第 07 章列出的 span 必须贯穿相同 operationId。前端和 Rust 时钟不必完全一致，但各自 duration 可比较。至少覆盖 open、preflight、transfer、mount、navigate restore、asset import、save 和 recovery。

### 12.3 本地诊断

- 默认只写容量受限的滚动本地日志。
- release 中 debug 事件默认关闭。
- 用户主动导出诊断包，导出前显示字段说明。
- 诊断包含 app/version/platform、配置摘要、事件、崩溃摘要和基准，不含文档。
- secret scan 作为导出最后一道闸门；发现疑似 Base64/正文时拒绝并说明。
- 无用户 opt-in 不上传。

## 13. CI 管线与合并门禁

### 13.1 每个 PR

1. 文档链接和 schema 校验。
2. format/lint/typecheck。
3. TypeScript/Rust 单元和契约测试。
4. round-trip canonical corpus。
5. 安全静态规则与依赖扫描。
6. 受影响模块的浏览器/集成测试。
7. requirement/test/task ID 追踪检查。

### 13.2 主分支或每日

- 全平台构建；
- Tauri E2E；
- 全 pathological/malicious corpus；
- crash/fault injection；
- 性能与内存基准；
- 真实形状合成工作区；
- flaky 统计与隔离报告。

### 13.3 发布候选

- 所有 P0 test ID 通过；
- P0 requirement 无未知状态；
- 性能预算通过或有明确 release blocker；
- 无未解决 critical/high 安全问题；
- migration、升级、降级、恢复和 Safe Mode 演练；
- macOS 签名/notarization 与干净机器安装；
- 文件关联、更新失败回滚和前后版本数据兼容通过；隐私 manifest 与依赖许可证清单可审计；
- 用户真实语料只读复制回归通过；
- PROJECT_STATE.md、变更日志和已知限制更新。

禁止仅因测试偶发失败而把它从门禁移除。隔离必须有 issue/task ID、owner、原因、替代验证和截止里程碑。

## 14. 测试所有权与并行开发

| 领域 | 实现代理同时负责 |
|---|---|
| Editor | CORE、EDT、IME、TABLE、RT |
| Navigation | NAV、HISTORY、LINK、PEEK、SPLIT |
| Native Core | FILE、ASSET、REC、SAFE-001/002 |
| Platform | PERF、SAFE-003、SEC、OBS |
| Rich Render / Extensions | VIS、EXT、SEC-003/010 |
| QA / Integration | AC、跨领域 E2E、fixture 生成、release matrix |

代理不得只提交实现并把单元/契约测试完全留给“最后集成代理”。跨领域 E2E 可以由 QA 所有，但提供可测接口和本领域测试属于实现任务 Definition of Done。

并行任务使用独立 fixture 子目录和 test ID，避免多人改一个巨型测试文件。共享测试工具的接口变更先冻结或由一个 owner 集成。

## 15. 失败报告模板

测试失败记录至少包含：

~~~text
Test ID:
Requirement ID:
Build / commit:
Platform:
Fixture ID + hash:
Expected:
Actual:
Stable error code:
Reproduction command:
First bad revision（若已知）:
Artifacts（已脱敏）:
Owner / next action:
~~~

不得把大段正文或 Base64 粘贴进 issue、PROJECT_STATE 或聊天。保存最小脱敏 fixture 或确定性生成参数。

## 16. Definition of Done

一项实现任务只有满足以下条件，才能由 Integration 标记为 `DONE`；feature owner 完成本地工作后只标记 `REVIEW`：

- 行为符合对应规范，未通过私有通道绕过架构。
- requirement ID、test ID、task ID 已链接。
- 本领域单元/契约测试已提交并通过。
- 所需跨领域测试已新增或有明确后续 task。
- 性能、安全、无障碍和隐私影响已评估。
- 新 schema/错误码/feature flag/设置已记录。
- 没有把真实用户数据加入仓库或日志。
- PROJECT_STATE.md 已更新状态、验证命令、结果、决定、风险和下一步。
- 如果改变不变量或跨模块契约，ADR 和设计文档同步更新。

## 17. 上下文压缩后的验证恢复

新代理不得询问上一代理“测试做到哪里”作为唯一依据。固定恢复顺序：

1. 读取根目录 AGENTS.md。
2. 读取 PROJECT_STATE.md 的当前阶段、锁定项和最近交接。
3. 读取 DESIGN.md 与 REQUIREMENTS.md。
4. 读取当前任务领域文档及 ADR。
5. 在 IMPLEMENTATION_PLAN.md 找到 Task ID、依赖和退出标准。
6. 运行 PROJECT_STATE 记录的最小验证命令，确认仓库现实与文档一致。
7. 若不一致，先把差异记录为 blocker/decision，不按聊天记忆猜测。

PROC-001 和 PROC-002 的验收由另一个未继承聊天历史的代理执行一次“冷接手演练”：它应能指出当前目标、禁止事项、负责目录、下一任务、运行命令和完成证据。
