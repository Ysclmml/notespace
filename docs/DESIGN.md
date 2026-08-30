# Markdown Workspace 完整设计

| 字段     | 值                                                    |
| -------- | ----------------------------------------------------- |
| 状态     | Approved baseline 0.2（精简产品基线）                 |
| 日期     | 2026-08-30                                            |
| 首发平台 | macOS                                                 |
| 技术栈   | React 19 + TypeScript + CodeMirror 6 + Tauri 2 + Rust |
| 数据原则 | 本地 Markdown 与相邻资源文件是唯一持久化真相          |

本文是实现、评审和上下文压缩后的首要产品规范。若历史设计与本文冲突，以 [ADR-0005](decisions/0005-lean-local-editor-boundary.md) 和本文为准。

## 1. 产品定义

Markdown Workspace 是一个“像 Typora 一样编辑、像浏览器一样阅读”的本地 Markdown 桌面软件。

它不追求第一版复刻 Typora 的所有菜单，也不为偶发异常建设企业安全平台。第一版集中解决四个真实摩擦：

1. Markdown 源码和渲染结果处在同一画布，光标附近可直接编辑语法。
2. 剪贴板截图一次粘贴即可落盘并插入相对链接，不需要手工保存图片。
3. 本地文档链接支持原地跳转、前进、后退和多个 Tab。
4. Mermaid 与大图可以进入查看器缩放和平移。

大型 Base64 属于低频误操作：不建设修复引擎，但必须在内容进入编辑器前阻止它卡死 WebView。普通大文件采用 source-only 降级。

## 2. 产品边界

### 2.1 第一版必须有

- 打开工作区、显示目录树、打开 Markdown。
- 多 Tab；每个 Tab 独立前进/后退和阅读位置。
- Typora 风格单画布 Markdown 编辑。
- 未修改文件原样保存；编辑后保存普通 Markdown。
- 截图粘贴到相邻 `assets/` 并插入相对链接。
- 大型 data-image/病态长行的轻量阻止页；普通大文档 source-only。
- Outline；Markdown 相对链接和 heading anchor 跳转。
- Mermaid 文内预览，以及可缩放、平移、Fit 的查看器。
- macOS 原生菜单、快捷键和文件/目录选择。

### 2.2 第一版明确不做

- 账户、云同步、协作、服务端和遥测。
- 富文本 AST 作为保存格式。
- 通用二进制/巨型文件编辑器。
- Base64 自动提取修复、隔离区、崩溃恢复日志、资产垃圾回收。
- HTML 任意执行、第三方插件市场、复杂 feature flag 系统。
- Git、知识图谱、全文索引、AI；只预留清晰模块边界。

### 2.3 当前实现边界

截至 2026-08-30，工作区、文件树、Tab/back-forward、heading anchor、可点击 Outline、滚动/选区恢复、source-first live preview、本地打开/保存、截图落盘、GFM 表格阅读态、Mermaid 文内 SVG 和 Mermaid/图片查看器均已连通。真实 `.app` UI smoke 因当前 macOS 锁屏待补；实时状态以 [PROJECT_STATE.md](PROJECT_STATE.md) 为准。

## 3. 体验与视觉

视觉基线是 [Paper & Ink 主界面原型](prototypes/markdown-workspace-main-v1.svg)。参考 Typora 的克制排版，但交互骨架更接近浏览器。

### 3.1 窗口结构

```text
┌──────────────────────────────────────────────────────────────┐
│ ←  →  [侧栏]  工作区 / 当前文档       快速打开  更多        │
├──────────────┬───────────────────────────────────────────────┤
│ 文件 / 大纲  │ Tab A | Tab B | +                            │
│              ├───────────────────────────────────────────────┤
│ 文件树       │                                               │
│              │         单画布 Markdown 编辑区                │
│              │                                               │
├──────────────┴───────────────────────────────────────────────┤
│ 保存状态 · 字数 · 行列 · 模式                                │
└──────────────────────────────────────────────────────────────┘
```

- 顶部工具栏只承载导航、工作区身份、快速打开和少量全局动作。
- Tab Rail 始终位于内容上方；未保存以圆点表示，关闭前询问。
- 侧栏在“文件 / 大纲”之间切换，可以折叠。
- 编辑页最大正文宽度约 900–980 px，留出呼吸空间；大表格和图可突破正文宽度。
- 颜色使用暖白纸面、深灰文字、低饱和蓝色交互；不堆卡片和渐变。

