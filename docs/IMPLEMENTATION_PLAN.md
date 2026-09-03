# NoteSpace（笔记空间）实施计划

状态：Active baseline 0.9（ADR-0012）

目标：优先得到每天可用的 macOS 本地 Markdown/文本编辑器，再按真实需求增强。

开始实现前依次阅读：根 `AGENTS.md`、`PROJECT_STATE.md`、`DESIGN.md`、`REQUIREMENTS.md`、`ADR-0005`、`ADR-0006`、`ADR-0007`、`ADR-0008`、`ADR-0009`、`ADR-0010`、`ADR-0011`、`ADR-0012`。聊天记录不是状态源。

## 1. 编排原则

- 按“界面入口 → 状态模型 → 当前 Tauri 命令 → 磁盘结果 → 自动测试”交付纵向切片。
- 每个阶段结束时应用仍能启动；不为未来接口预生成命令、schema、flags、pane framework 或插件框架。
- Markdown、文本和资源文件是持久化真相；设置/最近项是可丢失的本机便利状态。
- 多代理按目录独占；集成者统一修改 Shell、根清单、lockfile 和状态文档。
- 只保留三项实用护栏的故障测试：大 Base64 预检、截图先落盘、同目录原子保存。
- “一个右侧只读辅助栏”仍是辅助预览上限；主编辑区按 ADR-0011 支持扁平横向组、跨组标签拖动与预览固定，不建立递归/纵向 pane 或 IDE docking。
- 文件侧栏线性显示多个工作区根；这只是已有根集合的直接呈现，不建设项目数据库或远程文件系统。
- 自动保存只复用现有原子保存并由 inactivity timer 调度；表格列宽只属于 view，均不得另建持久化正文格式。
- 文件/目录删除只走边界校验后的系统废纸篓并由前端确认；不扩展为永久删除、批量操作或通用文件管理器。
- `.rb` 可作为普通文本打开不代表引入 Ruby；构建、测试和仓库检查仍是 Node + Rust。

## 2. 阶段与出口

### Phase 1：可编辑本地 Markdown

状态：**DONE**。

1. `P1-NATIVE-01`：Rust 目录 chooser、枚举、预检打开、原子保存、截图写入。
2. `P1-STATE-01`：`DocumentSession`、`Tab`、`HistoryEntry` reducer。
3. `P1-WORKSPACE-01`：文件树、Outline、Tab Rail 和空状态。
4. `P1-EDITOR-01`：Milkdown/ProseMirror 默认真可视；CodeMirror 显式源码/`sourceOnly`。
5. `P1-INTEGRATE-01`：打开 → 编辑 → dirty → `⌘S` → 重开。

出口：普通 Markdown 可真可视编辑并原子保存；约 10 MiB 普通多行文件降级为 `sourceOnly`；大型 data-image 正文不进入 JS。

### Phase 2：浏览器式导航

状态：**DONE**。

1. `P2-TABS-01`：主 Tab 创建、激活、关闭和同 session 复用。
2. `P2-ROUTER-01`：相对 Markdown、heading anchor、外部 URL 与修饰键 disposition。
3. `P2-HISTORY-01`：每 Tab back/forward 和各表面 view state。
4. `P2-QUICKOPEN-01`：Quick Open 与文件树。
5. `P2-OUTLINE-01`：Outline 生成、点击定位和 reveal 一次消费。

出口：A → B → C 可后退/前进；同文档多 Tab 共享正文但历史独立；Markdown 普通/修饰键/中键遵守浏览器语义。

### Phase 3：截图、视觉块和稳定编辑

状态：**DONE（自动化）**。

1. `P3-ASSET-01`：前端识别图片 → Rust 读系统剪贴板 → `assets/` PNG → 成功后插相对链接。
2. `P3-TABLE-01`：GFM 表格直接编辑，Tab/Shift-Tab 移动。
3. `P3-SYNC-01`：每个可视正文 transaction 同步更新最新 Markdown；即时 `⌘S` 不漏字。
4. `P3-MERMAID-01`：按需渲染、CSP、迟到结果隔离和局部失败。
5. `P3-VIEWER-01`：Mermaid/图片 zoom、pan、Fit、100% 与 Esc。
6. `P3-CODEUX-01`：浅色 fenced code、常显语言/Copy、普通行号和换行设置。

