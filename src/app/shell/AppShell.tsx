import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  activateTab,
  appStateReducer,
  closeTab as closeTabAction,
  createInitialAppState,
  createViewState,
  editDocument,
  goBack,
  goForward,
  markDocumentSaved,
  openInCurrent,
  openInNewTab,
  selectActiveTab,
  selectCanGoBack,
  selectCanGoForward,
  selectCurrentSession,
  selectOrderedTabs,
  updateView,
  type OpenDocument,
  type Tab,
} from "../state";
import type { LinkDisposition } from "../../features/editor/linkTarget";
import { resolveWorkspaceLink } from "../../features/navigation/resolveWorkspaceLink";
import { Outline } from "../../features/workspace/Outline";
import { WorkspaceTree } from "../../features/workspace/WorkspaceTree";
import {
  createDesktopAdapter,
  type DesktopAdapter,
  type WorkspaceNode,
  type WorkspaceSelection,
} from "../../infrastructure/tauri/desktopAdapter";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  FolderIcon,
  MoreIcon,
  OutlineIcon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  WorkspaceMark,
} from "./icons";
import "./AppShell.css";

type SidebarMode = "files" | "outline";

const MarkdownEditor = lazy(async () => {
  const editor = await import("../../features/editor/MarkdownEditor");
  return { default: editor.MarkdownEditor };
});

function fileName(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/");
  return parts.at(-1) || path;
}

function flattenMarkdown(nodes: readonly WorkspaceNode[]): WorkspaceNode[] {
  return nodes.flatMap((node) => [
    ...(node.kind === "markdown" ? [node] : []),
    ...flattenMarkdown(node.children ?? []),
  ]);
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

function toOpenDocument(
  result: Extract<
    Awaited<ReturnType<DesktopAdapter["openDocument"]>>,
    { status: "editable" }
  >,
): OpenDocument {
  return {
    path: result.path,
    text: result.content,
    diskMtimeMs: 0,
    mode: result.mode,
  };
}

function Welcome({
  adapterKind,
  busy,
  onOpenWorkspace,
}: {
  readonly adapterKind: DesktopAdapter["kind"];
  readonly busy: boolean;
  readonly onOpenWorkspace: () => void;
}) {
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <div className="welcome__symbol" aria-hidden="true">
        <WorkspaceMark />
      </div>
      <p className="welcome__eyebrow">Paper &amp; Ink · 本地优先</p>
      <h1 id="welcome-title">把本地文档，当作可以编辑的浏览器。</h1>
      <p className="welcome__lead">
        单画面编辑 Markdown，在本地链接之间前进和后退；截图自动落盘，图表可以深入查看。
      </p>

      <div className="welcome__actions">
        <button
          className="primary-button"
          disabled={busy}
          onClick={onOpenWorkspace}
          type="button"
        >
          {busy ? "正在打开…" : adapterKind === "demo" ? "打开演示工作区" : "打开工作区"}
        </button>
      </div>

      <p className="welcome__availability">
        {adapterKind === "demo"
          ? "当前是浏览器演示模式；启动桌面应用后可读写真实本地文件。"
          : "文档只在本机处理，不需要账户或服务端。"}
      </p>

      <ol className="foundation-progress" aria-label="首版核心能力">
        <li className="foundation-progress__item foundation-progress__item--ready">
          <span className="foundation-progress__index">01</span>
          <span>
            <strong>单画布编辑</strong>
            <small>源码是唯一真相</small>
          </span>
        </li>
        <li className="foundation-progress__item foundation-progress__item--ready">
          <span className="foundation-progress__index">02</span>
          <span>
            <strong>浏览器式导航</strong>
            <small>Tab、前进与后退</small>
          </span>
        </li>
        <li className="foundation-progress__item foundation-progress__item--ready">
          <span className="foundation-progress__index">03</span>
          <span>
            <strong>桌面文件能力</strong>
            <small>原子保存与截图落盘</small>
          </span>
        </li>
      </ol>
    </section>
  );
}