### 3.2 核心交互

| 动作                   | 行为                                       |
| ---------------------- | ------------------------------------------ |
| 点击内部 Markdown 链接 | 当前 Tab 原地跳转并写入历史                |
| `⌘` 点击或中键         | 新后台 Tab 打开                            |
| `⌘⇧` 点击              | 新前台 Tab 打开                            |
| 后退 / 前进            | 只改变当前 Tab 的浏览历史，不触发编辑 Undo |
| 点击同页 heading 链接  | 滚动到标题，并记录来源位置                 |
| `⌘P` / `⌘K`            | 快速打开工作区文档                         |
| 粘贴截图               | 写图片成功后插入 `![](relative-uri)`       |
| 点击 Mermaid / 大图    | 打开沉浸查看器                             |
| `Esc`                  | 退出查看器，焦点回到原块                   |

## 4. 编辑模型

### 4.1 Source-first 单画布

`EditorState.doc` 是编辑期正文的唯一真相。Markdown 解析树、Outline、装饰和渲染块都是投影，绝不作为保存来源。

采用 CodeMirror 6 + Lezer：

- 当前光标、选择或 composition 所在块显示可编辑 Markdown 源码。
- 非活动标题、强调、链接、图片、引用、列表和代码块应用视觉装饰。
- GFM 表格第一版以可读装饰 + 精确源码退路实现，不做电子表格式编辑器。
- 未识别语法保持原文，不自动规范化。
- raw HTML 第一版显示源码，不执行。

### 4.2 输入法和编辑语义

- composition 期间冻结可能移动 DOM 的装饰更新；`compositionend` 后下一帧刷新。
- 装饰不得改变文档文本、选择映射或 Undo transaction。
- 编辑 Undo/Redo 由 CodeMirror 管理；浏览后退/前进是另一套状态机。
- 文件打开后若用户未产生 transaction，保存不得改动换行符、尾部换行或未知语法。

### 4.3 粘贴前护栏

普通粘贴不做额外检查。只有文本超过 1 MiB 且包含 `data:image/...;base64,` 时，前端在创建 CodeMirror transaction 之前拒绝并给出简短提示；正文、选择和 Undo 栈保持不变。

## 5. 文档、Tab 与历史

### 5.1 最小模型

```ts
type DocumentId = string; // 首版可使用规范化绝对路径作为内部 key

interface DocumentSession {
  id: DocumentId;
  path: string;
  text: string;
  diskMtimeMs: number;
  dirty: boolean;
  mode: "normal" | "sourceOnly";
}

interface ViewState {
  anchor?: string;
  scrollTop: number;
  selectionFrom: number;
  selectionTo: number;
}

interface HistoryEntry {
  documentId: DocumentId;
  path: string;
  view: ViewState;
}

interface Tab {
  id: string;
  current: HistoryEntry;
  back: HistoryEntry[];
  forward: HistoryEntry[];
}
```

### 5.2 不变量

- 同一路径最多一个 `DocumentSession`；多个 Tab 复用正文和 dirty 状态。
- 每个 Tab 拥有独立 history 和 view state。
- 普通导航把旧位置压入 back 并清空 forward。
- 返回历史项时恢复标题锚点或滚动位置；标题不存在时退回最近有效位置。
- 关闭最后一个引用 dirty session 的 Tab 前必须询问保存、放弃或取消。
- history 只存标识和视图，不复制正文。

### 5.3 链接解析

解析顺序：当前文档目录 → URL decode → 文件路径 → `.md`/目录 index 的有限补全 → heading anchor。外部 `http(s)` 使用系统浏览器；不存在的内部目标显示非阻断错误并保留当前位置。

## 6. 文件与 Rust 接口

Rust 负责原生 chooser、目录枚举、文件预检/读取、原子保存和图片写入。前端不使用浏览器文件系统 API，也不把图片编码成 Base64 IPC 文本。

第一批命令只包含实际需要的接口：

```text
pick_workspace() -> WorkspaceSelection | null
list_workspace(rootPath) -> WorkspaceNode[]
open_document(path) -> DocumentOpenResult
save_document(path, content) -> SaveDocumentResult
save_clipboard_image(documentPath) -> SavedClipboardImage
```