出口：光标不泄露 Markdown 源码、不改变块高；表格直接编辑；图片/图表语义稳定；截图失败不修改正文。

### Phase 4：ADR-0007 日常工作流

状态：**DONE（自动化）**；真实 macOS UI smoke 归入 Phase 5。

1. `P4-TEXT-EDIT-01`（DONE）：受支持代码/配置/纯文本在可编辑 CodeMirror 主 Tab 中 dirty、保存和 Save As。
2. `P4-NEW-SAVE-AS-01`（DONE）：新建未命名 `.md/.txt`；Save As 以 `excludedPaths` 写前拒绝其他已开目标；成功后 reducer 迁移 session 与所有 Tab `current/back/forward` 引用。
3. `P4-PICK-FILE-01`（DONE）：原生单文件 chooser 打开独立 Markdown/文本，并记录最近文件。
4. `P4-MULTI-WORKSPACE-01`（DONE）：同时打开多个工作区、活动根侧栏、聚合 Quick Open、最长匹配 owner。
5. `P4-RECENT-01`（DONE）：`markdown-workspace.workspaces.v1` 保存打开/最近工作区、最近文件和活动根；延迟恢复合并用户期间新开根并清理失效 open/active 记录。
6. `P4-LOCAL-REF-01`（DONE）：Markdown route first；本地 `path:line` 有界浮层、一个右侧只读栏、可编辑主 Tab 三种去向；前端引用后缀与 Rust 当前集合对齐。
7. `P4-AUX-PANE-01`（DONE）：右栏最多一个、新目标替换旧目标、只读、可关闭；没有 pane tree/grid。
8. `P4-NATIVE-MENU-01`（DONE）：ADR-0007 当时的 11 个固定 action ID 和自定义 close/quit；ADR-0008 追加 `file.reveal` 后当前共 12 个。
9. `P4-CONTEXT-MENU-01`（DONE）：capture-phase 右键/Control-click；可写编辑动作、链接动作、只读 Copy/Select All；非编辑器 chrome 保留平台菜单。
10. `P4-FENCE-COMPLETE-01`（DONE）：本地语言候选、上下键、Enter/Tab、Esc、点击创建和可关闭提示。
11. `P4-SEMANTIC-POS-01`（DONE）：可视/源码即时切换按正文片段、标题和进度 best-effort 定位；不写正文。
12. `P4-I18N-SETTINGS-01`（DONE）：默认中文、英文切换与六项持久设置。

出口自动验收：`AC-TEXT-EDIT-001`、`AC-NEW-SAVE-AS-001`、`AC-WORKSPACE-MULTI-001`、`AC-LOCAL-REF-001`、`AC-AUX-ONE-001`、`AC-CONTEXT-MENU-001`、`AC-NATIVE-MENU-001`、`AC-FENCE-LIST-001`、`AC-MODE-001` 和原有 Markdown/资产/Mermaid 回归全部通过。

### Phase 5：当前集成与桌面交付

状态：**DONE**。

已完成：

1. `P5-AUTO-01`：前端 24 个测试文件、111/111 tests，其中 desktop adapter 5/5。
2. `P5-QUALITY-01`：全局 format、lint、typecheck、Web build 通过。
3. `P5-RUST-01`：Rust fmt、Clippy、22/22 tests 通过。
4. `P5-DEBUG-BUILD-01`：Tauri debug binary build 通过。
5. `P5-INTEGRITY-01`：保存错误保持可见、Save As 写前排除已开目标、current/history dirty 关闭确认、custom close/quit、恢复竞态/失效项、引用扩展对齐和右键作用域均已修复并回归。
6. `P5-UI-SMOKE-01`：隔离 QA bundle 完成启动、中文原生菜单/设置、新建、fence 补全、代码行号/Copy 和显式源码切换 smoke；物理右键与系统剪贴板留作 UAT。
7. `P5-BUNDLE-01`：当前工作树生成 ARM64 debug `.app`/DMG，ad-hoc 签名与 `hdiutil` 校验通过，结果已回写 `PROJECT_STATE.md`。

Phase 5 出口：自动门禁、隔离核心 UI smoke 和最终 bundle 均有准确命令/结果；用户 UAT 不阻塞当前交付。

### Phase 6：ADR-0008 保存、文件与表格日常流