export function AppShell({
  adapter: providedAdapter,
}: {
  readonly adapter?: DesktopAdapter;
} = {}) {
  const adapter = useMemo(
    () => providedAdapter ?? createDesktopAdapter(),
    [providedAdapter],
  );
  const [appState, dispatch] = useReducer(
    appStateReducer,
    undefined,
    createInitialAppState,
  );
  const appStateRef = useRef(appState);
  const tabCounter = useRef(1);
  const [workspace, setWorkspace] = useState<WorkspaceSelection | null>(null);
  const [workspaceNodes, setWorkspaceNodes] = useState<readonly WorkspaceNode[]>([]);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("files");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("准备就绪");
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [editorReveal, setEditorReveal] = useState<{
    readonly documentId: string;
    readonly position: number;
    readonly requestId: number;
  } | null>(null);
  const revealCounter = useRef(1);

  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  const activeTab = selectActiveTab(appState);
  const activeSession = activeTab
    ? selectCurrentSession(appState, activeTab.id)
    : undefined;
  const orderedTabs = selectOrderedTabs(appState);
  const canGoBack = activeTab ? selectCanGoBack(appState, activeTab.id) : false;
  const canGoForward = activeTab ? selectCanGoForward(appState, activeTab.id) : false;
  const markdownFiles = useMemo(() => flattenMarkdown(workspaceNodes), [workspaceNodes]);
  const quickOpenFiles = useMemo(() => {
    const query = quickOpenQuery.trim().toLocaleLowerCase();
    return query
      ? markdownFiles.filter((node) =>
          node.relativePath.toLocaleLowerCase().includes(query),
        )
      : markdownFiles;
  }, [markdownFiles, quickOpenQuery]);

  const nextTabId = useCallback(() => `tab-${tabCounter.current++}`, []);

  const openDocument = useCallback(
    async (path: string, disposition: LinkDisposition = "current", anchor?: string) => {
      setBusy(true);
      try {
        const result = await adapter.openDocument(path);
        if (result.status === "blocked") {
          const reason =
            result.reason === "largeDataUri"
              ? "包含很大的内嵌图片数据"
              : result.reason === "lineTooLong"
                ? "包含过长的单行文本"
                : "不是可编辑的 UTF-8 文本";
          setStatus(`未打开：${reason}。原文件没有被修改。`);
          return;
        }

        const document = toOpenDocument(result);
        const targetView = createViewState({ anchor });
        const currentState = appStateRef.current;
        const currentTab = selectActiveTab(currentState);

        if (disposition === "current" && currentTab) {
          if (currentTab.current.path === path) {
            dispatch(updateView(currentTab.id, targetView));
          } else {
            dispatch(
              openInCurrent(currentTab.id, document, currentTab.current.view, targetView),
            );
          }
        } else {
          dispatch(
            openInNewTab(
              nextTabId(),
              document,
              disposition !== "newBackground",
              targetView,
            ),
          );
        }
        setStatus(
          disposition === "newBackground"
            ? `${fileName(path)} 已在后台标签页打开`
            : result.mode === "sourceOnly"
              ? `${fileName(path)} 已用纯源码模式打开`
              : `${fileName(path)} 已打开`,
        );
        setQuickOpenVisible(false);
      } catch (error) {
        setStatus(`打开失败：${readableError(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [adapter, nextTabId],
  );

  const openWorkspace = useCallback(async () => {
    setBusy(true);
    try {
      const selection = await adapter.pickWorkspace();
      if (!selection) {
        setStatus("已取消打开工作区");
        return;
      }
      const nodes = await adapter.listWorkspace(selection.path);
      setWorkspace(selection);
      setWorkspaceNodes(nodes);
      setStatus(`已打开工作区：${selection.name}`);
    } catch (error) {
      setStatus(`工作区打开失败：${readableError(error)}`);
    } finally {
      setBusy(false);
    }
  }, [adapter]);

  const saveActiveDocument = useCallback(async () => {
    const currentState = appStateRef.current;
    const tab = selectActiveTab(currentState);
    const session = tab ? selectCurrentSession(currentState, tab.id) : undefined;
    if (!session) return;

    setStatus(`正在保存 ${fileName(session.path)}…`);
    try {
      await adapter.saveDocument(session.path, session.text);
      dispatch(markDocumentSaved(session.id, session.text, Date.now()));
      setStatus(`${fileName(session.path)} 已保存`);
    } catch (error) {
      setStatus(`保存失败：${readableError(error)}`);
    }
  }, [adapter]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setQuickOpenVisible(false);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveActiveDocument();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (workspace) setQuickOpenVisible(true);
        else void openWorkspace();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openWorkspace, saveActiveDocument, workspace]);

  const closeTab = useCallback((tab: Tab) => {
    const state = appStateRef.current;
    const session = state.sessions[tab.current.documentId];
    const otherReferences = state.tabOrder.some(
      (tabId) => tabId !== tab.id && state.tabs[tabId]?.current.documentId === session?.id,
    );
    if (
      session?.dirty &&
      !otherReferences &&
      !window.confirm(`${fileName(session.path)} 尚未保存，仍然关闭这个标签页吗？`)
    ) {
      return;
    }
    dispatch(closeTabAction(tab.id));
  }, []);

  const handleInternalLink = (target: string, disposition: LinkDisposition) => {
    const session = activeSession;
    if (!session) return;
    const resolved = resolveWorkspaceLink(session.path, target, workspaceNodes);
    if (resolved.kind === "internal") {
      void openDocument(resolved.path, disposition, resolved.anchor);
    } else if (resolved.kind === "external") {
      window.open(resolved.href, "_blank", "noopener,noreferrer");
      setStatus("已交给浏览器打开外部链接");
    } else {
      setStatus(`没有找到链接目标：${target}`);
    }
  };

  const pasteClipboardImage = useCallback(async (): Promise<string> => {
    const state = appStateRef.current;
    const tab = selectActiveTab(state);
    const session = tab ? selectCurrentSession(state, tab.id) : undefined;
    if (!session) throw new Error("请先保存文档，再粘贴截图");
    const saved = await adapter.saveClipboardImage(session.path);
    setStatus(`截图已保存到 ${saved.markdownUri}`);
    return `![](${saved.markdownUri})`;
  }, [adapter]);

  const wordCount = activeSession
    ? activeSession.text.trim()
      ? activeSession.text.trim().split(/\s+/u).length
      : 0
    : 0;

  return (
    <div
      className={sidebarCollapsed ? "app-shell app-shell--sidebar-collapsed" : "app-shell"}
    >
      <header className="shell-toolbar">
        <div className="shell-toolbar__cluster" aria-label="浏览导航">
          <button
            aria-label="后退"
            className="icon-button"
            disabled={!activeTab || !canGoBack}
            onClick={() =>
              activeTab && dispatch(goBack(activeTab.id, activeTab.current.view))
            }
            type="button"
          >
            <ArrowLeftIcon />
          </button>
          <button
            aria-label="前进"
            className="icon-button"
            disabled={!activeTab || !canGoForward}
            onClick={() =>
              activeTab && dispatch(goForward(activeTab.id, activeTab.current.view))
            }
            type="button"
          >
            <ArrowRightIcon />
          </button>
        </div>

        <button
          aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
          aria-pressed={sidebarCollapsed}
          className="icon-button shell-toolbar__sidebar-toggle"
          onClick={() => setSidebarCollapsed((value) => !value)}
          type="button"
        >
          <PanelLeftIcon />
        </button>

        <div className="workspace-identity" aria-label="当前工作区">
          <WorkspaceMark className="workspace-identity__mark" />
          <span className="workspace-identity__app">Markdown Workspace</span>
          <span className="workspace-identity__separator" aria-hidden="true">
            /
          </span>
          <span className="workspace-identity__current">
            {workspace?.name ?? "未打开工作区"}
            {activeSession ? ` / ${fileName(activeSession.path)}` : ""}
          </span>
        </div>

        <div className="shell-toolbar__actions">
          <button
            className="command-button"
            onClick={() => (workspace ? setQuickOpenVisible(true) : void openWorkspace())}
            type="button"
          >
            <SearchIcon />
            <span>快速打开</span>
            <kbd>⌘K</kbd>
          </button>
          <button className="icon-button" aria-label="更多操作" type="button">
            <MoreIcon />
          </button>
        </div>
      </header>

      {!sidebarCollapsed && (
        <aside className="sidebar" aria-label="工作区侧栏">
          <div className="sidebar__mode-tabs" role="tablist" aria-label="侧栏内容">
            <button
              aria-controls="sidebar-panel"
              aria-selected={sidebarMode === "files"}
              className="sidebar__mode-tab"
              onClick={() => setSidebarMode("files")}
              role="tab"
              type="button"
            >
              文件
            </button>
            <button
              aria-controls="sidebar-panel"
              aria-selected={sidebarMode === "outline"}
              className="sidebar__mode-tab"
              onClick={() => setSidebarMode("outline")}
              role="tab"
              type="button"
            >
              大纲
            </button>
          </div>

          <div className="sidebar__body" id="sidebar-panel" role="tabpanel">
            {sidebarMode === "files" ? (
              workspace ? (
                <WorkspaceTree
                  activePath={activeSession?.path}
                  nodes={workspaceNodes}
                  onOpen={(path) => void openDocument(path)}
                />
              ) : (
                <div className="sidebar-empty">
                  <FolderIcon className="sidebar-empty__icon" />
                  <p className="sidebar-empty__title">尚未打开工作区</p>
                  <button
                    className="sidebar-empty__action"
                    onClick={openWorkspace}
                    type="button"
                  >
                    选择文件夹
                  </button>
                </div>
              )
            ) : activeSession ? (
              <Outline
                markdown={activeSession.text}
                onNavigate={(item) =>
                  setEditorReveal({
                    documentId: activeSession.id,
                    position: item.from,
                    requestId: revealCounter.current++,
                  })
                }
              />
            ) : (
              <div className="sidebar-empty">
                <OutlineIcon className="sidebar-empty__icon" />
                <p className="sidebar-empty__title">当前没有可用大纲</p>
                <p>打开 Markdown 后按标题生成。</p>
              </div>
            )}
          </div>

          <div className="sidebar__footer">
            <span>{workspace ? `${markdownFiles.length} 篇文档` : "本地工作区"}</span>
            <span className="sidebar__privacy">
              {adapter.kind === "demo" ? "演示" : "离线"}
            </span>
          </div>
        </aside>
      )}

      <nav className="tab-rail" aria-label="文档标签页">
        {orderedTabs.length === 0 && <span className="tab-rail__placeholder">开始</span>}
        {orderedTabs.map((tab) => {
          const session = appState.sessions[tab.current.documentId];
          return (
            <div
              className={
                tab.id === appState.activeTabId
                  ? "tab-rail__item tab-rail__item--active"
                  : "tab-rail__item"
              }
              key={tab.id}
            >
              <button
                aria-current={tab.id === appState.activeTabId ? "page" : undefined}
                className="tab-rail__tab"
                onClick={() => dispatch(activateTab(tab.id))}
                title={tab.current.path}
                type="button"
              >
                <span className="tab-rail__label">{fileName(tab.current.path)}</span>
                {session?.dirty && <span className="tab-rail__dirty" aria-label="未保存" />}
              </button>
              <button
                aria-label={`关闭 ${fileName(tab.current.path)}`}
                className="tab-rail__close"
                onClick={() => closeTab(tab)}
                type="button"
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          aria-label="新建标签页"
          className="tab-rail__new"
          disabled={markdownFiles.length === 0}
          onClick={() => setQuickOpenVisible(true)}
          type="button"
        >
          <PlusIcon />
        </button>
      </nav>

      <main className="main-viewport">
        {activeSession ? (
          <Suspense fallback={<div className="editor-loading">正在准备编辑器…</div>}>
            <MarkdownEditor
              documentId={activeSession.id}
              mode={activeSession.mode}
              onChange={(text) => dispatch(editDocument(activeSession.id, text))}
              onImagePaste={pasteClipboardImage}
              onInternalLink={handleInternalLink}
              onPasteError={(message) => setStatus(`图片没有保存：${message}`)}
              onPasteRejected={setStatus}
              reveal={
                editorReveal?.documentId === activeSession.id ? editorReveal : undefined
              }
              value={activeSession.text}
            />
          </Suspense>
        ) : (
          <Welcome adapterKind={adapter.kind} busy={busy} onOpenWorkspace={openWorkspace} />
        )}

        {quickOpenVisible && (
          <div
            className="quick-open-backdrop"
            onMouseDown={() => setQuickOpenVisible(false)}
          >
            <section
              aria-label="快速打开"
              className="quick-open"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <label>
                <SearchIcon />
                <input
                  autoFocus
                  onChange={(event) => setQuickOpenQuery(event.target.value)}
                  placeholder="搜索 Markdown 文件…"
                  value={quickOpenQuery}
                />
                <kbd>Esc</kbd>
              </label>
              <div className="quick-open__results">
                {quickOpenFiles.slice(0, 40).map((node) => (
                  <button
                    key={node.path}
                    onClick={() => void openDocument(node.path)}
                    type="button"
                  >
                    <span>{node.name}</span>
                    <small>{node.relativePath}</small>
                  </button>
                ))}
                {quickOpenFiles.length === 0 && <p>没有匹配的 Markdown 文件</p>}
              </div>
            </section>
          </div>
        )}
      </main>

      <footer className="status-bar" role="status" aria-live="polite">
        <span className="status-bar__state">
          <span className="status-bar__dot" aria-hidden="true" />
          {activeSession?.dirty ? "未保存" : status}
        </span>
        <span>
          {activeSession
            ? `${activeSession.mode === "sourceOnly" ? "纯源码" : "单画布"} · ${wordCount} 词`
            : "本地优先 · 无服务端"}
        </span>
        <span>Markdown Workspace 0.1.0</span>
      </footer>
    </div>
  );
}