参数名按 Tauri `camelCase` 边界表示。`save_clipboard_image` 由 Rust 直接读取系统剪贴板，不接收 `bytes`、MIME 或 Base64 字符串。这些类型在 Rust 和 TypeScript 两侧保持简短同构；当前不引入全仓库 schema 生成器。新增命令时再新增对应类型和测试。

### 6.1 打开和预检

Rust 以固定 64 KiB 缓冲先扫描：总字节、UTF-8 有效性、最长物理行以及大段 data-image marker。

分类建议值：

| 结果         | 当前条件                                                  | 前端行为                           |
| ------------ | --------------------------------------------------------- | ---------------------------------- |
| `normal`     | 不大于 8 MiB，最长行不大于 256 KiB                        | 完整单画布能力                     |
| `sourceOnly` | 超过 8 MiB 的普通 UTF-8 多行文本，或较长但未阻止的物理行  | 关闭昂贵块渲染/Outline，可编辑保存 |
| `blocked`    | 非 UTF-8、超过 512 KiB 的 data-image 行，或单行超过 1 MiB | 不返回正文，显示说明页             |

阈值是初始性能预算，可依据实测调整；它们不是威胁模型。当前不额外设置通用文件字节上限；约 10 MiB 普通多行文件必须可走 `sourceOnly`。

### 6.2 原子保存

1. 在目标同目录创建唯一临时文件。
2. 写入完整 UTF-8 字节并 `flush`，必要时 `sync_all`。
3. 可选比较打开时 mtime；不一致时返回简单 external-change 结果，由 UI 决定覆盖或重新加载。
4. rename 替换目标。
5. 失败时只清理本次精确临时路径，原文件保持完整。

第一版不实现持久化 prepare/commit journal。

### 6.3 截图粘贴

- 前端 paste event 只判断系统剪贴板中有图片，不把图片经 Base64 或巨型 IPC 文本传入 Rust。
- 前端调用 `save_clipboard_image(documentPath)`；Rust 直接读取剪贴板 RGBA 像素并编码为 PNG。
- 当前纵向切片编辑已存在的 Markdown 文件；未保存文档必须在调用前完成 Save As。
- 默认目录：文档同级 `assets/`。
- 文件名：`paste-<timestamp>-<counter>.png`，不覆盖现有资源。
- Rust 写入成功后返回相对于文档目录的 URI；前端此时才插入 Markdown。
- 写入失败、用户取消或格式不支持时不改变正文。
- Undo 只撤销正文链接，保留图片文件；资产清理以后按真实需求增加。

## 7. Mermaid 与视觉查看器

第一版使用 Mermaid 的浏览器渲染库，按需加载：

- CodeMirror 只为实际挂载到视口的 fenced `mermaid` Widget 创建渲染 DOM；Mermaid 主包动态加载。
- 渲染结果带 source cache key，并在目标 Widget 已卸载时丢弃迟到结果。
- 失败在当前图块显示错误，工具栏仍可立即回到源码，不阻塞编辑。
- 查看器只消费渲染结果，不改写 Markdown 正文；外部链接由应用路由处理。
- 查看器保留 SVG，支持滚轮/触控板缩放、拖拽平移、双击 Fit、`+/-/0` 和 `Esc`。

图片使用同一个 viewer shell，并提供 100%、Fit、缩放和平移；“在 Finder 中显示”留给 Phase 4 菜单能力。

## 8. 前端架构

```text
src/
├─ app/
│  ├─ shell/               # Paper & Ink 窗口骨架与当前纵向切片组装
│  └─ state/               # sessions / tabs / navigation reducer
├─ features/
│  ├─ workspace/           # 文件树与 Outline
│  ├─ editor/              # CodeMirror adapter 与 source-first 装饰
│  ├─ navigation/          # 链接解析、Tab、history
│  └─ viewer/              # Mermaid/图片 zoom、pan、Fit、100% viewer
└─ infrastructure/tauri/   # invoke wrapper 与当前命令类型
```

快速打开、截图粘贴编排和快捷键当前保持在 shell 这一小型组装层；第二个真实消费者出现前不抽取通用 commands/assets 框架。应用状态用 React reducer/context 即可；第一版不引入 Redux。跨模块动作通过明确函数或 reducer action 连接，不建设事件总线。

### 8.1 浏览器开发模式

Tauri adapter 提供环境判断。纯浏览器 `pnpm dev` 可以使用内存演示工作区，便于视觉开发和组件测试；真实文件写入只在 Tauri 中启用，界面必须清楚标明演示状态。

## 9. Rust 架构