状态：**DONE（实现）/ PENDING（最终集成门禁与桌面验收）**。

1. `P6-AUTOSAVE-01`（DONE）：设置新增默认 `manual` 和可选 `afterDelay`；延迟归一化 1–300 秒，已有路径 dirty session 按正文快照重排并复用原子保存；untitled 跳过、失败仍 dirty。
2. `P6-MULTI-ROOTS-01`（DONE）：文件侧栏同时显示全部已打开根/树，活动根高亮；点击文件激活 owner，已有 Quick Open、恢复和移除语义保持。
3. `P6-CREATE-FILE-01`（DONE）：根/目录 inline 新建；无扩展名补 `.md`；Rust 限定现有根内父目录、支持后缀和 `create_new`，成功刷新并前台打开。
4. `P6-REVEAL-01`（DONE）：根、目录、文件与当前已保存文档可在系统文件管理器显示；新增 `file.reveal` 原生动作及 macOS/Windows/Linux 映射。
5. `P6-TABLE-VIEW-01`（DONE）：宽表格内部横向滚动；官方 column resizing，列宽不进 Markdown/dirty；尺寸网格插入和表格内快捷行列工具。
6. `P6-STRUCTURE-MENU-01`（DONE）：可视右键新增段落/标题、引用、列表、行内格式、代码块、分割线及表格行列结构动作；工作区文件动作和全部新增菜单中英文齐全。
7. `P6-GATE-01`（PENDING）：并行修改稳定后统一运行完整前端/Rust门禁，记录最终测试总数。
8. `P6-UI-BUNDLE-01`（PENDING）：重建最终 `.app`/DMG，smoke 多根、新建/reveal、manual/afterDelay、宽表格/列宽/网格/行列及双语菜单。

Phase 6 出口：自动门禁、最终 bundle 和上述核心 UI smoke 有准确记录；不能用 ADR-0007 的旧产物替代。

### Phase 7：ADR-0009 可靠关闭与可恢复文件动作

状态：**DONE（实现）/ PENDING（最终集成门禁与桌面验收）**。

1. `P7-DIRTY-CLOSE-01`（DONE）：Tab 未保存标记和关闭判断聚合 current/back/forward；Tab、原生红色关闭、菜单关闭/退出统一使用应用内可取消对话框，确认后只关闭一次并正常结束主窗口进程。
2. `P7-ROOT-ACTIONS-01`（DONE）：多根独立折叠；根右键复制路径和关闭工作区，关闭只移出打开集合并保留最近项、Tab 与磁盘。
3. `P7-TRASH-01`（DONE）：文件/目录复制绝对路径；确认后调用受工作区严格后代约束的系统废纸篓命令，取消/失败保持，成功刷新树并收敛 session/history。
4. `P7-CODE-CONTRAST-01`（DONE）：代码主 Tab、代码块与只读预览保持可读 token/selection 对比度。
5. `P7-AUX-REUSE-01`（DONE）：右栏已打开时 Markdown 代码引用直接替换右栏并定位目标行，快速请求 latest-wins；右栏关闭时保留浮层流程。
6. `P7-I18N-01`（DONE）：折叠、复制路径、关闭工作区、废纸篓确认/结果和 dirty 对话框提供中英文。
7. `P7-GATE-01`（PENDING）：集成者运行 `pnpm verify`、最终 bundle 与桌面 smoke，并把准确结果写入 `PROJECT_STATE.md`。

Phase 7 出口：实现已完成；最终门禁与桌面验收有准确记录后关闭本轮。

### Phase 8：工作区菜单与目录创建（ADR-0010）

移除常驻根工具栏；根/目录/文件同级及空白区域菜单提供当前常用动作与新建单层空目录；该阶段为 13 个命令（现增加系统浏览器打开为 14 个）。紧凑双语菜单使用 portal、实际尺寸定位和键盘焦点；长路径确认框使用可收缩网格、独立路径换行及固定可见操作区。精确门禁与浏览器/桌面验收见 `PROJECT_STATE.md`。

### Phase 9：编辑分组、临时标签与图片链接（ADR-0011）

默认单左组；右键向右分屏、标签跨组拖动和分隔线调整。单击文件树临时斜体预览、双击/编辑固定，各组最多一个临时标签；文件读取跟随触发时的活动组，关闭/移组/后退后的迟到请求被丢弃。同一路径共享正文，位置与历史独立，被动更新不进 Undo、不抢焦点；最后引用放弃后清理孤立 dirty 正文。

