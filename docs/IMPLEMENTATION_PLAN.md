# Markdown Workspace 实施计划

状态：Active baseline 0.2

目标：优先得到每天可用的 macOS 本地编辑器，再逐步增强。

## 1. 编排原则

- 按纵向切片交付，不再设立独立“安全基础设施 Phase 0”。
- 每个阶段结束时应用仍能启动，旧功能不回退。
- 类型只覆盖当前 Tauri 命令；不预冻结未来接口。
- 多代理并行时按目录独占，集成者统一修改 shell、根清单、lockfile 和状态文档。
- 测试与风险相称；三项护栏必须有故障测试，其余不制造攻击矩阵。

## 2. 阶段与出口

### Phase 1：可编辑的本地工作区

任务：

1. `P1-NATIVE-01`：Rust chooser、文件树、预检打开、原子保存、图片写入。
2. `P1-STATE-01`：DocumentSession、Tab、history reducer 和内存 adapter。
3. `P1-WORKSPACE-01`：工作区空状态、文件树、Outline 容器。
4. `P1-EDITOR-01`：把 CodeMirror spike 收敛为产品 Editor adapter。
5. `P1-INTEGRATE-01`：打开 → 编辑 → dirty → `⌘S` → 重开。

出口：真实 Tauri app 能选择目录、从树打开 Markdown、编辑并原子保存；10 MiB 普通多行文档进入 source-only，大型 data-image 不进入前端。

### Phase 2：浏览器式文档导航

任务：

1. `P2-TABS-01`：创建、激活、关闭、dirty 提示。
2. `P2-ROUTER-01`：相对路径、anchor、外部 URL 解析。
3. `P2-HISTORY-01`：每 Tab back/forward 和 view state。
4. `P2-QUICKOPEN-01`：工作区快速打开。

出口：A → B → C 可后退/前进；修饰键打开新 Tab；同文件共享正文但历史独立。

### Phase 3：截图与视觉块

任务：

1. `P3-ASSET-01`：paste event → bytes → Rust assets → relative link。
2. `P3-MERMAID-01`：按需 Mermaid 渲染和源码失败回退。
3. `P3-VIEWER-01`：Mermaid/图片 viewer 的 zoom、pan、Fit、Esc。

出口：截图粘贴无需配置；失败不修改正文；图表可以清晰放大查看。

### Phase 4：首版完成度

任务：

1. 原生菜单、快捷键、最近工作区和主题。
2. 外部文件 mtime 提示、关闭 dirty 文档流程。
3. 工作区大目录懒加载和性能测量。
4. macOS 打包、签名前人工主链路验收。

出口：满足 `REQUIREMENTS.md` 全部 MVP 验收场景，可作为个人日常工具使用。

### Phase 5：P1 增强

按用户价值选择搜索/反向链接、两栏分屏、表格网格、数学、导出、Git。每项独立决定依赖，不作为 MVP 阻塞。

## 3. 并行边界

| 任务 | 路径所有权 | 可并行对象 | 合并前接口 |
|---|---|---|---|
| Native | `src-tauri/**` | State、Editor、Workspace UI | 当前 command 参数/返回样例 |
| State | `src/app/state/**` | Native、Editor | reducer state/actions/selectors |
| Editor | `src/features/editor/**` | Native、State、Workspace UI | props、change/save/link/paste callbacks |
| Workspace | `src/features/workspace/**` | Native、State、Editor | TreeNode/OutlineItem props |
| Navigation | `src/features/navigation/**` | Assets/Diagrams | resource resolution/result |
| Integration | `src/app/shell/**`、root config、docs | 无同文件编辑 | 集成全部模块 |

如果接口尚未确定，先用不超过一页的 TypeScript/Rust 类型冻结当前切片，不建设通用 schema 平台。

## 4. 当前阶段的最小接口

### Frontend adapter

~~~ts
interface DesktopAdapter {
  pickWorkspace(): Promise<WorkspaceSelection | null>;
  listWorkspace(root: string): Promise<WorkspaceEntry[]>;
  openDocument(path: string): Promise<DocumentOpenResult>;
  saveDocument(input: SaveDocumentInput): Promise<SaveResult>;
  saveClipboardImage(input: SaveImageInput): Promise<AssetWriteResult>;
}
~~~

### Editor adapter

~~~ts
interface MarkdownEditorProps {
  documentId: string;
  value: string;
  mode: "normal" | "sourceOnly";
  onChange(value: string): void;
  onInternalLink(target: string, disposition: LinkDisposition): void;
  onImagePaste?(image: ClipboardImage, selection: SelectionRange): Promise<void>;
}
~~~

### Navigation reducer

~~~ts
openInCurrent(tabId, target, previousView)
openInNewTab(target, active)
goBack(tabId, currentView)
goForward(tabId, currentView)
closeTab(tabId)
updateView(tabId, view)
~~~

## 5. 必须先写的测试

1. 大型 data-image 粘贴被拒绝，正文与 Undo 不变。
2. 同类文件 open 返回 blocked 且无 content 字段。
3. 10 MiB 普通多行 Markdown 返回 sourceOnly，可编辑保存。
4. 图片写入成功生成文件和相对 URI；失败不插链接。
5. 原子保存注入故障后旧文件完整，成功后新文件完整。
6. 中文 composition 一次提交，不跳光标。
7. A → B → back/forward 恢复 view；两个 Tab 的历史互不影响。

## 6. 每个任务的完成定义

- 需求 ID 和用户可见行为明确。
- 只修改声明路径或已协调的共享文件。
- 成功路径和最有价值的失败路径有自动测试。
- `pnpm typecheck` / focused tests / 相应 Rust tests 通过。
- 集成后运行 `pnpm verify`。
- `PROJECT_STATE.md` 写明“当前真的能做什么”、验证命令和唯一下一步。
- 没有把真实用户文档、个人绝对路径或 Base64 fixture 提交到仓库。

## 7. 交接模板

只为跨天或跨代理任务创建 task note：

~~~text
Task:
Status: IN_PROGRESS | REVIEW | DONE | BLOCKED
Requirements:
Owned paths:
Base / head:
Implemented behavior:
Exact verification:
Known limitations:
Next action:
~~~

小型完整改动直接用提交、测试和 `PROJECT_STATE.md` 记录，不为流程创建额外文档。

## 8. 不得复活的旧门禁

以下 baseline 0.1 实验已退役：可信 host release smoke、HMAC/nonce、path-swap/quarantine、durable Save-As journal、193 MiB IPC 往返、37 命令生成契约、14 feature flags、Ruby 验证器、Hosted CI 作为开工前提。Git 历史可供查阅，但它们不是待完成任务。