```text
src-tauri/src/
├─ commands/mod.rs  # 当前 5 个命令及可单测文件逻辑
└─ lib.rs           # 小型 invoke_handler 注册
```

当前命令和文件逻辑保持在一个可读小模块中；只在文件继续增长或出现第二个实现时才拆分 application/infrastructure 层。所有文件逻辑可在临时目录中单测，不依赖 WebView。

## 10. 性能预算

| 场景                       | 初始目标                         |
| -------------------------- | -------------------------------- |
| 普通文档打开（约 250 KiB） | 交互可用小于 300 ms              |
| Tab/历史切换               | UI 响应小于 100 ms；内容异步恢复 |
| 连续输入                   | 60 fps 体感，无 composition 抖动 |
| 约 10 MiB 普通多行文档     | 进入 source-only，不冻结窗口     |
| 大型 data-image 文件       | Rust 扫描后阻止，正文不穿过 IPC  |
| 文件树                     | 分批或懒加载，首屏不因深目录阻塞 |
| Mermaid                    | 离屏不渲染；单块失败不影响正文   |

优化顺序：先测量，再关闭昂贵投影，再做增量计算；不先写分块编辑器。

## 11. 错误与状态文案

错误以用户动作表达，不暴露内部“安全事件”术语：

- “这个文件包含一段非常长的内嵌图片数据，内置编辑器没有打开它。”
- “图片没有保存，文档未发生变化。”
- “文件在磁盘上已被其他程序修改。重新加载或仍然覆盖？”
- “图表渲染失败，源码仍可编辑。”

状态栏只展示：已保存/未保存、normal/source-only、字数、行列和短暂操作反馈。

## 12. 扩展路线

后续功能通过资源类型和小型 feature module 增加，而不是先建设插件平台：

1. P1：工作区搜索、反向链接、断链诊断、最近关闭 Tab、两栏分屏。
2. P2：表格结构化编辑、数学、导出、Git diff/history。
3. P3：知识图谱、AI 检索与引用、受限插件接口。

只有当至少两个真实功能需要同一扩展机制时，才抽取公共 registry。

## 13. 验证策略

### 13.1 单元测试

- navigation reducer：原地跳转、back/forward、分 Tab、同 session。
- editor：CJK composition、Undo/Redo、选择、Markdown round-trip、大 Base64 粘贴拒绝。
- Rust：预检分类、10 MiB 普通多行、blocked 不返回正文、原子保存、图片相对 URI。

### 13.2 集成测试

- 工作区 → 文件树 → 打开 → 编辑 → 保存 → 磁盘一致。
- 文档链接 A → B → back/forward，恢复两侧位置。
- 图片写入成功才插链接，失败不改变文档。
- Mermaid 打开 viewer、缩放、关闭并恢复焦点。

### 13.3 本地门禁

`pnpm verify` 运行 Node 仓库检查、格式、lint、类型、前端测试、Rust fmt/clippy/test、Web build 和 Tauri debug build。Hosted CI 不阻塞本地开发；发布或接入远程仓库时再启用。

## 14. 多代理实现规则

可以并行的所有权边界：

| 轨道                 | 独占路径                                         | 依赖输出                    |
| -------------------- | ------------------------------------------------ | --------------------------- |
| Native file          | `src-tauri/**`                                   | 当前命令与返回类型          |
| App state/navigation | `src/app/state/**`, `src/features/navigation/**` | reducer API                 |
| Editor               | `src/features/editor/**`                         | Editor adapter props/events |
| Workspace UI         | `src/features/workspace/**`                      | tree/outline components     |
| Assets/diagrams      | 对应 feature 目录                                | paste/viewer API            |
| Integration          | shell、root manifests、lockfile、状态文档        | 合并与端到端验证            |

每个任务应产出可单测的小接口；不同代理不要同时编辑 shell、根清单或 `PROJECT_STATE.md`。实现顺序和验收见 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)。

## 15. 决策索引

- [ADR-0001：应用技术栈](decisions/0001-application-stack.md)
- [ADR-0002：source-first 编辑](decisions/0002-source-first-editor.md)
- [ADR-0003：Session、Tab 与导航分离](decisions/0003-session-tab-navigation-separation.md)
- [ADR-0004：病态输入保护](decisions/0004-pathological-input-guard.md)
- [ADR-0005：普通本地编辑器的精简边界](decisions/0005-lean-local-editor-boundary.md)