树跟随活动文件展开并突出显示。默认平台右键只在顶部工具栏放行，原生 debug“显示”菜单提供开发者工具；Tauri 关闭原生文件拖放捕获以支持内部标签拖动。图片链接无需行号，点击后进入带错误回退的专门查看器。准确测试数、浏览器回归和新 debug bundle 记录在 `PROJECT_STATE.md`，不得沿用上轮产物结论。

### Phase 10：Markdown 与跨标签导航（ADR-0012）

普通 Markdown 跨文档链接按源 Tab 的临时/固定状态原位替换或新开预览，同页 anchor/Outline 留原页。显式 Markdown 路径脱离文件树收录限制；可视 hover 卡片、正文、源码统一路由，代码/图片仍专用预览。窗口最多 200 项访问轨迹驱动工具栏前进/后退，跨 Tab/组恢复，不记录被动事件、不额外拥有正文；关闭/删除清理、Save As 迁移和过期请求隔离有回归。验收结果见 `PROJECT_STATE.md`。

用户追加的网页链接使用系统默认浏览器：新增 `open_external_url`，仅显式点击 HTTP/HTTPS 后启动，不建立应用内网络客户端；错误本地化，图片链接仍优先专用预览。Mermaid 中文标签裁切/复杂连线文字重叠作为既有渲染质量修复，输入源码不变；真实布局与回归证据由集成者记录。

### Phase 11：按需增强

外部修改 mtime 提示、大目录性能、搜索/反向链接、数学、导出、Git 按用户价值逐项决策。递归目录创建、重命名、移动、复制文件内容、永久删除、批量文件操作、纵向/递归分屏、IDE/LSP/debug/build/run、窗口 session snapshots、项目数据库和云最近项不在当前计划。

## 3. 并行边界

| 任务        | 路径所有权                                                 | 合并前接口                                           |
| ----------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| Native      | `src-tauri/**`                                             | 14 个 command 参数/结果、native action IDs           |
| State       | `src/app/state/**`                                         | session/tab/history、edit/save/relocate reducer      |
| Editor      | `src/features/editor/**`                                   | Markdown props、semantic position、fence/table tools |
| CodePreview | `src/features/code-preview/**`                             | editable/read-only、tab/popover/split variants       |
| I18n/Prefs  | `src/app/i18n/**`, `src/app/settings/**`, settings feature | locale/settings contracts                            |
| ContextMenu | `src/features/context-menu/**`                             | target classification 与 command actions             |
| Workspace   | `src/features/workspace/**`                                | Tree/Outline/workspace history contracts             |
| Navigation  | `src/features/navigation/**`                               | route-first、local-ref parsing、disposition          |
| Integration | `src/app/shell/**`, root config, docs                      | 组装、快捷键、最终验证                               |

若接口尚未确定，先冻结当前切片的小型 TypeScript/Rust 类型；不得建设通用 schema、event bus 或 pane registry。

## 4. 当前接口冻结

### 4.1 Desktop adapter / Tauri

```ts
interface DesktopAdapter {
  pickWorkspace(): Promise<WorkspaceSelection | null>;
  pickDocument(): Promise<DocumentSelection | null>;
  listWorkspace(rootPath: string): Promise<readonly WorkspaceNode[]>;
  openDocument(path: string): Promise<DocumentOpenResult>;
  revealInFileManager(path: string): Promise<void>;
  createWorkspaceTextFile(
    workspaceRoot: string,
    directoryPath: string,
    fileName: string,
  ): Promise<DocumentOpenResult>;
  moveWorkspaceEntryToTrash(workspaceRoot: string, path: string): Promise<void>;
  createWorkspaceFolder?(
    workspaceRoot: string,
    directoryPath: string,
    folderName: string,
  ): Promise<void>;
  previewLocalFile(reference: string, documentPath: string): Promise<LocalFilePreview>;
  saveDocument(path: string, content: string): Promise<SaveDocumentResult>;
  saveDocumentAs(
    suggestedFileName: string,
    content: string,
    excludedPaths: readonly string[],
  ): Promise<SaveDocumentResult | null>;
  saveClipboardImage(documentPath: string): Promise<SavedClipboardImage>;
  setNativeMenuLocale?(locale: "zh-CN" | "en-US"): Promise<void>;
  listenNativeMenuAction?(listener: (id: NativeMenuActionId) => void): Promise<Unlisten>;
}
```

对应 14 个 Rust 命令：

```text
pick_workspace()
pick_document()
list_workspace(rootPath)
open_document(path)
open_external_url(url)
reveal_in_file_manager(path)
create_workspace_text_file(workspaceRoot, directoryPath, fileName)
create_workspace_folder(workspaceRoot, directoryPath, folderName)
move_workspace_entry_to_trash(workspaceRoot, path)
preview_local_file(reference, documentPath)
save_document(path, content)
save_document_as(suggestedFileName, content, excludedPaths)
save_clipboard_image(documentPath)
set_native_menu_locale(locale)
```

`createWorkspaceTextFile` 不接收正文并以 Rust `create_new` 保证不覆盖；`revealInFileManager` 不经 shell。`moveWorkspaceEntryToTrash` 只接受规范化根的严格后代并使用系统废纸篓，前端负责确认与成功后的状态收敛；根、根外和不存在目标拒绝。`saveClipboardImage` 不接收图片 bytes/MIME；`previewLocalFile` 不接收文件正文；`setNativeMenuLocale` 不复制前端状态。原生菜单事件只可能是：`file.new`、`file.open`、`workspace.open`、`file.save`、`file.saveAs`、`file.reveal`、`app.settings`、`app.quit`、`view.toggleSource`、`view.toggleSidebar`、`window.close`、`help.open`。

### 4.2 文档结果与局部预览

```ts
type WorkspaceNodeKind = "directory" | "markdown" | "text";
type DocumentKind = "markdown" | "text";

interface EditableDocumentResult {
  status: "editable";
  path: string;
  content: string;
  mode: "normal" | "sourceOnly";
  documentKind: DocumentKind;
  language: string;
  preflight: DocumentPreflight;
}

interface LocalFilePreview {
  path: string;
  language: string;
  targetLine?: number;
  startLine: number;
  content: string;
}
```

`previewLocalFile` 有目标行时返回前后各 20 行，无目标返回前 80 行，每行最多 600 Unicode 字符。Popover 只显示这个有界结果；右侧栏当前可用 `openDocument` 载入完整文本但保持只读；主 Tab 完整且可编辑。

### 4.3 Editor adapter

```ts
interface EditorSemanticPosition {
  progress: number;
  headingText?: string;
  text?: string;
  textOffset?: number;
}

interface EditorViewSnapshot {
  scrollTop: number;
  selectionFrom: number;
  selectionTo: number;
  semanticPosition?: EditorSemanticPosition;
}

interface MarkdownEditorProps {
  documentId: string;
  instanceId?: string;
  value: string;
  mode: "normal" | "sourceOnly";
  presentationMode: "visual" | "source";
  locale?: "zh-CN" | "en-US";
  codeWrap?: boolean;
  showCodeLineNumbers?: boolean;
  showTypingHints?: boolean;
  initialView?: EditorViewSnapshot;
  reveal?: EditorRevealRequest;
  onChange(value: string): void;
  onInternalLink?(target: string, disposition: LinkDisposition): void;
  onImagePaste?(selection: SelectionRange): Promise<string>;
  onViewChange?(view: EditorViewSnapshot): void;
}
```

`onChange` 对正文 transaction 同步调用；选择、滚动、模式切换和补全浮层移动不得调用。`semanticPosition` 用于当前编辑器实例切换表面的 best-effort 映射；精确 per-surface view 仍由 Tab state 保存。

### 4.4 Settings 与工作区历史

```ts
interface AppSettings {
  locale: "zh-CN" | "en-US";
  editorFontSize: number;
  contentWidth: number;
  showCodeLineNumbers: boolean;
  showTypingHints: boolean;
  codeWrap: boolean;
  autoSaveMode: "manual" | "afterDelay";
  autoSaveDelaySeconds: number;
}

interface WorkspaceHistoryState {
  openWorkspaces: readonly RememberedWorkspace[];
  recentWorkspaces: readonly RememberedWorkspace[];
  recentFiles: readonly RememberedFile[];
  activeWorkspacePath: string | null;
}
```

设置键为 `markdown-workspace.settings.v1`，工作区历史键为 `markdown-workspace.workspaces.v1`；自动保存默认 manual，延迟归一化为 1–300 秒；最近工作区/文件各最多 12。二者 storage 不可用时静默退化，不影响文档。

### 4.5 Save As 迁移

```ts
relocateDocument(oldDocumentId, reopenedDocument, savedText);
```

迁移必须原子更新 reducer 内 session key/id/path 与所有 Tab 的 `current/back/forward` 引用。集成层传入其他已保存 session 的路径，Rust 在原子写盘前规范化比较并拒绝冲突，不能覆盖另一个打开文档或形成两个 session 指向同一路径。

## 5. 自动测试状态

持久覆盖包括：

1. Base64 paste/file blocked 不进入正文；约 10 MiB 普通多行走 `sourceOnly`。
2. 截图写入成功才插链接；原子保存故障后旧文件完整。
3. 可视/源码、IME、Undo/Redo、即时保存、未编辑零差异、GFM table 的局部滚动/view-only 列宽/网格/行列、图片和 Mermaid。
4. 同 session 多 Tab、独立 history/view、anchor、Outline、Markdown route first。
5. 代码/文本主 Tab 编辑、dirty、保存/Save As、新建 `.md/.txt` 和路径迁移。
6. 多根/树同时显示和独立折叠、活动根、最近项、Quick Open 来源、复制路径/关闭根、独立文件、最长匹配 owner、延迟恢复合并和全失效记录清理。
7. local-ref 完整后缀对齐、±20/前 80 行、浮层/右栏/主 Tab、真实 gutter/target、可读 token/selection，以及右栏已打开时直接替换与 latest-wins。
8. 12 个原生中英文菜单 action IDs、应用内 current/history dirty 对话框、custom close/quit、自定义结构/表格/链接/只读/工作区/标签右键；平台菜单仅顶部工具栏例外，debug 原生菜单可打开 DevTools。
9. Save As `excludedPaths` adapter/Rust 写前拒绝，以及 dirty 文档保存失败错误保持。
10. fence 候选/键盘/创建、语义位置映射、八项设置和双语字典。
11. manual/afterDelay、1–300 秒归一化、继续输入重排、untitled 跳过、迟到正文校验和失败仍 dirty。
12. 根/子目录 create-new、未知后缀/越界/同名拒绝，以及 macOS/Windows/Linux reveal 命令和 adapter 参数。
13. 文件/目录路径复制、废纸篓确认取消/成功、根/根外/不存在拒绝、系统失败保持，以及成功后的 session/history/tree 收敛。
14. 水平编辑组/独立 Tab、预览替换与固定、共享正文/独立视图/IME、跨组移动保留编辑器；最后 dirty 引用关闭、放弃后重读与延迟导航隔离。
15. 当前文件树展开/跟随、选中/悬浮对比度、图片链接路径与实际来源 Tab、专用查看器及失败返回，不影响已有代码预览。

本轮完整自动门禁：**PASS**（Vitest 35 文件 / 314 tests，Rust 37 tests）；最终产物和原生桌面验收细节以 `PROJECT_STATE.md` 为准。

- ADR-0007 上一稳定基线是 Vitest 24 files / 111 tests、Rust 22 tests，以及 format/lint/typecheck/Web build、Rust fmt/clippy、debug binary、隔离 smoke 和 ARM64 debug bundle PASS。
- 上述旧数字/产物不覆盖当前 ADR-0012。并行修改稳定后必须重跑并把新总数、失败/通过和最终 bundle 写入 `PROJECT_STATE.md`。
- 不得把本轮任一代理的局部测试数当作全仓库总数，也不得复制更旧的 20 files / 77 tests、14 Rust tests、6 IPC 或历史 `.app`/DMG 结论。

## 6. Phase 9 最终 UI smoke 与 UAT 清单

1. 从空状态新建 Markdown 和文本，分别 Save As；修改、`⌘S`、重开确认磁盘。
2. 打开受支持代码文件编辑/Save As，确认无 Markdown 模式按钮、dirty 和行号/换行设置正确。
3. 同时打开两个工作区，确认两个根/树同屏可见、可独立折叠并能激活；复制根路径、关闭一个工作区后确认另一根、最近项、已开 Tab 和磁盘保持；重启确认可用根和最近项尽力恢复。
4. 打开独立文件，确认记入最近文件但不新增工作区。
5. Markdown 链接 current/background/foreground、back/forward、Outline；切可视/源码确认落到语义相近内容。
6. `path:line` 先看 ±20 浮层，再右侧打开；右栏保持打开时点击第二个引用应直接替换并定位，快速点击以最后目标为准；再进可编辑主 Tab。
7. 在根和子目录新建无扩展名 Markdown、显式 txt/代码；对根、目录、文件和当前文档执行 reveal/复制路径；废纸篓取消、成功及模拟失败分别保持正确磁盘和 UI 状态。
8. 中文/英文设置切换后验证原生/More/普通结构/表格/工作区/标签右键、废纸篓/dirty 对话框和代码控件；选择不丢且选区可读、链接动作正确；浏览器默认菜单只允许顶部工具栏，debug 原生菜单可打开 DevTools。
9. 默认 manual 下确认 dirty 关闭提示；切 1 秒 afterDelay 后确认停止输入才保存、继续输入重排、untitled 不自动弹 Save As、失败仍提示。
10. 宽表格确认局部横向滚动；拖列宽后 Markdown/dirty 不变；网格插表、前后增行列、删除、Undo、保存重开正确。
11. 编辑历史页后导航，确认 Tab 仍显示 dirty；分别触发 Tab、红色关闭、原生 close/quit，应用内对话框取消可保持正文/窗口/进程，确认后只关闭一次；保存失败时具体错误保持可见。
12. 输入三个反引号加 `pyt`，用上下键/Enter/Tab/点击创建代码块，Esc 和关闭提示设置生效，Undo 可撤销创建。
13. 真实系统截图：已保存文档写入 `assets/` 后插链接；失败时正文不变；未保存文档先 Save As。
14. Mermaid/图片 viewer 的 zoom/pan/Fit/Esc，以及最终 production bundle 启动。
15. 标签右键向右分屏、物理跨组拖放、独立 Tab；树单击斜体预览、双击/编辑固定，下一次单击开启新预览；点击哪个编辑组就在哪组打开，不由侧栏点击改变目标。
16. 同文档跨组编辑、被动同步不抢焦点/选择/滚动、不进入本地 Undo；关闭一个共享副本不误丢正文，最后副本放弃后重新打开磁盘版本；慢读取不复活关闭/移组 Tab。
17. 无行号本地/HTTP(S) 图片链接进入专用查看器，失败可关闭，原标签/分屏/dirty/右侧代码栏保持；窄窗口多组时能看到活动编辑组。

ADR-0007 的隔离 QA bundle 曾覆盖启动、菜单/设置、新建、fence 补全、代码行号/Copy 和源码切换；当前 ADR-0012 必须基于最终工作树重建后再记录本清单结果。所有 smoke/UAT 不得写用户真实文档、记录剪贴板内容或把个人绝对路径提交仓库。

## 7. 每个任务的完成定义

- 用户可见行为与需求 ID 对应。
- 只修改声明路径，保留用户和其他代理的无关改动。
- 成功路径和最有价值的失败路径有自动测试。
- 运行受影响层 format/typecheck/lint/test/build；集成后更新准确数字。
- `PROJECT_STATE.md` 只写当前真的能做什么、当前验证和唯一下一步。
- 不引入纵向/递归分屏、IDE/LSP、未请求的网络能力、重型安全或 Ruby 工具链。
- 不读取、写回或提交真实用户文档、剪贴板内容、个人路径和大型 Base64 fixture。

## 8. 交接模板

仅为跨天或跨代理任务创建 task note：

```text
Task:
Status: IN_PROGRESS | REVIEW | DONE | BLOCKED
Requirements:
Owned paths:
Base / head:
Implemented behavior:
Exact verification:
Known limitations:
Next action:
```

小型完整改动直接用测试和 `PROJECT_STATE.md` 交接，不制造额外流程文档。

## 9. 不得复活的旧门禁

baseline 0.1 的可信 host smoke、HMAC/nonce、path-swap/quarantine、durable Save As journal、193 MiB IPC、37 命令生成契约、14 flags、Ruby 验证器和 Hosted CI 前置要求均已退役。旧 CodeMirror active-block live preview 同样退役。它们不是待办，也不能因当前出现一个右侧只读栏而包装成新框架重新引入。
