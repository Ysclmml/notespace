import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useI18n } from "../i18n";
import { useAppSettings } from "../settings";
import { APP_VERSION } from "../version";
import {
  activateTab,
  activateEditorGroup,
  appStateReducer,
  closeTab as closeTabAction,
  createInitialAppState,
  createViewState,
  discardDocuments,
  editDocument,
  goNavigationBack,
  goNavigationForward,
  markDocumentSaved,
  markDocumentExternalChange,
  reloadDocument,
  keepTabOpen,
  moveTabToGroup,
  navigateToView,
  openInCurrent,
  openInNewTab,
  openPreviewTab,
  relocateDocument,
  selectActiveTab,
  selectActiveEditorGroup,
  selectCanNavigateBack,
  selectCanNavigateForward,
  selectCurrentSession,
  selectEditorGroups,
  selectNavigationDestination,
  selectTabGroupId,
  moveTabRight,
  updateView,
  type AppState,
  type AppStateAction,
  type OpenDocument,
  type Tab,
} from "../state";
import type { LinkDisposition } from "../../features/editor/linkTarget";
import type { EditorRevealRequest } from "../../features/editor/MarkdownEditor";
import { semanticPositionFromMarkdown } from "../../features/editor/semanticPosition";
import type {
  ClipboardImagePasteKind,
  EditorImageInsertRequest,
} from "../../features/editor/clipboardImage";
import { DocumentStatisticsStatus } from "./DocumentStatisticsStatus";
import { AboutDialog } from "../../features/about/AboutDialog";
import { HelpDialog } from "../../features/help/HelpDialog";
import { UpdateDialog } from "../../features/update/UpdateDialog";
import { isAvailableUpdate, type AvailableUpdate } from "../../features/update/types";
import {
  loadSkippedUpdateVersion,
  saveSkippedUpdateVersion,
} from "../../features/update/updatePreferences";
import {
  RestoreNotice,
  type RestoreNoticeEntry,
} from "../../features/session-restore/RestoreNotice";
import { WorkspaceSearchDialog } from "../../features/workspace-search/WorkspaceSearchDialog";
import { trimSearchHistory } from "../../features/workspace-search/searchHistory";
import {
  createWorkspaceSearchViewState,
  type WorkspaceSearchRoot,
} from "../../features/workspace-search/types";
import { CodeFilePreview } from "../../features/code-preview/CodeFilePreview";
import { ExternalChangeBanner } from "../../features/external-changes/ExternalChangeBanner";
import { useFileSystemChanges } from "../../features/external-changes/useFileSystemChanges";
import {
  captureDocumentOwnership,
  referencedFilePaths,
  synchronizeDocuments,
} from "../../features/external-changes/synchronizeDocuments";
import { EditorGroupLayout } from "../../features/editor-groups/EditorGroupLayout";
import { EditorGroupTabs } from "../../features/editor-groups/EditorGroupTabs";
import {
  EditorContextMenu,
  useEditorContextMenu,
  useNativeContextMenuPolicy,
} from "../../features/context-menu";
import { localFileReferenceFromText } from "../../features/navigation/localFileReference";
import { imageReferenceFromLink } from "../../features/navigation/imageReference";
import { resolveWorkspaceLink } from "../../features/navigation/resolveWorkspaceLink";
import { sourcePositionAtLine } from "../../features/navigation/sourcePositionAtLine";
import { SettingsDialog } from "../../features/settings";
import { FavoritesPanel } from "../../features/favorites/FavoritesPanel";
import {
  favoriteLabels,
  isFavorite,
  loadFavorites,
  MAX_FAVORITES,
  relocateFavorite,
  saveFavorites,
  toggleFavorite,
} from "../../features/favorites/favorites";
import { TemplateDialog } from "../../features/templates/TemplateDialog";
import { templateLabels, type DocumentTemplate } from "../../features/templates/templates";
import {
  formatShortcut,
  getPlatform,
  hasPlatformModifier,
  matchesShortcut,
} from "../../features/shortcuts/shortcuts";
import { ExportDialog, type ExportFormat } from "../../features/export/ExportDialog";
import { ExportMenu } from "../../features/export/ExportMenu";
import { exportErrorMessage } from "../../features/export/exportErrorMessage";
import { WorkspaceImageSettingsDialog } from "../../features/settings/WorkspaceImageSettingsDialog";
import {
  buildSessionSnapshot,
  loadSessionSnapshot,
  saveSessionSnapshot,
  reopenSessionSnapshot,
} from "../../features/session-restore";
import { VisualViewer } from "../../features/viewer/VisualViewer";
import type { PreviewVisual } from "../../features/viewer/model";
import { Outline } from "../../features/workspace/Outline";
import { WorkspaceTree } from "../../features/workspace/WorkspaceTree";
import {
  activateRememberedWorkspace,
  emptyWorkspaceHistory,
  forgetOpenWorkspace,
  loadWorkspaceHistory,
  rememberFile,
  rememberWorkspace,
  saveWorkspaceHistory,
  getWorkspaceShowHidden,
  setWorkspaceShowHidden,
  getWorkspaceImageDirectory,
  setWorkspaceImageDirectory,
  type WorkspaceHistoryState,
} from "../../features/workspace/workspaceHistory";
import {
  extractOutline,
  findMarkdownAnchorPosition,
} from "../../features/workspace/outlineModel";
import {
  createDesktopAdapter,
  type DesktopAdapter,
  type LocalFilePreview,
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
  SearchIcon,
  WorkspaceMark,
} from "./icons";
import "./AppShell.css";

type SidebarMode = "files" | "outline";

function hasImageReferenceDialog(): boolean {
  return Boolean(document.querySelector('.image-reference-dialog[aria-modal="true"]'));
}

interface PendingEditorReveal extends EditorRevealRequest {
  readonly documentId: string;
  readonly position: number;
}

interface DocumentOpenTarget {
  readonly groupId?: string;
  readonly sourceTabId?: string;
  readonly treePreview?: boolean;
  readonly keepOpen?: boolean;
  readonly markdownLink?: boolean;
  readonly searchColumn?: number;
}

interface LocalPreviewOverlay {
  readonly reference: string;
  readonly sourceGroupId: string;
  readonly left: number;
  readonly top: number;
  readonly preview?: LocalFilePreview;
  readonly loading: boolean;
  readonly error?: string;
}

interface OpenWorkspaceState {
  readonly selection: WorkspaceSelection;
  readonly nodes: readonly WorkspaceNode[];
}

interface QuickOpenCandidate {
  readonly node: WorkspaceNode;
  readonly workspace: WorkspaceSelection;
}

interface SaveFailure {
  readonly documentId: string;
  readonly error: string;
}

interface ImagePasteFailure extends SaveFailure {
  readonly tabId: string;
}

interface AutoSaveSchedule {
  readonly text: string;
  readonly delayMs: number;
  readonly generation: number;
  readonly timer: number;
}

interface WorkspaceRestoreRun {
  readonly promise: Promise<readonly (OpenWorkspaceState | null)[]>;
}

type PendingCloseRequest =
  | {
      readonly kind: "tab";
      readonly tabId: string;
      readonly dirtyPaths: readonly string[];
    }
  | {
      readonly kind: "window";
      readonly dirtyPaths: readonly string[];
    };

interface PendingWorkspaceDelete {
  readonly owner: WorkspaceSelection;
  readonly node: WorkspaceNode;
  readonly affectedDocumentIds: readonly string[];
  readonly dirtyPaths: readonly string[];
}

const MarkdownEditor = lazy(async () => {
  const editor = await import("../../features/editor/MarkdownEditor");
  return { default: editor.MarkdownEditor };
});

function fileName(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/");
  return parts.at(-1) || path;
}

function comparablePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "");
  return /^[a-z]:\//iu.test(normalized)
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

function pathIsAtOrBelow(path: string, parentPath: string): boolean {
  const candidate = comparablePath(path);
  const parent = comparablePath(parentPath);
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard write failed");
}

function isUntitledPath(path: string): boolean {
  return path.startsWith("untitled://");
}

function flattenMarkdown(nodes: readonly WorkspaceNode[]): WorkspaceNode[] {
  return nodes.flatMap((node) => [
    ...(node.kind === "markdown" || node.kind === "text" ? [node] : []),
    ...flattenMarkdown(node.children ?? []),
  ]);
}

function withoutWorkspaceEntry(
  nodes: readonly WorkspaceNode[],
  removedPath: string,
): readonly WorkspaceNode[] {
  const target = comparablePath(removedPath);
  return nodes.flatMap((node) => {
    if (comparablePath(node.path) === target) return [];
    if (!node.children) return [node];
    return [{ ...node, children: withoutWorkspaceEntry(node.children, removedPath) }];
  });
}

function tabHistoryEntries(tab: Tab) {
  return [tab.current, ...tab.back, ...tab.forward];
}

function tabReferencesDocument(tab: Tab, documentId: string): boolean {
  return tabHistoryEntries(tab).some((entry) => entry.documentId === documentId);
}

function referencedDirtyDocumentIds(state: AppState): readonly string[] {
  const dirtyDocumentIds = new Set<string>();
  for (const tabId of state.tabOrder) {
    const tab = state.tabs[tabId];
    if (!tab) continue;
    for (const entry of tabHistoryEntries(tab)) {
      const session = state.sessions[entry.documentId];
      if (session?.dirty) dirtyDocumentIds.add(entry.documentId);
    }
  }
  return [...dirtyDocumentIds];
}

function tabDirtyDocumentIds(state: AppState, tab: Tab): readonly string[] {
  const dirtyDocumentIds = new Set<string>();
  for (const entry of tabHistoryEntries(tab)) {
    if (state.sessions[entry.documentId]?.dirty) {
      dirtyDocumentIds.add(entry.documentId);
    }
  }
  return [...dirtyDocumentIds];
}

function hasReferencedDirtyDocuments(state: AppState): boolean {
  return referencedDirtyDocumentIds(state).length > 0;
}

function referencedDocumentIds(state: AppState): Set<string> {
  const ids = new Set<string>();
  for (const tabId of state.tabOrder) {
    const tab = state.tabs[tabId];
    if (!tab) continue;
    for (const entry of tabHistoryEntries(tab)) ids.add(entry.documentId);
  }
  return ids;
}

function appendUniqueWorkspaces(
  current: readonly OpenWorkspaceState[],
  incoming: readonly OpenWorkspaceState[],
): readonly OpenWorkspaceState[] {
  const seen = new Set(current.map((item) => item.selection.path));
  const appended = [...current];
  for (const workspace of incoming) {
    if (seen.has(workspace.selection.path)) continue;
    seen.add(workspace.selection.path);
    appended.push(workspace);
  }
  return appended;
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

function clipboardImageError(error: unknown, t: ReturnType<typeof useI18n>["t"]): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  switch (code) {
    case "clipboardNoImage":
    case "clipboardUnavailable":
    case "imageDecodeFailed":
    case "imageTooLarge":
    case "imageDirectoryUnavailable":
    case "imageEncodeFailed":
    case "imagePreviewUnavailable":
    case "desktopOnly":
    case "io":
      return t(`imagePaste.${code}`);
    case "invalidImage":
      return t("imagePaste.imageDecodeFailed");
    case "invalidPath":
      return t("imagePaste.imageDirectoryUnavailable");
    case "documentNotSaved":
      return t("status.saveBeforeScreenshot");
    default:
      return readableError(error);
  }
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
    diskRevision: result.diskRevision,
    mode: result.mode,
    kind: result.documentKind,
    language: result.language,
  };
}

function Welcome({
  adapterKind,
  busy,
  onNewDocument,
  onOpenFile,
  onOpenWorkspace,
}: {
  readonly adapterKind: DesktopAdapter["kind"];
  readonly busy: boolean;
  readonly onNewDocument: () => void;
  readonly onOpenFile: () => void;
  readonly onOpenWorkspace: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <div className="welcome__symbol" aria-hidden="true">
        <WorkspaceMark />
      </div>
      <p className="welcome__eyebrow">{t("welcome.eyebrow")}</p>
      <h1 id="welcome-title">{t("welcome.title")}</h1>
      <p className="welcome__lead">{t("welcome.lead")}</p>

      <div className="welcome__actions">
        <button
          className="primary-button"
          disabled={busy}
          onClick={onOpenWorkspace}
          type="button"
        >
          {busy
            ? t("welcome.opening")
            : adapterKind === "demo"
              ? t("welcome.openDemoWorkspace")
              : t("welcome.openWorkspace")}
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={onOpenFile}
          type="button"
        >
          {t("menu.openFile")}
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={onNewDocument}
          type="button"
        >
          {t("menu.newMarkdown")}
        </button>
      </div>

      <p className="welcome__availability">
        {adapterKind === "demo"
          ? t("welcome.demoAvailability")
          : t("welcome.localAvailability")}
      </p>

      <ol className="foundation-progress" aria-label={t("welcome.foundationLabel")}>
        <li className="foundation-progress__item foundation-progress__item--ready">
          <span className="foundation-progress__index">01</span>
          <span>
            <strong>{t("welcome.singleCanvas")}</strong>
            <small>{t("welcome.singleCanvasDetail")}</small>
          </span>
        </li>
        <li className="foundation-progress__item foundation-progress__item--ready">
          <span className="foundation-progress__index">02</span>
          <span>
            <strong>{t("welcome.browserNavigation")}</strong>
            <small>{t("welcome.browserNavigationDetail")}</small>
          </span>
        </li>
        <li className="foundation-progress__item foundation-progress__item--ready">
          <span className="foundation-progress__index">03</span>
          <span>
            <strong>{t("welcome.desktopFiles")}</strong>
            <small>{t("welcome.desktopFilesDetail")}</small>
          </span>
        </li>
      </ol>
    </section>
  );
}

function trapConfirmationFocus(event: KeyboardEvent, button: HTMLButtonElement | null) {
  if (event.key !== "Tab") return;
  const dialog = button?.closest('[role="alertdialog"]');
  if (!dialog) return;
  const buttons = dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (!first || !last) {
    event.preventDefault();
  } else if (!dialog.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function UnsavedCloseDialog({
  dirtyPaths,
  kind,
  onCancel,
  onConfirm,
}: {
  readonly dirtyPaths: readonly string[];
  readonly kind: PendingCloseRequest["kind"];
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const { t } = useI18n();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      trapConfirmationFocus(event, cancelButtonRef.current);
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      returnFocus?.focus();
    };
  }, [onCancel]);

  return (
    <div
      className="settings-dialog-layer"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onCancel();
      }}
    >
      <section
        aria-label={t("closeConfirm.title")}
        aria-modal="true"
        className="settings-dialog confirmation-dialog"
        role="alertdialog"
      >
        <header className="settings-dialog__titlebar">
          <h2>{t("closeConfirm.title")}</h2>
        </header>
        <div className="confirmation-dialog__body">
          <p style={{ margin: "0 0 14px", lineHeight: 1.6 }}>
            {t(
              kind === "window" ? "closeConfirm.windowMessage" : "closeConfirm.tabMessage",
              { count: dirtyPaths.length },
            )}
          </p>
          <ul
            style={{
              maxHeight: 180,
              margin: 0,
              overflow: "auto",
              paddingLeft: 22,
              color: "var(--ink-700)",
            }}
          >
            {dirtyPaths.map((path) => (
              <li key={path} title={path}>
                {fileName(path)}
              </li>
            ))}
          </ul>
        </div>
        <footer className="settings-dialog__footer confirmation-dialog__footer">
          <button
            className="settings-reset-button"
            onClick={onCancel}
            ref={cancelButtonRef}
            type="button"
          >
            {t("common.cancel")}
          </button>
          <button className="primary-button" onClick={onConfirm} type="button">
            {t(
              kind === "window" ? "closeConfirm.discardWindow" : "closeConfirm.discardTab",
            )}
          </button>
        </footer>
      </section>
    </div>
  );
}

function WorkspaceDeleteDialog({
  busy,
  pending,
  onCancel,
  onConfirm,
}: {
  readonly busy: boolean;
  readonly pending: PendingWorkspaceDelete;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const { t } = useI18n();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      trapConfirmationFocus(event, cancelButtonRef.current);
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      returnFocus?.focus();
    };
  }, [busy, onCancel]);

  return (
    <div
      className="settings-dialog-layer"
      onMouseDown={(event) => {
        if (!busy && event.currentTarget === event.target) onCancel();
      }}
    >
      <section
        aria-label={t("deleteConfirm.title", { name: pending.node.name })}
        aria-modal="true"
        className="settings-dialog confirmation-dialog"
        role="alertdialog"
      >
        <header className="settings-dialog__titlebar">
          <h2>{t("deleteConfirm.title", { name: pending.node.name })}</h2>
        </header>
        <div className="confirmation-dialog__body">
          <p className="confirmation-dialog__path">{pending.node.path}</p>
          <p>{t("deleteConfirm.message")}</p>
          {pending.dirtyPaths.length > 0 && (
            <p
              style={{
                margin: "14px 0 0",
                color: "#b42318",
                lineHeight: 1.6,
              }}
            >
              {t("deleteConfirm.dirtyMessage", {
                count: pending.dirtyPaths.length,
              })}
            </p>
          )}
        </div>
        <footer className="settings-dialog__footer confirmation-dialog__footer">
          <button
            className="settings-reset-button"
            disabled={busy}
            onClick={onCancel}
            ref={cancelButtonRef}
            type="button"
          >
            {t("common.cancel")}
          </button>
          <button
            className="primary-button confirmation-dialog__destructive"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {t("deleteConfirm.moveToTrash")}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function AppShell({
  adapter: providedAdapter,
}: {
  readonly adapter?: DesktopAdapter;
} = {}) {
  const { locale, t } = useI18n();
  const { settings, updateSettings } = useAppSettings();
  const { contextMenu, onContextMenu, onPointerDownCapture, closeContextMenu } =
    useEditorContextMenu();
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
  const startupBehaviorRef = useRef(settings.startupBehavior);
  const startupUpdateCheckEnabledRef = useRef(settings.checkUpdatesOnStartup);
  const [initialSnapshot] = useState(() =>
    adapter.kind === "tauri" ? loadSessionSnapshot() : null,
  );
  const restoreCancelledRef = useRef(false);
  const [sessionRestored, setSessionRestored] = useState(
    adapter.kind !== "tauri" || settings.startupBehavior === "empty" || !initialSnapshot,
  );
  const [workspaceRestored, setWorkspaceRestored] = useState(adapter.kind !== "tauri");
  const [restoreIssues, setRestoreIssues] = useState<readonly RestoreNoticeEntry[]>([]);
  const restoreNoticeDismissedRef = useRef(false);
  const [restorePending, setRestorePending] = useState<readonly string[]>([]);
  const restorePendingRef = useRef(new Set<string>());
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat | null>(null);
  const [exportFailure, setExportFailure] = useState<{
    readonly documentId: string;
    readonly error: string;
  } | null>(null);
  const exportingRef = useRef(false);
  const tabCounter = useRef(1);
  const groupCounter = useRef(1);
  const documentOpenRequestsRef = useRef(new Map<string, number>());
  const workspaceVisibilityRequestsRef = useRef(new Map<string, number>());
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const untitledCounter = useRef(1);
  const [workspaces, setWorkspaces] = useState<readonly OpenWorkspaceState[]>([]);
  const [workspaceHistory, setWorkspaceHistory] = useState<WorkspaceHistoryState>(() => {
    const history =
      adapter.kind === "tauri" ? loadWorkspaceHistory() : emptyWorkspaceHistory;
    if (settings.startupBehavior === "empty")
      return {
        ...history,
        openWorkspaces: [],
        activeWorkspacePath: null,
      };
    if (!initialSnapshot) return history;
    return {
      ...history,
      openWorkspaces: initialSnapshot.workspacePaths.map(
        (path) =>
          history.openWorkspaces.find((item) => item.path === path) ??
          history.recentWorkspaces.find((item) => item.path === path) ?? {
            path,
            name: fileName(path),
            lastOpenedAt: 0,
          },
      ),
      activeWorkspacePath: initialSnapshot.activeWorkspacePath,
    };
  });
  const workspaceHistoryRef = useRef(workspaceHistory);
  const listWorkspaceFiles = useCallback(
    (path: string) =>
      getWorkspaceShowHidden(workspaceHistoryRef.current, path)
        ? adapter.listWorkspace(path, true)
        : adapter.listWorkspace(path),
    [adapter],
  );
  const refreshWorkspaceFiles = useCallback(
    async (path: string) => {
      const visibilityRequest = (workspaceVisibilityRequestsRef.current.get(path) ?? 0) + 1;
      workspaceVisibilityRequestsRef.current.set(path, visibilityRequest);
      const nodes = await listWorkspaceFiles(path);
      setWorkspaces((current) => {
        if ((workspaceVisibilityRequestsRef.current.get(path) ?? 0) !== visibilityRequest)
          return current;
        return current.map((item) =>
          item.selection.path === path ? { ...item, nodes } : item,
        );
      });
    },
    [listWorkspaceFiles],
  );
  const workspacesRef = useRef(workspaces);
  const restorationReadyRef = useRef(false);
  useLayoutEffect(() => {
    workspaceHistoryRef.current = workspaceHistory;
    workspacesRef.current = workspaces;
    restorationReadyRef.current = sessionRestored && workspaceRestored;
  }, [workspaceHistory, workspaces, sessionRestored, workspaceRestored]);
  const [workspaceMenuVisible, setWorkspaceMenuVisible] = useState(false);
  const restoredWorkspacesRef = useRef(false);
  const workspaceRestoreRunRef = useRef<WorkspaceRestoreRun | null>(null);
  const closedWorkspaceRestorePathsRef = useRef(new Set<string>());
  const initialWorkspaceRestoreCandidatesRef = useRef(workspaceHistory.openWorkspaces);
  const translateRef = useRef(t);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("files");
  const workspaceContextRequestId = useRef(0);
  const [workspaceContextRequest, setWorkspaceContextRequest] = useState<{
    rootPath: string;
    x: number;
    y: number;
    id: number;
  } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const previousFocusModeRef = useRef(false);
  useLayoutEffect(() => {
    if (previousFocusModeRef.current === focusMode) return;
    previousFocusModeRef.current = focusMode;
    const panel = document.querySelector<HTMLElement>(
      '.editor-tab-panel[data-focused="true"]',
    );
    // Keep the mounted editor/selection. Only move focus away from hidden chrome.
    if (panel?.contains(document.activeElement)) return;
    const target =
      panel?.querySelector<HTMLElement>(".ProseMirror, .cm-content, textarea, button") ??
      document.querySelector<HTMLElement>(
        focusMode ? ".focus-mode-exit" : ".shell-toolbar button",
      );
    target?.focus({ preventScroll: true });
  }, [focusMode]);
  const [templateVisible, setTemplateVisible] = useState(false);
  const [workspaceSearchVisible, setWorkspaceSearchVisible] = useState(false);
  const [workspaceSearchViewState, setWorkspaceSearchViewState] = useState(
    createWorkspaceSearchViewState,
  );
  useEffect(() => {
    trimSearchHistory(settings.searchHistoryLimit);
  }, [settings.searchHistoryLimit]);
  const [helpVisible, setHelpVisible] = useState(false);
  const [favorites, setFavorites] = useState<readonly string[]>(() =>
    adapter.kind === "tauri" ? loadFavorites() : [],
  );
  const favoriteCopy = favoriteLabels[locale];
  const templateCopy = templateLabels[locale];
  const inspectFavoritePaths = useMemo(
    () => adapter.inspectDocuments?.bind(adapter),
    [adapter],
  );
  const templateLibrary = useMemo(() => {
    if (
      !adapter.listDocumentTemplates ||
      !adapter.readDocumentTemplate ||
      !adapter.saveDocumentTemplate
    )
      return undefined;
    return {
      list: adapter.listDocumentTemplates.bind(adapter),
      read: adapter.readDocumentTemplate.bind(adapter),
      save: adapter.saveDocumentTemplate.bind(adapter),
      openDirectory: adapter.revealInFileManager.bind(adapter),
    };
  }, [adapter]);
  const focusLabel = locale === "zh-CN" ? "专注模式" : "Focus mode";
  const exitFocusLabel = locale === "zh-CN" ? "退出专注模式" : "Exit focus mode";
  const [busy, setBusy] = useState(false);
  const [localizedStatus, setStatus] = useReducer(
    (_current: { locale: string; message: string }, message: string) => ({
      locale,
      message,
    }),
    { locale, message: t("status.ready") },
  );
  const status =
    localizedStatus.locale === locale ? localizedStatus.message : t("status.ready");
  const toggleFileFavorite = useCallback(
    (path: string) => {
      if (isUntitledPath(path)) return;
      if (favorites.length >= MAX_FAVORITES && !isFavorite(favorites, path)) {
        setStatus(favoriteCopy.limit);
        return;
      }
      setFavorites((current) => toggleFavorite(current, path, adapter.kind === "demo"));
    },
    [adapter.kind, favoriteCopy.limit, favorites],
  );
  const [saveFailure, setSaveFailure] = useState<SaveFailure | null>(null);
  const [imagePasteFailure, setImagePasteFailure] = useState<ImagePasteFailure | null>(
    null,
  );
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [visual, setVisual] = useState<PreviewVisual | null>(null);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [aboutVisible, setAboutVisible] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [updatePromptReady, setUpdatePromptReady] = useState(false);
  const startupUpdateCheckRef = useRef<{
    readonly adapter: DesktopAdapter;
    readonly promise: Promise<import("../../features/update/types").UpdateCheckResult>;
  } | null>(null);
  const [imageSettingsWorkspace, setImageSettingsWorkspace] =
    useState<WorkspaceSelection | null>(null);
  const [imageInsertRequests, setImageInsertRequests] = useState<
    Readonly<Record<string, EditorImageInsertRequest>>
  >({});
  const imagePasteCounterRef = useRef(0);
  const imagePasteRequestsRef = useRef(new Map<string, number>());
  const imageSaveAsPendingRef = useRef(false);
  const imagePasteMountedRef = useRef(true);
  const validImageInsertEntries = Object.entries(imageInsertRequests).filter(
    ([tabId, request]) => {
      const tab = appState.tabs[tabId];
      const session = appState.sessions[request.documentId];
      return (
        tab?.current.documentId === request.documentId &&
        (session?.mode === "sourceOnly" ? "source" : tab.current.view.editorMode) ===
          request.editorMode &&
        session?.text === request.expectedText
      );
    },
  );
  if (validImageInsertEntries.length !== Object.keys(imageInsertRequests).length) {
    // Drop stale requests before committing a different editor surface. Returning
    // to an earlier mode or document must not resurrect a cancelled insertion.
    setImageInsertRequests(Object.fromEntries(validImageInsertEntries));
  }
  useEffect(() => {
    const requests = imagePasteRequestsRef.current;
    imagePasteMountedRef.current = true;
    return () => {
      imagePasteMountedRef.current = false;
      requests.clear();
    };
  }, []);
  const [moreMenuVisible, setMoreMenuVisible] = useState(false);
  const [pendingCloseRequest, setPendingCloseRequest] =
    useState<PendingCloseRequest | null>(null);
  const [pendingWorkspaceDelete, setPendingWorkspaceDelete] =
    useState<PendingWorkspaceDelete | null>(null);

  useEffect(() => {
    if (!startupUpdateCheckEnabledRef.current || !adapter.checkForUpdate) return undefined;
    let active = true;
    if (startupUpdateCheckRef.current?.adapter !== adapter) {
      startupUpdateCheckRef.current = {
        adapter,
        promise: adapter.checkForUpdate(),
      };
    }
    void startupUpdateCheckRef.current.promise
      .then((result) => {
        if (
          active &&
          isAvailableUpdate(result) &&
          loadSkippedUpdateVersion() !== result.latestVersion
        ) {
          setUpdatePromptReady(false);
          setAvailableUpdate(result);
        }
      })
      .catch(() => {
        // Startup checks are intentionally quiet. About offers an explicit retry.
      });
    return () => {
      active = false;
    };
  }, [adapter]);

  useEffect(() => {
    if (!availableUpdate) return undefined;
    let active = true;
    const refresh = () => {
      if (!active) return;
      setUpdatePromptReady(
        !document.querySelector('[aria-modal="true"]:not(.update-dialog)'),
      );
    };
    queueMicrotask(refresh);
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-modal"],
    });
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [availableUpdate]);

  useNativeContextMenuPolicy(
    Boolean(
      pendingCloseRequest ||
      pendingWorkspaceDelete ||
      imageSettingsWorkspace ||
      aboutVisible ||
      helpVisible ||
      availableUpdate,
    ),
  );
  const [localPreview, setLocalPreview] = useState<LocalPreviewOverlay | null>(null);
  const [codeTargetLines, setCodeTargetLines] = useState<Readonly<Record<string, number>>>(
    {},
  );
  const localPreviewTimerRef = useRef<number | null>(null);
  const localPreviewRequestRef = useRef(0);
  const sidePreviewRequestRef = useRef(0);
  const clearLocalPreviewTimer = useCallback(() => {
    if (localPreviewTimerRef.current !== null) {
      window.clearTimeout(localPreviewTimerRef.current);
      localPreviewTimerRef.current = null;
    }
  }, []);
  const closeLocalPreview = useCallback(() => {
    clearLocalPreviewTimer();
    localPreviewRequestRef.current += 1;
    setLocalPreview(null);
  }, [clearLocalPreviewTimer]);
  const openAbout = useCallback(() => {
    setMoreMenuVisible(false);
    setWorkspaceMenuVisible(false);
    setQuickOpenVisible(false);
    setSettingsVisible(false);
    closeContextMenu();
    closeLocalPreview();
    setAboutVisible(true);
  }, [closeContextMenu, closeLocalPreview]);
  const openHelp = useCallback(() => {
    setMoreMenuVisible(false);
    setWorkspaceMenuVisible(false);
    setQuickOpenVisible(false);
    setWorkspaceSearchVisible(false);
    setSettingsVisible(false);
    closeContextMenu();
    closeLocalPreview();
    setHelpVisible(true);
  }, [closeContextMenu, closeLocalPreview]);
  const [findRequests, setFindRequests] = useState<Readonly<Record<string, number>>>({});
  const findRequestCounter = useRef(1);
  const findInActivePage = useCallback(() => {
    if (
      settingsVisible ||
      aboutVisible ||
      helpVisible ||
      imageSettingsWorkspace ||
      quickOpenVisible ||
      visual ||
      pendingCloseRequest ||
      pendingWorkspaceDelete
    )
      return;
    const tabId = appStateRef.current.activeTabId;
    if (tabId) {
      const request = findRequestCounter.current++;
      setFindRequests((current) => ({ ...current, [tabId]: request }));
    }
  }, [
    settingsVisible,
    aboutVisible,
    helpVisible,
    imageSettingsWorkspace,
    quickOpenVisible,
    visual,
    pendingCloseRequest,
    pendingWorkspaceDelete,
  ]);
  const consumeFindRequest = useCallback((tabId: string, request: number) => {
    setFindRequests((current) =>
      current[tabId] === request ? { ...current, [tabId]: 0 } : current,
    );
  }, []);
  const [editorReveals, setEditorReveals] = useState<
    Readonly<Record<string, PendingEditorReveal>>
  >({});
  const revealCounter = useRef(1);
  const autoSaveTimersRef = useRef(new Map<string, AutoSaveSchedule>());
  const autoSaveGenerationsRef = useRef(new Map<string, number>());
  const saveQueuesRef = useRef(new Map<string, Promise<void>>());
  const nativeCloseCommittedRef = useRef(false);
  const confirmationPendingRef = useRef(false);

  useLayoutEffect(() => {
    confirmationPendingRef.current = Boolean(
      pendingCloseRequest ||
      pendingWorkspaceDelete ||
      imageSettingsWorkspace ||
      aboutVisible ||
      helpVisible ||
      availableUpdate,
    );
  }, [
    pendingCloseRequest,
    pendingWorkspaceDelete,
    imageSettingsWorkspace,
    aboutVisible,
    helpVisible,
    availableUpdate,
  ]);

  useLayoutEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  const commitAction = useCallback((action: AppStateAction) => {
    if (action.type !== "session/restore") restoreCancelledRef.current = true;
    const next = appStateReducer(appStateRef.current, action);
    appStateRef.current = next;
    dispatch(action);
    return next;
  }, []);

  const persistBrowsing = useCallback(() => {
    if (adapter.kind !== "tauri" || !restorationReadyRef.current) return;
    saveSessionSnapshot(
      buildSessionSnapshot(appStateRef.current, {
        workspacePaths: workspacesRef.current.map((workspace) => workspace.selection.path),
        activeWorkspacePath: workspaceHistoryRef.current.activeWorkspacePath,
      }),
    );
  }, [adapter.kind]);

  useEffect(() => {
    if (sessionRestored) return;
    let cancelled = false;
    if (initialSnapshot && startupBehaviorRef.current === "restore") {
      void reopenSessionSnapshot(
        initialSnapshot,
        adapter,
        () =>
          !cancelled && !restoreCancelledRef.current && !nativeCloseCommittedRef.current,
      ).then((result) => {
        if (cancelled) return;
        if (result && !restoreCancelledRef.current) {
          commitAction({ type: "session/restore", state: result.state });
          if (!restoreNoticeDismissedRef.current)
            setRestoreIssues((current) => [
              ...current,
              ...result.skippedPaths.map((path) => ({ kind: "document" as const, path })),
            ]);
        }
        setSessionRestored(true);
      });
    } else setSessionRestored(true);
    return () => {
      cancelled = true;
    };
  }, [adapter, commitAction, initialSnapshot, sessionRestored]);

  useEffect(() => {
    if (!sessionRestored || !workspaceRestored) return;
    const timer = window.setTimeout(persistBrowsing, 300);
    window.addEventListener("pagehide", persistBrowsing);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", persistBrowsing);
    };
  }, [
    appState,
    workspaces,
    workspaceHistory,
    sessionRestored,
    workspaceRestored,
    persistBrowsing,
  ]);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  const destroyNativeWindow = useCallback(() => {
    if (adapter.kind !== "tauri" || nativeCloseCommittedRef.current) return;
    persistBrowsing();
    nativeCloseCommittedRef.current = true;
    setPendingCloseRequest(null);
    void getCurrentWindow()
      .destroy()
      .catch((error: unknown) => {
        nativeCloseCommittedRef.current = false;
        console.error("Failed to destroy the native application window", error);
      });
  }, [adapter.kind, persistBrowsing]);

  const requestNativeWindowClose = useCallback(() => {
    if (
      adapter.kind !== "tauri" ||
      nativeCloseCommittedRef.current ||
      confirmationPendingRef.current ||
      imageSaveAsPendingRef.current ||
      hasImageReferenceDialog()
    ) {
      return;
    }
    const state = appStateRef.current;
    const dirtyDocumentIds = referencedDirtyDocumentIds(state);
    if (dirtyDocumentIds.length > 0) {
      setPendingCloseRequest({
        kind: "window",
        dirtyPaths: dirtyDocumentIds.flatMap((documentId) => {
          const session = state.sessions[documentId];
          return session ? [session.path] : [];
        }),
      });
      return;
    }
    destroyNativeWindow();
  }, [adapter.kind, destroyNativeWindow]);

  useEffect(() => {
    if (adapter.kind === "tauri") return undefined;
    const preventAccidentalClose = (event: BeforeUnloadEvent) => {
      if (!hasReferencedDirtyDocuments(appStateRef.current)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventAccidentalClose);
    return () => window.removeEventListener("beforeunload", preventAccidentalClose);
  }, [adapter.kind]);

  useEffect(() => {
    if (adapter.kind !== "tauri") return undefined;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const appWindow = getCurrentWindow();
    void appWindow
      .onCloseRequested((event) => {
        event.preventDefault();
        requestNativeWindowClose();
      })
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [adapter.kind, requestNativeWindowClose]);

  useEffect(() => {
    void adapter.setNativeMenuLocale?.(locale).catch(() => undefined);
  }, [adapter, locale]);

  useEffect(() => {
    if (adapter.kind !== "tauri") return;
    saveWorkspaceHistory(workspaceHistory);
  }, [adapter.kind, workspaceHistory]);

  useEffect(() => {
    if (adapter.kind === "tauri") saveFavorites(favorites);
  }, [adapter.kind, favorites]);

  useEffect(() => {
    if (adapter.kind !== "tauri" || restoredWorkspacesRef.current) return;
    let cancelled = false;
    const restoreCandidates = initialWorkspaceRestoreCandidatesRef.current;
    let restoreRun = workspaceRestoreRunRef.current;
    if (!restoreRun) {
      restoreRun = {
        promise: Promise.all(
          restoreCandidates.map(async (selection) => {
            try {
              const nodes = await listWorkspaceFiles(selection.path);
              return {
                selection: { path: selection.path, name: selection.name },
                nodes,
              } satisfies OpenWorkspaceState;
            } catch {
              return null;
            }
          }),
        ),
      };
      workspaceRestoreRunRef.current = restoreRun;
    }
    void restoreRun.promise.then((restored) => {
      if (cancelled || restoredWorkspacesRef.current || nativeCloseCommittedRef.current)
        return;
      restoredWorkspacesRef.current = true;
      setWorkspaceRestored(true);
      workspaceRestoreRunRef.current = null;
      const available: OpenWorkspaceState[] = [];
      for (const workspace of restored) {
        if (
          workspace &&
          !closedWorkspaceRestorePathsRef.current.has(workspace.selection.path)
        )
          available.push(workspace);
      }
      const manuallyOpenedPaths = workspacesRef.current.map((item) => item.selection.path);
      const missing = restoreCandidates.filter(
        (selection, index) =>
          !restored[index] &&
          !manuallyOpenedPaths.includes(selection.path) &&
          !closedWorkspaceRestorePathsRef.current.has(selection.path),
      );
      if (!restoreNoticeDismissedRef.current)
        setRestoreIssues((current) => [
          ...current,
          ...missing.map(({ path }) => ({ kind: "workspace" as const, path })),
        ]);
      setWorkspaces((current) =>
        appendUniqueWorkspaces(
          current,
          available.filter(
            (item) => !closedWorkspaceRestorePathsRef.current.has(item.selection.path),
          ),
        ),
      );
      setWorkspaceHistory((current) => {
        const requestedPaths = new Set(restoreCandidates.map((item) => item.path));
        const validPaths = new Set([
          ...available.map((item) => item.selection.path),
          ...manuallyOpenedPaths,
        ]);
        const openWorkspaces = current.openWorkspaces.filter(
          (item) => !requestedPaths.has(item.path) || validPaths.has(item.path),
        );
        return {
          ...current,
          openWorkspaces,
          activeWorkspacePath: openWorkspaces.some(
            (item) => item.path === current.activeWorkspacePath,
          )
            ? current.activeWorkspacePath
            : (openWorkspaces.at(-1)?.path ?? null),
        };
      });
      if (available.length > 0) {
        setStatus(
          translateRef.current("status.workspaceRestored", { count: available.length }),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, listWorkspaceFiles]);

  useEffect(() => {
    if (!moreMenuVisible && !workspaceMenuVisible) return undefined;
    const close = (event: PointerEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element?.closest(".more-menu-host")) setMoreMenuVisible(false);
      if (!element?.closest(".workspace-identity-host")) setWorkspaceMenuVisible(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [moreMenuVisible, workspaceMenuVisible]);

  const activeTab = selectActiveTab(appState);
  const activeSession = activeTab
    ? selectCurrentSession(appState, activeTab.id)
    : undefined;
  const editorGroups = selectEditorGroups(appState);
  const canGoBack = selectCanNavigateBack(appState);
  const canGoForward = selectCanNavigateForward(appState);
  const editorMode =
    activeSession?.mode === "sourceOnly"
      ? "source"
      : (activeTab?.current.view.editorMode ?? "visual");
  const activeDocumentPath = activeSession?.path;
  const activeDocumentWorkspacePath = activeDocumentPath
    ? workspaces
        .filter((item) => pathIsAtOrBelow(activeDocumentPath, item.selection.path))
        .sort((left, right) => right.selection.path.length - left.selection.path.length)[0]
        ?.selection.path
    : undefined;
  const followedDocumentKey = JSON.stringify([
    activeTab?.id,
    activeDocumentPath,
    activeDocumentWorkspacePath,
  ]);
  const [lastFollowedDocumentKey, setLastFollowedDocumentKey] = useState("");
  if (lastFollowedDocumentKey !== followedDocumentKey) {
    // Follow navigation before rendering; typing or choosing an action root does not
    // pull the sidebar back to the document's workspace on the next render.
    setLastFollowedDocumentKey(followedDocumentKey);
    if (activeDocumentWorkspacePath) {
      setWorkspaceHistory((current) =>
        activateRememberedWorkspace(current, activeDocumentWorkspacePath),
      );
    }
  }
  const activeWorkspace = useMemo(
    () =>
      workspaces.find(
        (item) => item.selection.path === workspaceHistory.activeWorkspacePath,
      ) ??
      workspaces[0] ??
      null,
    [workspaceHistory.activeWorkspacePath, workspaces],
  );
  const workspace = activeWorkspace?.selection ?? null;
  const searchRoots = useMemo<WorkspaceSearchRoot[]>(
    () =>
      workspaces.map(({ selection }) => ({
        path: selection.path,
        showHidden: getWorkspaceShowHidden(workspaceHistory, selection.path),
      })),
    [workspaces, workspaceHistory],
  );
  const searchWorkspaces = useMemo(
    () => adapter.searchWorkspaces?.bind(adapter),
    [adapter],
  );
  const showWorkspaceSearch = useCallback(() => {
    if (
      confirmationPendingRef.current ||
      imageSaveAsPendingRef.current ||
      hasImageReferenceDialog()
    )
      return;
    if (!searchWorkspaces) {
      setStatus(t("search.unavailable"));
      return;
    }
    setFocusMode(false);
    setWorkspaceSearchVisible(true);
    setQuickOpenVisible(false);
    setMoreMenuVisible(false);
  }, [searchWorkspaces, t]);
  const allWorkspaceFiles = useMemo<readonly QuickOpenCandidate[]>(
    () =>
      workspaces.flatMap((item) =>
        flattenMarkdown(item.nodes).map((node) => ({
          node,
          workspace: item.selection,
        })),
      ),
    [workspaces],
  );
  const quickOpenFiles = useMemo(() => {
    const query = quickOpenQuery.trim().toLocaleLowerCase();
    return query
      ? allWorkspaceFiles.filter(({ node, workspace: candidateWorkspace }) =>
          `${candidateWorkspace.name}/${node.relativePath}`
            .toLocaleLowerCase()
            .includes(query),
        )
      : allWorkspaceFiles;
  }, [allWorkspaceFiles, quickOpenQuery]);

  const nextTabId = useCallback(() => `tab-${tabCounter.current++}`, []);

  const editSessionDocument = useCallback((documentId: string, text: string) => {
    const action = editDocument(documentId, text);
    appStateRef.current = appStateReducer(appStateRef.current, action);
    dispatch(action);
  }, []);

  const setEditorRevealForTab = useCallback(
    (tabId: string, reveal: PendingEditorReveal | null) => {
      setEditorReveals((current) => {
        if (reveal) return { ...current, [tabId]: reveal };
        if (!current[tabId]) return current;
        const next = { ...current };
        delete next[tabId];
        return next;
      });
    },
    [],
  );

  const activateWorkspace = useCallback((path: string) => {
    setWorkspaceHistory((current) => activateRememberedWorkspace(current, path));
  }, []);

  const addWorkspace = useCallback(
    async (selection: WorkspaceSelection) => {
      const existing = workspaces.find((item) => item.selection.path === selection.path);
      if (existing) {
        activateWorkspace(selection.path);
        return existing;
      }
      const nodes = await listWorkspaceFiles(selection.path);
      const opened = { selection, nodes } satisfies OpenWorkspaceState;
      setWorkspaces((current) => appendUniqueWorkspaces(current, [opened]));
      setWorkspaceHistory((current) => rememberWorkspace(current, selection));
      return opened;
    },
    [activateWorkspace, listWorkspaceFiles, workspaces],
  );

  const openDocument = useCallback(
    async (
      path: string,
      disposition: LinkDisposition = "current",
      anchor?: string,
      targetLine?: number,
      target: DocumentOpenTarget = {},
    ) => {
      restoreCancelledRef.current = true;
      const initialState = appStateRef.current;
      const initialTab = target.sourceTabId
        ? initialState.tabs[target.sourceTabId]
        : selectActiveTab(initialState);
      const groupId =
        target.groupId ??
        (initialTab ? selectTabGroupId(initialState, initialTab.id) : undefined) ??
        selectActiveEditorGroup(initialState)?.id;
      if (!groupId) return;
      const initialGroupTabId = initialState.editorGroups.find(
        (group) => group.id === groupId,
      )?.activeTabId;
      // Capture the destination before disk I/O. A later click in another split
      // must not redirect this request, and a double-click must win over preview.
      const requestId = (documentOpenRequestsRef.current.get(groupId) ?? 0) + 1;
      if (disposition === "current")
        documentOpenRequestsRef.current.set(groupId, requestId);
      const initialSession = initialTab
        ? selectCurrentSession(initialState, initialTab.id)
        : undefined;
      if (
        target.markdownLink &&
        disposition === "current" &&
        initialTab?.current.path === path &&
        initialSession?.kind === "markdown"
      ) {
        // In-page navigation uses the current (possibly unsaved) body. Reading
        // the disk here breaks anchors in untitled or externally moved files.
        if (anchor) {
          const position = findMarkdownAnchorPosition(initialSession.text, anchor) ?? 0;
          commitAction(
            navigateToView(
              initialTab.id,
              createViewState({
                ...initialTab.current.view,
                anchor,
                selectionFrom: position,
                selectionTo: position,
                visualSelectionFrom: position,
                visualSelectionTo: position,
              }),
            ),
          );
          setEditorRevealForTab(initialTab.id, {
            documentId: initialSession.id,
            anchor,
            headingText: extractOutline(initialSession.text).find(
              (item) => item.from === position,
            )?.title,
            position,
            requestId: revealCounter.current++,
          });
        }
        return;
      }
      const requestIsCurrent = () => {
        const state = appStateRef.current;
        const group = state.editorGroups.find((item) => item.id === groupId);
        if (!group) return false;
        if (disposition !== "current") return true;
        if (documentOpenRequestsRef.current.get(groupId) !== requestId) return false;
        // New, moved, or explicitly opened tabs can change the displayed page
        // without passing through the tab-selection handler.
        if (group.activeTabId !== initialGroupTabId) return false;
        // A current-tab navigation belongs to that exact Tab in that exact group.
        // Closing or moving it while disk I/O runs must not resurrect or overwrite it.
        return (
          target.treePreview ||
          !initialTab ||
          selectTabGroupId(state, initialTab.id) === groupId
        );
      };
      setBusy(true);
      try {
        const result = await adapter.openDocument(path);
        if (!requestIsCurrent()) return;
        if (result.status === "blocked") {
          setStatus(
            result.reason === "largeDataUri"
              ? t("status.openFailedDataUri")
              : result.reason === "lineTooLong"
                ? t("status.openFailedLongLine")
                : t("status.openFailedUtf8"),
          );
          return;
        }
        if (target.markdownLink && result.documentKind !== "markdown") {
          setStatus(t("status.linkNotFound", { target: path }));
          return;
        }

        const document = toOpenDocument(result);
        const currentState = appStateRef.current;
        const focusedGroupAfterRead = currentState.activeEditorGroupId;
        const currentTab = initialTab ? currentState.tabs[initialTab.id] : undefined;
        const cached = currentState.sessions[document.path];
        const navigationText =
          cached && (cached.dirty || referencedDocumentIds(currentState).has(cached.id))
            ? cached.text
            : result.content;
        const anchorPosition =
          target.searchColumn !== undefined && targetLine
            ? sourcePositionAtLine(navigationText, targetLine, target.searchColumn)
            : result.documentKind === "markdown"
              ? (findMarkdownAnchorPosition(navigationText, anchor) ?? 0)
              : 0;
        const anchorHeading =
          result.documentKind === "markdown"
            ? extractOutline(navigationText).find((item) => item.from === anchorPosition)
                ?.title
            : undefined;
        const targetView = createViewState({
          anchor,
          editorMode:
            result.documentKind === "text" || result.mode === "sourceOnly"
              ? "source"
              : currentTab?.current.path === document.path
                ? currentTab.current.view.editorMode
                : "visual",
          selectionFrom: anchorPosition,
          selectionTo: anchorPosition,
          visualSelectionFrom: anchorPosition,
          visualSelectionTo: anchorPosition,
        });

        // An explicit Markdown navigation must not replace a kept/edited page.
        // Its destination is a new preview tab, so subsequent ordinary links can
        // replace that preview. Same-document anchors always stay in their tab.
        const keepSourceTab =
          target.markdownLink &&
          disposition === "current" &&
          currentTab &&
          currentTab.current.path !== document.path &&
          (!currentTab.preview ||
            currentState.sessions[currentTab.current.documentId]?.dirty);
        const focusDestination = focusedGroupAfterRead === groupId;

        let targetTabId: string;
        if (target.treePreview) {
          const next = commitAction(
            openPreviewTab(
              nextTabId(),
              document,
              groupId,
              target.keepOpen,
              focusDestination,
            ),
          );
          const group = selectEditorGroups(next).find((item) => item.id === groupId);
          if (!group?.activeTab) return;
          targetTabId = group.activeTab.id;
        } else if (disposition === "current" && currentTab && !keepSourceTab) {
          targetTabId = currentTab.id;
          if (currentTab.current.path !== document.path || anchor) {
            commitAction(
              openInCurrent(currentTab.id, document, currentTab.current.view, targetView),
            );
          }
        } else {
          targetTabId = nextTabId();
          commitAction(
            openInNewTab(
              targetTabId,
              document,
              disposition !== "newBackground",
              targetView,
              groupId,
              Boolean(keepSourceTab),
              focusDestination,
            ),
          );
        }
        setEditorRevealForTab(
          targetTabId,
          anchor || (target.searchColumn !== undefined && targetLine)
            ? {
                documentId: document.path,
                anchor,
                headingText: target.searchColumn !== undefined ? undefined : anchorHeading,
                position: anchorPosition,
                semanticPosition:
                  target.searchColumn !== undefined && result.documentKind === "markdown"
                    ? semanticPositionFromMarkdown(navigationText, anchorPosition)
                    : undefined,
                focus: target.searchColumn !== undefined ? focusDestination : undefined,
                requestId: revealCounter.current++,
              }
            : null,
        );
        if (target.searchColumn !== undefined && targetLine) {
          const openedTab = appStateRef.current.tabs[targetTabId];
          if (openedTab) {
            // Opening a result has already recorded the destination visit. Only
            // an explicit move within the same active page needs another one.
            const locate =
              focusDestination &&
              initialTab?.id === targetTabId &&
              initialTab.current.documentId === document.path
                ? navigateToView
                : updateView;
            commitAction(
              locate(
                targetTabId,
                createViewState({
                  ...openedTab.current.view,
                  selectionFrom: anchorPosition,
                  selectionTo: anchorPosition,
                }),
              ),
            );
          }
        }
        setCodeTargetLines((current) => {
          const next = { ...current };
          if (targetLine) next[targetTabId] = targetLine;
          else delete next[targetTabId];
          return next;
        });
        setStatus(
          disposition === "newBackground"
            ? t("status.openedBackground", { name: fileName(path) })
            : result.mode === "sourceOnly"
              ? t("status.openedSource", { name: fileName(path) })
              : t("status.opened", { name: fileName(path) }),
        );
        const containingWorkspace = workspaces
          .filter(
            (item) =>
              result.path === item.selection.path ||
              result.path.startsWith(`${item.selection.path.replace(/\/$/u, "")}/`),
          )
          .sort(
            (left, right) => right.selection.path.length - left.selection.path.length,
          )[0];
        setWorkspaceHistory((current) => {
          let next = rememberFile(
            current,
            { path: result.path, name: fileName(result.path) },
            Date.now(),
          );
          if (
            containingWorkspace &&
            disposition !== "newBackground" &&
            focusedGroupAfterRead === groupId
          ) {
            next = activateRememberedWorkspace(next, containingWorkspace.selection.path);
          }
          return next;
        });
        setQuickOpenVisible(false);
        setRestoreIssues((current) =>
          current.filter((item) => item.kind !== "document" || item.path !== path),
        );
      } catch (error) {
        if (requestIsCurrent()) {
          setStatus(t("status.openFailed", { error: readableError(error) }));
        }
      } finally {
        setBusy(false);
      }
    },
    [adapter, commitAction, nextTabId, setEditorRevealForTab, t, workspaces],
  );

  const associatedOpenDocumentRef = useRef(openDocument);
  useEffect(() => {
    associatedOpenDocumentRef.current = openDocument;
  }, [openDocument]);

  useEffect(() => {
    const listen = adapter.listenOpenedDocumentPaths;
    if (!listen) return undefined;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    let opens = Promise.resolve();
    void listen
      .call(adapter, (paths) => {
        opens = opens.then(async () => {
          for (const path of paths) {
            if (disposed) return;
            await associatedOpenDocumentRef.current(path, "newForeground");
          }
        });
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        if (!disposed) {
          setStatus(
            translateRef.current("status.openFailed", { error: readableError(error) }),
          );
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [adapter]);

  const openWorkspace = useCallback(async () => {
    setBusy(true);
    try {
      const selection = await adapter.pickWorkspace();
      if (!selection) {
        setStatus(t("status.workspaceCancelled"));
        return;
      }
      await addWorkspace(selection);
      setRestoreIssues((current) =>
        current.filter((item) => item.kind !== "workspace" || item.path !== selection.path),
      );
      setStatus(t("status.workspaceOpened", { name: selection.name }));
    } catch (error) {
      setStatus(t("status.workspaceFailed", { error: readableError(error) }));
    } finally {
      setBusy(false);
    }
  }, [adapter, addWorkspace, t]);

  const reopenWorkspace = useCallback(
    async (selection: WorkspaceSelection) => {
      setBusy(true);
      try {
        await addWorkspace(selection);
        setRestoreIssues((current) =>
          current.filter(
            (item) => item.kind !== "workspace" || item.path !== selection.path,
          ),
        );
        setStatus(t("status.workspaceOpened", { name: selection.name }));
      } catch (error) {
        setStatus(t("status.workspaceFailed", { error: readableError(error) }));
      } finally {
        setBusy(false);
      }
    },
    [addWorkspace, t],
  );

  const retryRestore = async (entry: RestoreNoticeEntry) => {
    const key = `${entry.kind}:${entry.path}`;
    if (
      restorePendingRef.current.has(key) ||
      confirmationPendingRef.current ||
      imageSaveAsPendingRef.current ||
      hasImageReferenceDialog()
    )
      return;
    restorePendingRef.current.add(key);
    setRestorePending(
      [...restorePendingRef.current].map((item) => item.slice(item.indexOf(":") + 1)),
    );
    try {
      if (entry.kind === "workspace")
        await reopenWorkspace({ path: entry.path, name: fileName(entry.path) });
      else
        await openDocument(entry.path, "current", undefined, undefined, {
          treePreview: true,
        });
    } finally {
      restorePendingRef.current.delete(key);
      setRestorePending(
        [...restorePendingRef.current].map((item) => item.slice(item.indexOf(":") + 1)),
      );
    }
  };

  const forgetRestore = (entry: RestoreNoticeEntry) => {
    if (confirmationPendingRef.current) return;
    setRestoreIssues((current) =>
      current.filter((item) => item.kind !== entry.kind || item.path !== entry.path),
    );
    setWorkspaceHistory((current) =>
      entry.kind === "workspace"
        ? {
            ...current,
            recentWorkspaces: current.recentWorkspaces.filter(
              (item) => item.path !== entry.path,
            ),
          }
        : {
            ...current,
            recentFiles: current.recentFiles.filter((item) => item.path !== entry.path),
          },
    );
  };

  const exportActiveDocument = useCallback(
    async (format: ExportFormat, allowRemoteImages: boolean) => {
      if (
        exportingRef.current ||
        confirmationPendingRef.current ||
        imageSaveAsPendingRef.current ||
        hasImageReferenceDialog()
      )
        return;
      const state = appStateRef.current;
      const tab = selectActiveTab(state);
      const session = tab ? selectCurrentSession(state, tab.id) : undefined;
      if (
        !session ||
        session.kind !== "markdown" ||
        session.mode === "sourceOnly" ||
        !(format === "html" ? adapter.exportHtml : adapter.exportPdf)
      ) {
        setStatus(t("export.unavailable"));
        return;
      }
      exportingRef.current = true;
      setExporting(true);
      setExportFailure(null);
      setMoreMenuVisible(false);
      setStatus(t("export.busy"));
      // Capture a snapshot, not a save: subsequent edits remain dirty and independent.
      const { text, path } = session;
      const title = fileName(path).replace(/\.(md|markdown)$/iu, "");
      try {
        const { prepareShareableHtml } =
          await import("../../features/export/prepareShareableHtml");
        const { html, images } = await prepareShareableHtml(text, {
          title,
          documentPath: isUntitledPath(path) ? undefined : path,
        });
        const latestState = appStateRef.current;
        // Closed clean sessions are just a cache, not open files. Keep the
        // captured source protected even if its tab closes during export setup.
        const excludedPaths = [
          ...new Set([
            path,
            ...[...referencedDocumentIds(latestState)].map(
              (id) => latestState.sessions[id]?.path,
            ),
          ]),
        ].filter(
          (item): item is string => typeof item === "string" && !isUntitledPath(item),
        );
        const result =
          format === "html"
            ? await adapter.exportHtml!(
                `${title}.html`,
                html,
                excludedPaths,
                images,
                allowRemoteImages,
              )
            : await adapter.exportPdf!(
                `${title}.pdf`,
                html,
                excludedPaths,
                images,
                allowRemoteImages,
              );
        setStatus(
          result
            ? t("export.success", { name: fileName(result.path) })
            : t("export.cancelled"),
        );
      } catch (error) {
        const message =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "htmlExportSourceTooLarge"
            ? t("export.sourceTooLarge")
            : exportErrorMessage(error, locale, readableError(error));
        setExportFailure({ documentId: session.id, error: message });
        setStatus(t("export.failed", { error: message }));
      } finally {
        exportingRef.current = false;
        setExporting(false);
      }
    },
    [adapter, t, locale],
  );

  const removeWorkspace = useCallback(
    (selection: WorkspaceSelection) => {
      closedWorkspaceRestorePathsRef.current.add(selection.path);
      workspaceVisibilityRequestsRef.current.set(
        selection.path,
        (workspaceVisibilityRequestsRef.current.get(selection.path) ?? 0) + 1,
      );
      setWorkspaces((current) =>
        current.filter((item) => item.selection.path !== selection.path),
      );
      setWorkspaceHistory((current) => forgetOpenWorkspace(current, selection.path));
      setStatus(t("status.workspaceClosed", { name: selection.name }));
    },
    [t],
  );

  const newDocument = useCallback(
    (
      kind: "markdown" | "text" = "markdown",
      groupId?: string,
      template?: DocumentTemplate,
    ) => {
      const index = untitledCounter.current++;
      const extension = kind === "markdown" ? "md" : "txt";
      const baseName = locale === "zh-CN" ? `未命名-${index}` : `Untitled-${index}`;
      const name = `${template ? `${template.title}-${index}` : baseName}.${extension}`;
      const path = `untitled://${name}`;
      const tabId = nextTabId();
      commitAction(
        openInNewTab(
          tabId,
          {
            path,
            text: template?.markdown ?? "",
            initialDirty: Boolean(template),
            diskMtimeMs: 0,
            mode: "normal",
            kind,
            language: kind === "markdown" ? "markdown" : "text",
          },
          true,
          createViewState({ editorMode: kind === "markdown" ? "visual" : "source" }),
          groupId,
        ),
      );
      setEditorRevealForTab(tabId, null);
      setStatus(t("status.created", { name }));
      setMoreMenuVisible(false);
    },
    [commitAction, locale, nextTabId, setEditorRevealForTab, t],
  );

  const changeWorkspaceHiddenFiles = async (rootPath: string, showHidden: boolean) => {
    const previous = getWorkspaceShowHidden(workspaceHistoryRef.current, rootPath);
    const request = (workspaceVisibilityRequestsRef.current.get(rootPath) ?? 0) + 1;
    workspaceVisibilityRequestsRef.current.set(rootPath, request);
    const nextHistory = setWorkspaceShowHidden(
      workspaceHistoryRef.current,
      rootPath,
      showHidden,
    );
    workspaceHistoryRef.current = nextHistory;
    setWorkspaceHistory(nextHistory);
    try {
      await refreshWorkspaceFiles(rootPath);
    } catch (error) {
      if (workspaceVisibilityRequestsRef.current.get(rootPath) !== request) return;
      setWorkspaceHistory((current) => setWorkspaceShowHidden(current, rootPath, previous));
      setStatus(t("status.openFailed", { error: readableError(error) }));
    }
  };

  const openSingleFile = useCallback(async () => {
    restoreCancelledRef.current = true;
    setBusy(true);
    try {
      const selection = await adapter.pickDocument();
      if (!selection) {
        setStatus(t("status.workspaceCancelled"));
        return;
      }
      await openDocument(selection.path, "newForeground");
    } catch (error) {
      setStatus(t("status.openFailed", { error: readableError(error) }));
    } finally {
      setBusy(false);
    }
  }, [adapter, openDocument, t]);

  const refreshWorkspaceContaining = useCallback(
    async (path: string) => {
      const owner = workspaces
        .filter((item) => path.startsWith(`${item.selection.path.replace(/\/$/u, "")}/`))
        .sort((left, right) => right.selection.path.length - left.selection.path.length)[0];
      if (!owner) return;
      try {
        await refreshWorkspaceFiles(owner.selection.path);
      } catch {
        // A successful save must not be reported as failed only because the tree refresh did.
      }
    },
    [refreshWorkspaceFiles, workspaces],
  );

  const revealInFileManager = useCallback(
    async (path: string) => {
      try {
        await adapter.revealInFileManager(path);
        setStatus(t("status.revealed", { name: fileName(path) }));
      } catch (error) {
        setStatus(t("status.revealFailed", { error: readableError(error) }));
      }
    },
    [adapter, t],
  );

  const copyPath = useCallback(
    async (path: string) => {
      try {
        await copyText(path);
        setStatus(t("status.pathCopied", { path }));
      } catch (error) {
        setStatus(t("status.pathCopyFailed", { error: readableError(error) }));
      }
    },
    [t],
  );

  const createWorkspaceFile = useCallback(
    async (owner: WorkspaceSelection, directoryPath: string, requestedFileName: string) => {
      setBusy(true);
      try {
        const created = await adapter.createWorkspaceTextFile(
          owner.path,
          directoryPath,
          requestedFileName,
        );
        if (created.status === "blocked") {
          throw new Error(t("status.openFailedUtf8"));
        }
        const document = toOpenDocument(created);
        const tabId = nextTabId();
        dispatch(
          openInNewTab(
            tabId,
            document,
            true,
            createViewState({
              editorMode:
                created.documentKind === "text" || created.mode === "sourceOnly"
                  ? "source"
                  : "visual",
            }),
          ),
        );
        setEditorRevealForTab(tabId, null);
        activateWorkspace(owner.path);
        setWorkspaceHistory((current) =>
          activateRememberedWorkspace(
            rememberFile(current, {
              path: created.path,
              name: fileName(created.path),
            }),
            owner.path,
          ),
        );
        setStatus(t("status.workspaceFileCreated", { name: fileName(created.path) }));
        void refreshWorkspaceFiles(owner.path).catch(() => undefined);
      } catch (error) {
        setStatus(t("status.workspaceFileCreateFailed", { error: readableError(error) }));
        throw error;
      } finally {
        setBusy(false);
      }
    },
    [
      activateWorkspace,
      adapter,
      refreshWorkspaceFiles,
      nextTabId,
      setEditorRevealForTab,
      t,
    ],
  );

  const createWorkspaceFolder = useCallback(
    async (owner: WorkspaceSelection, directoryPath: string, folderName: string) => {
      if (!adapter.createWorkspaceFolder) return;
      setBusy(true);
      try {
        await adapter.createWorkspaceFolder(owner.path, directoryPath, folderName);
        activateWorkspace(owner.path);
        setStatus(t("status.workspaceFolderCreated", { name: folderName }));
        // The folder already exists even if a subsequent tree refresh fails.
        void refreshWorkspaceFiles(owner.path).catch(() => undefined);
      } catch (error) {
        setStatus(t("status.workspaceFolderCreateFailed", { error: readableError(error) }));
        throw error;
      } finally {
        setBusy(false);
      }
    },
    [activateWorkspace, adapter, refreshWorkspaceFiles, t],
  );

  const invalidateScheduledAutoSave = useCallback((documentId: string) => {
    const scheduled = autoSaveTimersRef.current.get(documentId);
    if (scheduled) {
      window.clearTimeout(scheduled.timer);
      autoSaveTimersRef.current.delete(documentId);
    }
    const nextGeneration = (autoSaveGenerationsRef.current.get(documentId) ?? 0) + 1;
    autoSaveGenerationsRef.current.set(documentId, nextGeneration);
  }, []);

  const requestWorkspaceDelete = useCallback(
    (owner: WorkspaceSelection, node: WorkspaceNode) => {
      const state = appStateRef.current;
      const affectedDocumentIds = Object.values(state.sessions)
        .filter((session) => pathIsAtOrBelow(session.path, node.path))
        .map((session) => session.id);
      const dirtyPaths = affectedDocumentIds.flatMap((documentId) => {
        const session = state.sessions[documentId];
        return session?.dirty ? [session.path] : [];
      });
      setPendingWorkspaceDelete({
        owner,
        node,
        affectedDocumentIds,
        dirtyPaths,
      });
    },
    [],
  );

  const cancelWorkspaceDelete = useCallback(() => {
    if (busy) return;
    setPendingWorkspaceDelete(null);
  }, [busy]);

  const confirmWorkspaceDelete = useCallback(async () => {
    const pending = pendingWorkspaceDelete;
    if (!pending || busy) return;
    setBusy(true);
    try {
      await adapter.moveWorkspaceEntryToTrash(pending.owner.path, pending.node.path);
      for (const documentId of pending.affectedDocumentIds) {
        invalidateScheduledAutoSave(documentId);
      }
      if (pending.affectedDocumentIds.length > 0) {
        const action = discardDocuments(pending.affectedDocumentIds);
        appStateRef.current = appStateReducer(appStateRef.current, action);
        dispatch(action);
      }
      setEditorReveals((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([, reveal]) => !pending.affectedDocumentIds.includes(reveal.documentId),
          ),
        ),
      );
      setCodeTargetLines((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([tabId]) =>
            Boolean(appStateRef.current.tabs[tabId]),
          ),
        ),
      );
      setLocalPreview((current) =>
        current?.preview && pathIsAtOrBelow(current.preview.path, pending.node.path)
          ? null
          : current,
      );
      setWorkspaces((current) =>
        current.map((item) =>
          item.selection.path === pending.owner.path
            ? {
                ...item,
                nodes: withoutWorkspaceEntry(item.nodes, pending.node.path),
              }
            : item,
        ),
      );
      try {
        const nodes = await listWorkspaceFiles(pending.owner.path);
        setWorkspaces((current) =>
          current.map((item) =>
            item.selection.path === pending.owner.path ? { ...item, nodes } : item,
          ),
        );
      } catch {
        // The item is already in Trash; keep the local tree update if refresh fails.
      }
      setPendingWorkspaceDelete(null);
      setStatus(t("status.workspaceEntryTrashed", { name: pending.node.name }));
    } catch (error) {
      setPendingWorkspaceDelete(null);
      setStatus(
        t("status.workspaceEntryTrashFailed", {
          name: pending.node.name,
          error: readableError(error),
        }),
      );
    } finally {
      setBusy(false);
    }
  }, [
    adapter,
    busy,
    invalidateScheduledAutoSave,
    listWorkspaceFiles,
    pendingWorkspaceDelete,
    t,
  ]);

  const enqueueDocumentSave = useCallback(function enqueueDocumentSave<T>(
    documentId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const queues = saveQueuesRef.current;
    const previous = queues.get(documentId) ?? Promise.resolve();
    const completed = previous.then(operation);
    const tail = completed.then(
      () => undefined,
      () => undefined,
    );
    queues.set(documentId, tail);
    void tail.then(() => {
      if (queues.get(documentId) === tail) queues.delete(documentId);
    });
    return completed;
  }, []);

  const externalSyncRef = useRef<{
    running: boolean;
    pending: Set<string> | null | undefined;
    disposed: boolean;
  }>({ running: false, pending: undefined, disposed: false });
  useEffect(() => {
    const sync = externalSyncRef.current;
    sync.disposed = false;
    return () => {
      sync.disposed = true;
      sync.pending = undefined;
    };
  }, []);

  const synchronizeFileSystem = useCallback(
    async (paths: readonly string[] | null) => {
      const sync = externalSyncRef.current;
      if (sync.disposed) return;
      sync.pending =
        paths === null || sync.pending === null
          ? null
          : new Set([...(sync.pending ?? []), ...paths]);
      if (sync.running) return;
      sync.running = true;
      try {
        while (sync.pending !== undefined && !sync.disposed) {
          const changed = sync.pending;
          sync.pending = undefined;
          // Only roots affected by an event are relisted; focus/fallback checks use all.
          const affected = workspacesRef.current.filter(
            ({ selection }) =>
              !changed ||
              [...changed].some(
                (path) =>
                  pathIsAtOrBelow(path, selection.path) ||
                  pathIsAtOrBelow(selection.path, path),
              ),
          );
          await Promise.all(
            affected.map(async ({ selection }) => {
              const refresh = refreshWorkspaceFiles(selection.path);
              const request = workspaceVisibilityRequestsRef.current.get(selection.path);
              try {
                await refresh;
              } catch {
                if (
                  sync.disposed ||
                  workspaceVisibilityRequestsRef.current.get(selection.path) !== request ||
                  !workspacesRef.current.some(
                    (item) => item.selection.path === selection.path,
                  )
                )
                  return;
                setWorkspaces((current) =>
                  current.map((item) =>
                    item.selection.path === selection.path ? { ...item, nodes: [] } : item,
                  ),
                );
                setStatus(
                  translateRef.current("external.workspaceUnavailable", {
                    name: selection.name,
                  }),
                );
              }
            }),
          );
          if (sync.disposed) break;
          try {
            await synchronizeDocuments({
              adapter,
              getState: () => appStateRef.current,
              commit: (action) => {
                if (!sync.disposed) commitAction(action);
              },
              isSaving: (id) => sync.disposed || saveQueuesRef.current.has(id),
              onNotice: (session, kind) => {
                if (!sync.disposed)
                  setStatus(
                    translateRef.current(
                      kind === "reloaded"
                        ? "external.reloadedStatus"
                        : "external.changedStatus",
                      { name: fileName(session.path) },
                    ),
                  );
              },
            });
          } catch {
            if (!sync.disposed) setStatus(translateRef.current("external.watchFailed"));
          }
        }
      } finally {
        sync.running = false;
      }
    },
    [adapter, commitAction, refreshWorkspaceFiles],
  );

  useFileSystemChanges({
    adapter,
    workspaceRoots: workspaces.map(({ selection }) => selection.path),
    documentPaths: referencedFilePaths(appState),
    onChange: (paths) => {
      void synchronizeFileSystem(paths);
    },
    onError: () => setStatus(translateRef.current("external.watchFailed")),
  });

  const reportExternalSaveConflict = useCallback(
    (documentId: string, error: unknown) => {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "externalChange"
      )
        return false;
      commitAction(markDocumentExternalChange(documentId, { status: "modified" }));
      setStatus(t("external.changedStatus", { name: fileName(documentId) }));
      void synchronizeFileSystem([]);
      return true;
    },
    [commitAction, synchronizeFileSystem, t],
  );

  const saveActiveDocument = useCallback(
    async (forceSaveAs = false, targetDocumentId?: string) => {
      const currentState = appStateRef.current;
      const tab = selectActiveTab(currentState);
      const session = targetDocumentId
        ? currentState.sessions[targetDocumentId]
        : tab
          ? selectCurrentSession(currentState, tab.id)
          : undefined;
      if (!session) return;

      if (!forceSaveAs && session.externalChange) {
        setStatus(t("external.changedStatus", { name: fileName(session.path) }));
        return;
      }

      const stillOwned = captureDocumentOwnership(currentState, session.id);

      invalidateScheduledAutoSave(session.id);
      setSaveFailure(null);
      setStatus(t("status.saving", { name: fileName(session.path) }));
      try {
        if (forceSaveAs || isUntitledPath(session.path)) {
          const savedText = session.text;
          const saveState = appStateRef.current;
          const referenced = referencedDocumentIds(saveState);
          const excludedPaths = Object.values(saveState.sessions)
            .filter(
              (candidate) =>
                candidate.id !== session.id &&
                referenced.has(candidate.id) &&
                !isUntitledPath(candidate.path),
            )
            .map((candidate) => candidate.path);
          const saveAsResult = await enqueueDocumentSave(session.id, async () => {
            if (!stillOwned(appStateRef.current)) return null;
            const saved = await adapter.saveDocumentAs(
              fileName(session.path),
              savedText,
              excludedPaths,
            );
            if (!saved) return null;
            const latestState = appStateRef.current;
            if (
              saved.path !== session.id &&
              referencedDocumentIds(latestState).has(saved.path)
            ) {
              throw new Error(
                locale === "zh-CN"
                  ? "目标文件已经在另一个标签页中打开"
                  : "The destination is already open in another tab",
              );
            }

            const reopened = await adapter.openDocument(saved.path);
            const relocated: OpenDocument =
              reopened.status === "editable"
                ? { ...toOpenDocument(reopened), diskMtimeMs: Date.now() }
                : {
                    path: saved.path,
                    text: savedText,
                    diskMtimeMs: Date.now(),
                    mode: "sourceOnly",
                    kind: /\.(?:md|markdown)$/iu.test(saved.path) ? "markdown" : "text",
                    language: session.language,
                  };
            return { relocated: { ...relocated, diskRevision: saved.diskRevision }, saved };
          });
          if (!saveAsResult) {
            setStatus(t("status.saveCancelled"));
            return;
          }
          const owned = stillOwned(appStateRef.current);
          if (owned) {
            commitAction(relocateDocument(session.id, saveAsResult.relocated, savedText));
            setFavorites((current) =>
              relocateFavorite(current, session.path, saveAsResult.saved.path),
            );
          }
          setSaveFailure(null);
          setWorkspaceHistory((current) =>
            rememberFile(current, {
              path: saveAsResult.saved.path,
              name: fileName(saveAsResult.saved.path),
            }),
          );
          await refreshWorkspaceContaining(saveAsResult.saved.path);
          setStatus(t("status.saved", { name: fileName(saveAsResult.saved.path) }));
          return owned ? saveAsResult.saved.path : undefined;
        }

        const savedText = session.text;
        await enqueueDocumentSave(session.id, async () => {
          if (!stillOwned(appStateRef.current)) return;
          const latest = appStateRef.current.sessions[session.id];
          if (!latest || latest.externalChange) throw { code: "externalChange" };
          const saved =
            latest.diskRevision === undefined
              ? await adapter.saveDocument(session.path, savedText)
              : await adapter.saveDocument(session.path, savedText, latest.diskRevision);
          if (stillOwned(appStateRef.current))
            commitAction(
              markDocumentSaved(session.id, savedText, Date.now(), saved.diskRevision),
            );
        });
        setSaveFailure(null);
        setStatus(t("status.saved", { name: fileName(session.path) }));
      } catch (error) {
        if (!stillOwned(appStateRef.current)) return;
        if (reportExternalSaveConflict(session.id, error)) return;
        setSaveFailure({ documentId: session.id, error: readableError(error) });
        setStatus(t("status.saveFailed", { error: readableError(error) }));
      }
    },
    [
      adapter,
      commitAction,
      enqueueDocumentSave,
      invalidateScheduledAutoSave,
      locale,
      refreshWorkspaceContaining,
      reportExternalSaveConflict,
      t,
    ],
  );

  const autoSaveDocument = useCallback(
    async (documentId: string, expectedText: string, generation: number) => {
      const stillOwned = captureDocumentOwnership(appStateRef.current, documentId);
      const session = appStateRef.current.sessions[documentId];
      if (
        !session?.dirty ||
        !stillOwned(appStateRef.current) ||
        session.externalChange ||
        isUntitledPath(session.path) ||
        session.text !== expectedText ||
        autoSaveGenerationsRef.current.get(documentId) !== generation
      ) {
        return;
      }
      try {
        const saved = await enqueueDocumentSave(documentId, async () => {
          const latest = appStateRef.current.sessions[documentId];
          if (
            !latest?.dirty ||
            !stillOwned(appStateRef.current) ||
            latest.externalChange ||
            isUntitledPath(latest.path) ||
            latest.text !== expectedText ||
            autoSaveGenerationsRef.current.get(documentId) !== generation
          ) {
            return false;
          }
          const result =
            latest.diskRevision === undefined
              ? await adapter.saveDocument(latest.path, expectedText)
              : await adapter.saveDocument(latest.path, expectedText, latest.diskRevision);
          if (stillOwned(appStateRef.current))
            commitAction(
              markDocumentSaved(session.id, expectedText, Date.now(), result.diskRevision),
            );
          return true;
        });
        if (!saved) return;
        if (autoSaveGenerationsRef.current.get(documentId) !== generation) return;
        setSaveFailure((current) => (current?.documentId === documentId ? null : current));
        setStatus(t("status.autoSaved", { name: fileName(session.path) }));
      } catch (error) {
        if (!stillOwned(appStateRef.current)) return;
        if (reportExternalSaveConflict(documentId, error)) return;
        if (autoSaveGenerationsRef.current.get(documentId) !== generation) return;
        setSaveFailure({ documentId, error: readableError(error) });
        setStatus(t("status.saveFailed", { error: readableError(error) }));
      }
    },
    [adapter, commitAction, enqueueDocumentSave, reportExternalSaveConflict, t],
  );

  const resolveExternalChange = useCallback(
    async (documentId: string, overwrite: boolean) => {
      const stillOwned = captureDocumentOwnership(appStateRef.current, documentId);
      const session = appStateRef.current.sessions[documentId];
      if (
        !session?.externalChange ||
        !referencedDocumentIds(appStateRef.current).has(documentId)
      )
        return;
      invalidateScheduledAutoSave(documentId);
      try {
        if (overwrite) {
          const revision = session.externalChange.revision;
          if (!revision || session.externalChange.status !== "modified") return;
          await enqueueDocumentSave(documentId, async () => {
            if (!stillOwned(appStateRef.current)) return;
            const latest = appStateRef.current.sessions[documentId];
            if (
              !latest ||
              latest.text !== session.text ||
              latest.externalChange?.revision !== revision
            ) {
              setStatus(t("external.retry"));
              return;
            }
            const saved = await adapter.saveDocument(session.path, session.text, revision);
            if (stillOwned(appStateRef.current))
              commitAction(
                markDocumentSaved(documentId, session.text, Date.now(), saved.diskRevision),
              );
            setSaveFailure(null);
            setStatus(t("status.saved", { name: fileName(session.path) }));
          });
          return;
        }
        // Capture the consented buffer before awaiting I/O; later edits win.
        const result = await adapter.openDocument(session.path);
        const latest = appStateRef.current.sessions[documentId];
        if (
          !latest ||
          !stillOwned(appStateRef.current) ||
          latest.text !== session.text ||
          latest.diskRevision !== session.diskRevision ||
          saveQueuesRef.current.has(documentId)
        ) {
          setStatus(t("external.retry"));
          return;
        }
        if (result.status !== "editable") {
          commitAction(
            markDocumentExternalChange(documentId, {
              status: "blocked",
              revision: session.externalChange.revision,
            }),
          );
          return;
        }
        commitAction(
          reloadDocument(
            documentId,
            toOpenDocument(result),
            session.text,
            session.diskRevision,
            true,
          ),
        );
        setSaveFailure(null);
        setStatus(t("external.reloadedStatus", { name: fileName(session.path) }));
      } catch (error) {
        if (!stillOwned(appStateRef.current)) return;
        if (reportExternalSaveConflict(documentId, error)) return;
        setSaveFailure({ documentId, error: readableError(error) });
        setStatus(t("external.retry"));
        void synchronizeFileSystem([]);
      }
    },
    [
      adapter,
      commitAction,
      enqueueDocumentSave,
      invalidateScheduledAutoSave,
      reportExternalSaveConflict,
      synchronizeFileSystem,
      t,
    ],
  );

  useEffect(() => {
    const timers = autoSaveTimersRef.current;
    if (settings.autoSaveMode !== "afterDelay") {
      const documentIds = new Set([
        ...timers.keys(),
        ...autoSaveGenerationsRef.current.keys(),
      ]);
      for (const documentId of documentIds) invalidateScheduledAutoSave(documentId);
      return;
    }

    const referenced = referencedDocumentIds(appState);
    const eligible = new Set<string>();
    const delayMs = settings.autoSaveDelaySeconds * 1000;
    for (const documentId of referenced) {
      const session = appState.sessions[documentId];
      if (!session?.dirty || session.externalChange || isUntitledPath(session.path))
        continue;
      eligible.add(documentId);
      const existing = timers.get(documentId);
      if (existing?.text === session.text && existing.delayMs === delayMs) continue;
      if (existing) window.clearTimeout(existing.timer);
      const text = session.text;
      const generation = (autoSaveGenerationsRef.current.get(documentId) ?? 0) + 1;
      autoSaveGenerationsRef.current.set(documentId, generation);
      const timer = window.setTimeout(() => {
        void autoSaveDocument(documentId, text, generation).finally(() => {
          if (timers.get(documentId)?.generation === generation) {
            timers.delete(documentId);
          }
        });
      }, delayMs);
      timers.set(documentId, { delayMs, generation, text, timer });
    }

    for (const [documentId] of timers) {
      if (eligible.has(documentId)) continue;
      invalidateScheduledAutoSave(documentId);
    }
  }, [
    appState,
    autoSaveDocument,
    invalidateScheduledAutoSave,
    settings.autoSaveDelaySeconds,
    settings.autoSaveMode,
  ]);

  useEffect(
    () => () => {
      const documentIds = new Set([
        ...autoSaveTimersRef.current.keys(),
        ...autoSaveGenerationsRef.current.keys(),
      ]);
      for (const documentId of documentIds) {
        invalidateScheduledAutoSave(documentId);
      }
      autoSaveTimersRef.current.clear();
    },
    [invalidateScheduledAutoSave],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (
        confirmationPendingRef.current ||
        imageSaveAsPendingRef.current ||
        hasImageReferenceDialog()
      ) {
        if (
          (event.metaKey || event.ctrlKey) &&
          ["s", "n", "o", "k", "f", ",", "/", "w", "q"].includes(event.key.toLowerCase())
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (event.key === "Escape") {
        if (
          event.target instanceof Element &&
          event.target.closest(".export-menu__submenu")
        )
          return;
        if (
          focusMode &&
          !document.querySelector('[aria-modal="true"], .page-find, [role="menu"]') &&
          !quickOpenVisible &&
          !localPreview
        )
          setFocusMode(false);
        setQuickOpenVisible(false);
        setMoreMenuVisible(false);
        setWorkspaceMenuVisible(false);
        closeLocalPreview();
      }
      // Dialogs own their keyboard, including shortcut recording fields.
      if (document.querySelector('[aria-modal="true"]') || quickOpenVisible) return;
      if (matchesShortcut(event, "Mod+Shift+Enter")) {
        event.preventDefault();
        setFocusMode((current) => !current);
        setMoreMenuVisible(false);
        setWorkspaceMenuVisible(false);
        closeContextMenu();
        return;
      }
      if (!hasPlatformModifier(event) || event.altKey) return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        if (!settingsVisible && !quickOpenVisible && !visual) {
          if (event.shiftKey) showWorkspaceSearch();
          else findInActivePage();
        }
        return;
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveActiveDocument(event.shiftKey);
      }
      if (!event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        newDocument("markdown");
      }
      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        if (event.shiftKey) void openWorkspace();
        else void openSingleFile();
      }
      if (!event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (workspaces.length > 0) setQuickOpenVisible(true);
        else void openWorkspace();
      }
      if (!event.shiftKey && event.key === ",") {
        event.preventDefault();
        setSettingsVisible(true);
      }
      if (!event.shiftKey && event.key === "/" && activeTab) {
        event.preventDefault();
        event.stopPropagation();
        const currentState = appStateRef.current;
        const tab = selectActiveTab(currentState);
        const session = tab ? selectCurrentSession(currentState, tab.id) : undefined;
        if (!tab || session?.mode === "sourceOnly" || session?.kind === "text") return;
        const nextMode = tab.current.view.editorMode === "visual" ? "source" : "visual";
        dispatch(
          updateView(
            tab.id,
            createViewState({ ...tab.current.view, editorMode: nextMode }),
          ),
        );
        setStatus(
          nextMode === "visual" ? t("status.switchedVisual") : t("status.switchedSource"),
        );
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [
    activeTab,
    focusMode,
    localPreview,
    closeContextMenu,
    closeLocalPreview,
    findInActivePage,
    showWorkspaceSearch,
    settingsVisible,
    quickOpenVisible,
    visual,
    newDocument,
    openSingleFile,
    openWorkspace,
    saveActiveDocument,
    t,
    workspaces.length,
  ]);

  const switchEditorMode = useCallback(
    (nextMode: "visual" | "source") => {
      const currentState = appStateRef.current;
      const tab = selectActiveTab(currentState);
      const session = tab ? selectCurrentSession(currentState, tab.id) : undefined;
      if (
        !tab ||
        !session ||
        session.kind === "text" ||
        (session.mode === "sourceOnly" && nextMode === "visual")
      ) {
        return;
      }
      dispatch(
        updateView(tab.id, createViewState({ ...tab.current.view, editorMode: nextMode })),
      );
      setStatus(
        nextMode === "visual" ? t("status.switchedVisual") : t("status.switchedSource"),
      );
    },
    [t],
  );

  useEffect(() => {
    if (!adapter.listenNativeMenuAction) return undefined;
    let disposed = false;
    let dispose: (() => void) | undefined;
    void adapter
      .listenNativeMenuAction((actionId) => {
        if (
          confirmationPendingRef.current ||
          imageSaveAsPendingRef.current ||
          hasImageReferenceDialog() ||
          document.querySelector('[aria-modal="true"]')
        )
          return;
        switch (actionId) {
          case "file.new":
            newDocument("markdown");
            break;
          case "file.open":
            void openSingleFile();
            break;
          case "workspace.open":
            void openWorkspace();
            break;
          case "file.save":
            void saveActiveDocument();
            break;
          case "file.saveAs":
            void saveActiveDocument(true);
            break;
          case "file.exportHtml":
            setExportFormat("html");
            break;
          case "file.exportPdf":
            if (getPlatform() === "mac") setExportFormat("pdf");
            break;
          case "file.newTemplate":
            setTemplateVisible(true);
            break;
          case "view.toggleFocus":
            setFocusMode((current) => !current);
            break;
          case "edit.findWorkspace":
            showWorkspaceSearch();
            break;
          case "file.reveal": {
            const state = appStateRef.current;
            const tab = selectActiveTab(state);
            const session = tab ? selectCurrentSession(state, tab.id) : undefined;
            if (session && !isUntitledPath(session.path)) {
              void revealInFileManager(session.path);
            } else {
              setStatus(t("status.revealUnavailable"));
            }
            break;
          }
          case "app.settings":
            setSettingsVisible(true);
            break;
          case "view.toggleSource": {
            const state = appStateRef.current;
            const tab = selectActiveTab(state);
            if (!tab) break;
            switchEditorMode(
              tab.current.view.editorMode === "visual" ? "source" : "visual",
            );
            break;
          }
          case "view.toggleSidebar":
            setSidebarCollapsed((collapsed) => !collapsed);
            break;
          case "window.close":
          case "app.quit":
            requestNativeWindowClose();
            break;
          case "help.open":
            openHelp();
            break;
          case "app.about":
            openAbout();
            break;
          case "edit.find":
            findInActivePage();
            break;
        }
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else dispose = unlisten;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      dispose?.();
    };
  }, [
    adapter,
    showWorkspaceSearch,
    findInActivePage,
    newDocument,
    openSingleFile,
    openWorkspace,
    requestNativeWindowClose,
    openAbout,
    openHelp,
    revealInFileManager,
    saveActiveDocument,
    switchEditorMode,
    t,
  ]);

  const commitTabClose = useCallback(
    (tabId: string) => {
      const state = appStateRef.current;
      setEditorRevealForTab(tabId, null);
      closeLocalPreview();
      if (state.tabOrder.length === 1) {
        setStatus(t("status.ready"));
      }
      commitAction(closeTabAction(tabId));
    },
    [closeLocalPreview, commitAction, setEditorRevealForTab, t],
  );

  const closeTab = useCallback(
    (tab: Tab) => {
      const state = appStateRef.current;
      const currentTab = state.tabs[tab.id] ?? tab;
      const dirtyDocumentIds = tabDirtyDocumentIds(state, currentTab).filter(
        (documentId) =>
          !state.tabOrder.some((tabId) => {
            const otherTab = state.tabs[tabId];
            if (tabId === currentTab.id || !otherTab) return false;
            return tabReferencesDocument(otherTab, documentId);
          }),
      );
      if (dirtyDocumentIds.length > 0) {
        setPendingCloseRequest({
          kind: "tab",
          tabId: currentTab.id,
          dirtyPaths: dirtyDocumentIds.flatMap((documentId) => {
            const session = state.sessions[documentId];
            return session ? [session.path] : [];
          }),
        });
        return;
      }
      commitTabClose(currentTab.id);
    },
    [commitTabClose],
  );

  const cancelPendingClose = useCallback(() => {
    setPendingCloseRequest(null);
  }, []);

  const confirmPendingClose = useCallback(() => {
    const request = pendingCloseRequest;
    if (!request) return;
    setPendingCloseRequest(null);
    if (request.kind === "window") {
      destroyNativeWindow();
      return;
    }
    commitTabClose(request.tabId);
  }, [commitTabClose, destroyNativeWindow, pendingCloseRequest]);

  const loadLocalPreview = async (
    reference: string,
    left: number,
    top: number,
    documentPath = activeSession?.path,
    sourceGroupId = appStateRef.current.activeEditorGroupId,
  ) => {
    if (!documentPath) return;
    const requestId = ++localPreviewRequestRef.current;
    setLocalPreview({ reference, sourceGroupId, left, top, loading: true });
    try {
      const preview = await adapter.previewLocalFile(reference, documentPath);
      if (localPreviewRequestRef.current !== requestId) return;
      setLocalPreview({ reference, sourceGroupId, left, top, loading: false, preview });
    } catch (error) {
      if (localPreviewRequestRef.current !== requestId) return;
      setLocalPreview({
        reference,
        sourceGroupId,
        left,
        top,
        loading: false,
        error: readableError(error),
      });
    }
  };

  const rightOpenGuard = (sourceGroupId: string) => {
    const initial = appStateRef.current;
    const sourceIndex = initial.editorGroups.findIndex(
      (group) => group.id === sourceGroupId,
    );
    const sourceTabId = initial.editorGroups[sourceIndex]?.activeTabId;
    const sourcePath = sourceTabId ? initial.tabs[sourceTabId]?.current.path : undefined;
    const destination =
      initial.editorGroups[sourceIndex + 1] ??
      (initial.editorGroups.length > 1 ? initial.editorGroups.at(-1) : undefined);
    const groupOrder = initial.editorGroups.map((group) => group.id).join("|");
    const openVersion = destination
      ? documentOpenRequestsRef.current.get(destination.id)
      : undefined;
    return () => {
      const current = appStateRef.current;
      return (
        !nativeCloseCommittedRef.current &&
        current.editorGroups.map((group) => group.id).join("|") === groupOrder &&
        current.editorGroups[sourceIndex]?.activeTabId === sourceTabId &&
        (!sourceTabId || current.tabs[sourceTabId]?.current.path === sourcePath) &&
        (!destination ||
          (current.editorGroups.find((group) => group.id === destination.id)
            ?.activeTabId === destination.activeTabId &&
            documentOpenRequestsRef.current.get(destination.id) === openVersion))
      );
    };
  };

  const showCodeInRightGroup = async (
    preview: LocalFilePreview,
    requestId: number,
    sourceGroupId: string,
    requestIsCurrent: () => boolean,
  ) => {
    if (!requestIsCurrent()) return;
    const result = await adapter.openDocument(preview.path);
    if (sidePreviewRequestRef.current !== requestId || !requestIsCurrent()) return;
    if (result.status !== "editable") {
      setStatus(t("status.openFailed", { error: t("preview.unavailable") }));
      return;
    }
    const next = commitAction({
      type: "editor-group/open-right",
      sourceGroupId,
      newGroupId: `editor-group-${groupCounter.current++}`,
      tabId: nextTabId(),
      document: toOpenDocument(result),
      focus: appStateRef.current.activeEditorGroupId === sourceGroupId,
    });
    const rightIndex = Math.min(
      next.editorGroups.findIndex((group) => group.id === sourceGroupId) + 1,
      next.editorGroups.length - 1,
    );
    const tabId = next.editorGroups[rightIndex]?.activeTabId;
    if (tabId)
      setCodeTargetLines((current) => {
        const updated = { ...current };
        if (preview.targetLine) updated[tabId] = preview.targetLine;
        else delete updated[tabId];
        return updated;
      });
    setWorkspaceHistory((current) =>
      rememberFile(current, { path: result.path, name: fileName(result.path) }, Date.now()),
    );
    closeLocalPreview();
    setStatus(t("status.previewOpenedRight", { name: fileName(preview.path) }));
  };

  const openLocalPreviewOnRight = async (preview: LocalFilePreview) => {
    const sourceGroupId =
      localPreview?.sourceGroupId ?? appStateRef.current.activeEditorGroupId;
    const requestId = ++sidePreviewRequestRef.current;
    const requestIsCurrent = rightOpenGuard(sourceGroupId);
    setBusy(true);
    try {
      await showCodeInRightGroup(preview, requestId, sourceGroupId, requestIsCurrent);
    } catch (error) {
      if (sidePreviewRequestRef.current === requestId && requestIsCurrent())
        setStatus(t("status.openFailed", { error: readableError(error) }));
    } finally {
      if (sidePreviewRequestRef.current === requestId) setBusy(false);
    }
  };

  const openLocalReferenceOnRight = async (
    reference: string,
    documentPath = activeSession?.path,
    sourceGroupId = appStateRef.current.activeEditorGroupId,
  ) => {
    if (!documentPath) return;
    const requestId = ++sidePreviewRequestRef.current;
    const requestIsCurrent = rightOpenGuard(sourceGroupId);
    setBusy(true);
    closeLocalPreview();
    try {
      const preview = await adapter.previewLocalFile(reference, documentPath);
      if (sidePreviewRequestRef.current !== requestId) return;
      await showCodeInRightGroup(preview, requestId, sourceGroupId, requestIsCurrent);
    } catch (error) {
      if (sidePreviewRequestRef.current === requestId && requestIsCurrent())
        setStatus(t("status.openFailed", { error: readableError(error) }));
    } finally {
      if (sidePreviewRequestRef.current === requestId) setBusy(false);
    }
  };

  useEffect(
    () => () => {
      clearLocalPreviewTimer();
      localPreviewRequestRef.current += 1;
    },
    [clearLocalPreviewTimer],
  );

  const localReferenceAtEvent = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : null;
    const code = element?.closest<HTMLElement>(".ProseMirror code");
    if (!code || code.closest(".milkdown-code-block")) return null;
    const tabId = code.closest<HTMLElement>("[data-tab-id]")?.dataset.tabId;
    const documentPath = tabId ? appStateRef.current.tabs[tabId]?.current.path : undefined;
    if (!documentPath) return null;
    const sourceGroupId = tabId ? selectTabGroupId(appStateRef.current, tabId) : undefined;
    const image = imageReferenceFromLink(documentPath, code.textContent ?? "");
    if (image) return { code, image, reference: null, documentPath, sourceGroupId };
    const reference = localFileReferenceFromText(code.textContent ?? "");
    return reference ? { code, image: null, reference, documentPath, sourceGroupId } : null;
  };

  const handleEditorPointerOver = (event: ReactPointerEvent<HTMLElement>) => {
    const match = localReferenceAtEvent(event.target);
    if (!match?.reference) return;
    clearLocalPreviewTimer();
    const bounds = match.code.getBoundingClientRect();
    localPreviewTimerRef.current = window.setTimeout(() => {
      void loadLocalPreview(
        match.reference.reference,
        bounds.left,
        bounds.bottom + 8,
        match.documentPath,
        match.sourceGroupId,
      );
    }, 320);
  };

  const handleEditorPointerOut = (event: ReactPointerEvent<HTMLElement>) => {
    const match = localReferenceAtEvent(event.target);
    if (!match) return;
    const related = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (related?.closest(".local-file-preview-popover")) return;
    clearLocalPreviewTimer();
    localPreviewTimerRef.current = window.setTimeout(closeLocalPreview, 180);
  };

  const handleEditorClick = (event: ReactMouseEvent<HTMLElement>) => {
    const match = localReferenceAtEvent(event.target);
    if (!match) return;
    event.preventDefault();
    const bounds = match.code.getBoundingClientRect();
    clearLocalPreviewTimer();
    if (match.image) {
      closeLocalPreview();
      setVisual(match.image);
      return;
    }
    if (appStateRef.current.editorGroups.length > 1) {
      void openLocalReferenceOnRight(
        match.reference.reference,
        match.documentPath,
        match.sourceGroupId,
      );
      return;
    }
    void loadLocalPreview(
      match.reference.reference,
      bounds.left,
      bounds.bottom + 8,
      match.documentPath,
      match.sourceGroupId,
    );
  };

  const handleInternalLink = (
    target: string,
    disposition: LinkDisposition,
    sourceTabId?: string,
  ) => {
    const sourceTab = sourceTabId
      ? appStateRef.current.tabs[sourceTabId]
      : selectActiveTab(appStateRef.current);
    const session = sourceTab
      ? selectCurrentSession(appStateRef.current, sourceTab.id)
      : undefined;
    if (!session) return;
    const image = imageReferenceFromLink(session.path, target);
    if (image) {
      closeLocalPreview();
      setVisual(image);
      return;
    }
    const owningWorkspace = workspaces
      .filter(
        (item) =>
          session.path === item.selection.path ||
          session.path.startsWith(`${item.selection.path.replace(/\/$/u, "")}/`),
      )
      .sort((left, right) => right.selection.path.length - left.selection.path.length)[0];
    const resolved = resolveWorkspaceLink(session.path, target, [
      ...(owningWorkspace?.nodes ?? []),
      ...workspaces
        .filter((item) => item !== owningWorkspace)
        .flatMap((item) => item.nodes),
    ]);
    if (resolved.kind === "internal") {
      void openDocument(resolved.path, disposition, resolved.anchor, undefined, {
        sourceTabId: sourceTab?.id,
        markdownLink: true,
      });
    } else if (resolved.kind === "external") {
      void (async () => {
        try {
          if (/^https?:/iu.test(resolved.href) && adapter.openExternalUrl) {
            await adapter.openExternalUrl(resolved.href);
          } else {
            window.open(resolved.href, "_blank", "noopener,noreferrer");
          }
          setStatus(t("status.externalOpened"));
        } catch (error) {
          setStatus(t("status.externalOpenFailed", { error: readableError(error) }));
        }
      })();
    } else {
      const localReference = localFileReferenceFromText(target);
      if (localReference) {
        if (appStateRef.current.editorGroups.length > 1) {
          void openLocalReferenceOnRight(
            localReference.reference,
            session.path,
            sourceTab ? selectTabGroupId(appStateRef.current, sourceTab.id) : undefined,
          );
        } else {
          void loadLocalPreview(
            localReference.reference,
            Math.max(24, window.innerWidth / 2 - 320),
            Math.max(90, window.innerHeight / 3),
            session.path,
            sourceTab ? selectTabGroupId(appStateRef.current, sourceTab.id) : undefined,
          );
        }
      } else {
        setStatus(t("status.linkNotFound", { target }));
      }
    }
  };

  const pasteClipboardImage = useCallback(
    async (
      tabId: string,
      selection: { readonly from: number; readonly to: number },
      kind: ClipboardImagePasteKind = "image",
    ): Promise<string> => {
      const state = appStateRef.current;
      const tab = state.tabs[tabId];
      const session = tab ? selectCurrentSession(state, tab.id) : undefined;
      if (!tab || !session || session.kind !== "markdown" || imageSaveAsPendingRef.current)
        return "";

      setImagePasteFailure(null);
      const request = ++imagePasteCounterRef.current;
      imagePasteRequestsRef.current.set(tabId, request);
      const originalText = session.text;
      const originalMode = tab.current.view.editorMode;
      let documentPath = session.path;
      const needsSaveAs = isUntitledPath(documentPath);
      const stillCurrent = () => {
        const latest = appStateRef.current;
        const latestTab = latest.tabs[tabId];
        const latestSession = latest.sessions[documentPath];
        return (
          imagePasteMountedRef.current &&
          imagePasteRequestsRef.current.get(tabId) === request &&
          !nativeCloseCommittedRef.current &&
          latestTab?.current.documentId === documentPath &&
          latestTab.current.view.editorMode === originalMode &&
          latestSession?.kind === "markdown" &&
          latestSession.text === originalText &&
          !latestSession.externalChange
        );
      };

      try {
        if (needsSaveAs) {
          imageSaveAsPendingRef.current = true;
          let savedPath: string | undefined;
          try {
            if (adapter.hasClipboardImage && !(await adapter.hasClipboardImage())) {
              if (kind === "native-fallback") return "";
              throw { code: "clipboardNoImage" };
            }
            if (!stillCurrent()) return "";
            savedPath = await saveActiveDocument(false, session.id);
          } finally {
            imageSaveAsPendingRef.current = false;
          }
          if (!savedPath) return "";
          documentPath = savedPath;
        }
        if (!stillCurrent()) return "";
        const owner = workspacesRef.current
          .filter((item) => pathIsAtOrBelow(documentPath, item.selection.path))
          .sort(
            (left, right) => right.selection.path.length - left.selection.path.length,
          )[0];
        const directoryPath = owner
          ? getWorkspaceImageDirectory(workspaceHistoryRef.current, owner.selection.path)
          : null;
        const saved = directoryPath
          ? await adapter.saveClipboardImage(documentPath, directoryPath)
          : await adapter.saveClipboardImage(documentPath);
        if (!stillCurrent()) return "";
        const markdown = `![](${saved.markdownUri})`;
        setStatus(t("status.screenshotSaved", { path: saved.path }));
        if (needsSaveAs) {
          // Save As remounts the editor with its new path. Let that surface apply
          // the insertion as a normal undoable transaction, never edit raw text here.
          setImageInsertRequests((current) => ({
            ...current,
            [tabId]: {
              id: request,
              documentId: documentPath,
              markdown,
              expectedText: originalText,
              editorMode: originalMode,
              selection,
            },
          }));
          return "";
        }
        return markdown;
      } catch (error) {
        if (
          kind === "native-fallback" &&
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "clipboardNoImage"
        )
          return "";
        if (!stillCurrent()) return "";
        const message = clipboardImageError(error, t);
        // The original untitled surface no longer exists after Save As.
        if (needsSaveAs) {
          setImagePasteFailure({ tabId, documentId: documentPath, error: message });
          return "";
        }
        throw new Error(message);
      }
    },
    [adapter, saveActiveDocument, t],
  );

  const activeSaveFailure =
    activeSession && saveFailure?.documentId === activeSession.id
      ? t("status.saveFailed", { error: saveFailure.error })
      : null;
  const activeImagePasteFailure =
    imagePasteFailure &&
    activeTab?.id === imagePasteFailure.tabId &&
    activeSession?.id === imagePasteFailure.documentId
      ? t("status.imageSaveFailed", { error: imagePasteFailure.error })
      : null;
  const activeExportFailure =
    activeSession && exportFailure?.documentId === activeSession.id
      ? t("export.failed", { error: exportFailure.error })
      : null;
  const activeStatusFailure =
    activeSaveFailure ?? activeImagePasteFailure ?? activeExportFailure;

  const navigateHistory = (direction: "back" | "forward") => {
    const state = appStateRef.current;
    const destination = selectNavigationDestination(state, direction);
    if (!destination) return;
    // Back/forward is a window-level action. No older read in any split may
    // overwrite the restored visit after this point.
    for (const { id: groupId } of state.editorGroups) {
      documentOpenRequestsRef.current.set(
        groupId,
        (documentOpenRequestsRef.current.get(groupId) ?? 0) + 1,
      );
    }
    setCodeTargetLines((current) => {
      if (!current[destination.tabId]) return current;
      const next = { ...current };
      delete next[destination.tabId];
      return next;
    });
    setEditorRevealForTab(destination.tabId, {
      documentId: destination.entry.documentId,
      position:
        destination.entry.view.editorMode === "visual"
          ? destination.entry.view.visualSelectionFrom
          : destination.entry.view.selectionFrom,
      requestId: revealCounter.current++,
      scrollTop:
        destination.entry.view.editorMode === "visual"
          ? destination.entry.view.visualScrollTop
          : destination.entry.view.sourceScrollTop,
    });
    commitAction(
      direction === "back"
        ? goNavigationBack(selectActiveTab(state)?.current.view)
        : goNavigationForward(selectActiveTab(state)?.current.view),
    );
    setStatus(t("status.restored", { name: fileName(destination.entry.path) }));
  };

  const recordEditorView = (
    tabId: string,
    documentId: string,
    mode: "visual" | "source",
    view: { scrollTop: number; selectionFrom: number; selectionTo: number },
  ) => {
    const tab = appStateRef.current.tabs[tabId];
    if (!tab || tab.current.documentId !== documentId) return;
    const previous = tab.current.view;
    const next = createViewState({
      ...previous,
      ...(mode === "visual"
        ? {
            visualScrollTop: view.scrollTop,
            visualSelectionFrom: view.selectionFrom,
            visualSelectionTo: view.selectionTo,
          }
        : {
            sourceScrollTop: view.scrollTop,
            selectionFrom: view.selectionFrom,
            selectionTo: view.selectionTo,
          }),
    });
    if (
      previous.sourceScrollTop !== next.sourceScrollTop ||
      previous.visualScrollTop !== next.visualScrollTop ||
      previous.selectionFrom !== next.selectionFrom ||
      previous.selectionTo !== next.selectionTo ||
      previous.visualSelectionFrom !== next.visualSelectionFrom ||
      previous.visualSelectionTo !== next.visualSelectionTo
    )
      commitAction(updateView(tabId, next));
  };

  const renderTabEditor = (tab: Tab, focused: boolean) => {
    const session = appState.sessions[tab.current.documentId];
    if (!session) return null;
    const withExternalNotice = (editor: React.ReactNode) => (
      <div className="external-document-view">
        {session.externalChange && (
          <ExternalChangeBanner
            key={`${session.id}:${session.externalChange.status}:${session.externalChange.revision}`}
            session={session}
            onReload={() => resolveExternalChange(session.id, false)}
            onOverwrite={() => resolveExternalChange(session.id, true)}
            onSaveAs={() => void saveActiveDocument(true, session.id)}
          />
        )}
        {editor}
      </div>
    );
    const mode = session.mode === "sourceOnly" ? "source" : tab.current.view.editorMode;
    const initialView = {
      scrollTop:
        mode === "visual"
          ? tab.current.view.visualScrollTop
          : tab.current.view.sourceScrollTop,
      selectionFrom:
        mode === "visual"
          ? tab.current.view.visualSelectionFrom
          : tab.current.view.selectionFrom,
      selectionTo:
        mode === "visual"
          ? tab.current.view.visualSelectionTo
          : tab.current.view.selectionTo,
    };
    if (session.kind === "text") {
      return withExternalNotice(
        <div className="code-document-view">
          <CodeFilePreview
            findRequest={findRequests[tab.id]}
            onFindRequestConsumed={(request) => consumeFindRequest(tab.id, request)}
            codeWrap={settings.codeWrap}
            content={session.text}
            editable
            initialView={{
              scrollTop: tab.current.view.sourceScrollTop,
              selectionFrom: tab.current.view.selectionFrom,
              selectionTo: tab.current.view.selectionTo,
            }}
            instanceId={tab.id}
            language={session.language}
            locale={locale}
            onChange={(text) => editSessionDocument(session.id, text)}
            onViewChange={(view) => recordEditorView(tab.id, session.id, "source", view)}
            path={session.path}
            showLineNumbers={settings.showCodeLineNumbers}
            targetLine={codeTargetLines[tab.id]}
            variant="tab"
          />
        </div>,
      );
    }
    return withExternalNotice(
      <Suspense fallback={<div className="editor-loading">{t("editor.loading")}</div>}>
        <MarkdownEditor
          findRequest={findRequests[tab.id]}
          onFindRequestConsumed={(request) => consumeFindRequest(tab.id, request)}
          autofocus={focused}
          codeWrap={settings.codeWrap}
          documentId={session.id}
          initialView={initialView}
          instanceId={tab.id}
          mode={session.mode}
          locale={settings.locale}
          presentationMode={mode}
          showCodeLineNumbers={settings.showCodeLineNumbers}
          showTypingHints={settings.showTypingHints}
          onChange={(text) => editSessionDocument(session.id, text)}
          onImagePaste={(selection, kind) => pasteClipboardImage(tab.id, selection, kind)}
          imageInsertRequest={
            imageInsertRequests[tab.id]?.documentId === session.id &&
            imageInsertRequests[tab.id]?.editorMode === mode
              ? imageInsertRequests[tab.id]
              : undefined
          }
          onImageInsertConsumed={(id) =>
            setImageInsertRequests((current) => {
              if (current[tab.id]?.id !== id) return current;
              const next = { ...current };
              delete next[tab.id];
              return next;
            })
          }
          onInternalLink={(target, disposition) =>
            handleInternalLink(target, disposition, tab.id)
          }
          onPasteError={(message) =>
            setImagePasteFailure({
              tabId: tab.id,
              documentId: session.id,
              error: message,
            })
          }
          onPasteRejected={setStatus}
          onOpenVisual={setVisual}
          onViewChange={(view) => recordEditorView(tab.id, session.id, mode, view)}
          onRevealConsumed={(requestId) =>
            setEditorReveals((current) => {
              const pending = current[tab.id];
              if (!pending || pending.requestId !== requestId) return current;
              const next = { ...current };
              delete next[tab.id];
              return next;
            })
          }
          reveal={
            editorReveals[tab.id]?.documentId === session.id
              ? editorReveals[tab.id]
              : undefined
          }
          value={session.text}
        />
      </Suspense>,
    );
  };

  return (
    <div
      className={`app-shell${sidebarCollapsed ? " app-shell--sidebar-collapsed" : ""}${focusMode ? " app-shell--focus" : ""}`}
      onContextMenu={onContextMenu}
      onPointerDownCapture={onPointerDownCapture}
    >
      {focusMode && (
        <button
          className="focus-mode-exit"
          type="button"
          onClick={() => setFocusMode(false)}
          title={`${exitFocusLabel} · ${formatShortcut("Mod+Shift+Enter")}`}
        >
          {exitFocusLabel} <kbd>Esc</kbd>
        </button>
      )}
      <header className="shell-toolbar" data-native-context-menu="true">
        <div className="shell-toolbar__cluster" aria-label={t("toolbar.navigation")}>
          <button
            aria-label={t("toolbar.back")}
            className="icon-button"
            disabled={!activeTab || !canGoBack}
            onClick={() => navigateHistory("back")}
            type="button"
          >
            <ArrowLeftIcon />
          </button>
          <button
            aria-label={t("toolbar.forward")}
            className="icon-button"
            disabled={!activeTab || !canGoForward}
            onClick={() => navigateHistory("forward")}
            type="button"
          >
            <ArrowRightIcon />
          </button>
        </div>

        <button
          aria-label={
            sidebarCollapsed ? t("toolbar.expandSidebar") : t("toolbar.collapseSidebar")
          }
          aria-pressed={sidebarCollapsed}
          className="icon-button shell-toolbar__sidebar-toggle"
          onClick={() => setSidebarCollapsed((value) => !value)}
          type="button"
        >
          <PanelLeftIcon />
        </button>

        <div className="workspace-identity-host">
          <button
            aria-expanded={workspaceMenuVisible}
            aria-haspopup="menu"
            aria-label={t("toolbar.switchWorkspace")}
            className="workspace-identity"
            onClick={() => setWorkspaceMenuVisible((visible) => !visible)}
            type="button"
          >
            <WorkspaceMark className="workspace-identity__mark" />
            <span className="workspace-identity__app">{t("app.name")}</span>
            <span className="workspace-identity__separator" aria-hidden="true">
              /
            </span>
            <span className="workspace-identity__current">
              {workspace?.name ?? t("toolbar.noWorkspace")}
              {activeSession ? ` / ${fileName(activeSession.path)}` : ""}
            </span>
            <span className="workspace-identity__chevron" aria-hidden="true">
              ⌄
            </span>
          </button>
          {workspaceMenuVisible && (
            <div className="workspace-switcher" role="menu">
              {workspaces.length > 0 && (
                <p className="workspace-switcher__heading">{t("menu.openWorkspaces")}</p>
              )}
              {workspaces.map((item) => (
                <div className="workspace-switcher__row" key={item.selection.path}>
                  <button
                    aria-current={
                      item.selection.path === workspace?.path ? "page" : undefined
                    }
                    onClick={() => {
                      activateWorkspace(item.selection.path);
                      setWorkspaceMenuVisible(false);
                    }}
                    role="menuitem"
                    title={item.selection.path}
                    type="button"
                  >
                    <span>{item.selection.name}</span>
                    <small>{item.selection.path}</small>
                  </button>
                  <button
                    aria-label={`${t("menu.removeWorkspace")} ${item.selection.name}`}
                    className="workspace-switcher__remove"
                    onClick={() => removeWorkspace(item.selection)}
                    title={t("menu.removeWorkspace")}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
              {workspaceHistory.recentWorkspaces.some(
                (recent) => !workspaces.some((item) => item.selection.path === recent.path),
              ) && (
                <p className="workspace-switcher__heading workspace-switcher__heading--recent">
                  {t("menu.recentWorkspaces")}
                </p>
              )}
              {workspaceHistory.recentWorkspaces
                .filter(
                  (recent) =>
                    !workspaces.some((item) => item.selection.path === recent.path),
                )
                .slice(0, 6)
                .map((recent) => (
                  <button
                    className="workspace-switcher__recent"
                    key={recent.path}
                    onClick={() => {
                      setWorkspaceMenuVisible(false);
                      void reopenWorkspace(recent);
                    }}
                    role="menuitem"
                    title={recent.path}
                    type="button"
                  >
                    <span>{recent.name}</span>
                    <small>{recent.path}</small>
                  </button>
                ))}
              {workspaceHistory.recentFiles.length > 0 && (
                <p className="workspace-switcher__heading workspace-switcher__heading--recent">
                  {t("menu.recentFiles")}
                </p>
              )}
              {workspaceHistory.recentFiles.slice(0, 6).map((recent) => (
                <button
                  className="workspace-switcher__recent"
                  key={recent.path}
                  onClick={() => {
                    setWorkspaceMenuVisible(false);
                    void openDocument(recent.path, "newForeground");
                  }}
                  role="menuitem"
                  title={recent.path}
                  type="button"
                >
                  <span>{recent.name}</span>
                  <small>{recent.path}</small>
                </button>
              ))}
              <button
                className="workspace-switcher__open"
                onClick={() => {
                  setWorkspaceMenuVisible(false);
                  void openWorkspace();
                }}
                role="menuitem"
                type="button"
              >
                {workspaces.length > 0 ? t("menu.addWorkspace") : t("menu.openWorkspace")}
              </button>
            </div>
          )}
        </div>

        <div className="shell-toolbar__actions">
          {settings.showFavorites && (
            <button
              className="icon-button favorite-current"
              disabled={!activeSession || isUntitledPath(activeSession.path)}
              aria-label={
                activeSession && isFavorite(favorites, activeSession.path)
                  ? favoriteCopy.remove
                  : favoriteCopy.add
              }
              aria-pressed={Boolean(
                activeSession && isFavorite(favorites, activeSession.path),
              )}
              title={
                !activeSession || isUntitledPath(activeSession.path)
                  ? favoriteCopy.unsaved
                  : isFavorite(favorites, activeSession.path)
                    ? favoriteCopy.remove
                    : favoriteCopy.add
              }
              onClick={() => {
                if (activeSession) toggleFileFavorite(activeSession.path);
              }}
              type="button"
            >
              {activeSession && isFavorite(favorites, activeSession.path) ? "★" : "☆"}
            </button>
          )}
          {activeSession?.kind === "markdown" && (
            <div
              className="editor-mode-switch"
              role="group"
              aria-label={t("toolbar.editorMode")}
            >
              <button
                aria-pressed={editorMode === "visual"}
                disabled={activeSession.mode === "sourceOnly"}
                onClick={() => switchEditorMode("visual")}
                title={
                  activeSession.mode === "sourceOnly"
                    ? t("toolbar.sourceOnlyReason")
                    : t("toolbar.visualEditing")
                }
                type="button"
              >
                {t("toolbar.visual")}
              </button>
              <button
                aria-pressed={editorMode === "source"}
                onClick={() => switchEditorMode("source")}
                title={t("toolbar.sourceEditingShortcut")}
                type="button"
              >
                {t("toolbar.source")}
              </button>
            </div>
          )}
          <button
            className="command-button"
            title={t("toolbar.quickOpen")}
            onClick={() =>
              workspaces.length > 0 ? setQuickOpenVisible(true) : void openWorkspace()
            }
            type="button"
          >
            <SearchIcon />
            <span>{t("toolbar.quickOpen")}</span>
            <kbd>{formatShortcut("Mod+K")}</kbd>
          </button>
          <button
            aria-label={t("search.workspace")}
            className="command-button"
            onClick={showWorkspaceSearch}
            title={`${t("search.workspace")} · ${formatShortcut("Mod+Shift+F")}`}
            type="button"
          >
            <SearchIcon />
            <span>{t("search.workspace")}</span>
          </button>
          <div className="more-menu-host">
            <button
              aria-expanded={moreMenuVisible}
              aria-haspopup="menu"
              aria-label={t("toolbar.moreActions")}
              className="icon-button"
              onClick={() => setMoreMenuVisible((visible) => !visible)}
              type="button"
            >
              <MoreIcon />
            </button>
            {moreMenuVisible && (
              <div
                aria-label={t("toolbar.moreActions")}
                className="more-actions-menu"
                role="menu"
              >
                <button
                  onClick={() => {
                    setMoreMenuVisible(false);
                    newDocument("markdown");
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span>{t("menu.newMarkdown")}</span>
                  <kbd>{formatShortcut("Mod+N")}</kbd>
                </button>
                <button onClick={() => newDocument("text")} role="menuitem" type="button">
                  <span>{t("menu.newText")}</span>
                </button>
                <button
                  onClick={() => {
                    setMoreMenuVisible(false);
                    setTemplateVisible(true);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span>{templateCopy.title}</span>
                </button>
                <button
                  className="more-actions-menu__separated"
                  onClick={() => {
                    setMoreMenuVisible(false);
                    void openSingleFile();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span>{t("menu.openFile")}</span>
                  <kbd>{formatShortcut("Mod+O")}</kbd>
                </button>
                <button
                  onClick={() => {
                    setMoreMenuVisible(false);
                    void openWorkspace();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span>
                    {workspaces.length > 0
                      ? t("menu.addWorkspace")
                      : t("menu.openWorkspace")}
                  </span>
                </button>
                <button
                  disabled={workspaces.length === 0}
                  onClick={() => {
                    setMoreMenuVisible(false);
                    setQuickOpenVisible(true);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span>{t("toolbar.quickOpen")}</span>
                  <kbd>{formatShortcut("Mod+K")}</kbd>
                </button>
                <button
                  disabled={!activeSession}
                  onClick={() => {
                    setMoreMenuVisible(false);
                    findInActivePage();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span>{t("find.currentPage")}</span>
                  <kbd>{formatShortcut("Mod+F")}</kbd>
                </button>
                <button onClick={showWorkspaceSearch} role="menuitem" type="button">
                  <span>{t("search.workspace")}</span>
                  <kbd>{formatShortcut("Mod+Shift+F")}</kbd>
                </button>
                <ExportMenu
                  locale={locale}
                  disabled={
                    !activeSession ||
                    activeSession.kind !== "markdown" ||
                    activeSession.mode === "sourceOnly" ||
                    exporting ||
                    !adapter.exportHtml
                  }
                  pdfAvailable={Boolean(adapter.exportPdf && getPlatform() === "mac")}
                  onSelect={(format) => {
                    setMoreMenuVisible(false);
                    setExportFormat(format);
                  }}
                />
                <button
                  disabled={!activeSession}
                  onClick={() => {
                    setMoreMenuVisible(false);
                    void saveActiveDocument();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span>{t("menu.save")}</span>
                  <kbd>{formatShortcut("Mod+S")}</kbd>
                </button>
                <button
                  className="more-actions-menu__separated"
                  disabled={!activeSession}
                  onClick={() => {
                    setMoreMenuVisible(false);
                    void saveActiveDocument(true);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span>{t("menu.saveAs")}</span>
                  <kbd>{formatShortcut("Mod+Shift+S")}</kbd>
                </button>
                <button
                  disabled={!activeSession || isUntitledPath(activeSession.path)}
                  onClick={() => {
                    setMoreMenuVisible(false);
                    if (activeSession && !isUntitledPath(activeSession.path)) {
                      void revealInFileManager(activeSession.path);
                    }
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span>{t("menu.revealActiveFile")}</span>
                </button>
                <button
                  onClick={() => {
                    setMoreMenuVisible(false);
                    setSettingsVisible(true);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span>{t("menu.preferences")}</span>
                  <kbd>{formatShortcut("Mod+,")}</kbd>
                </button>
                <button
                  onClick={() => {
                    setMoreMenuVisible(false);
                    setFocusMode(true);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span>{focusLabel}</span>
                  <kbd>{formatShortcut("Mod+Shift+Enter")}</kbd>
                </button>
                <button onClick={openHelp} role="menuitem" type="button">
                  <span>{t("help.title")}</span>
                </button>
                <button onClick={openAbout} role="menuitem" type="button">
                  <span>{t("about.title")}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {!sidebarCollapsed && (
        <aside className="sidebar" aria-label={t("sidebar.label")}>
          <div
            className="sidebar__mode-tabs"
            role="tablist"
            aria-label={t("sidebar.content")}
          >
            <button
              aria-controls="sidebar-panel"
              aria-selected={sidebarMode === "files"}
              className="sidebar__mode-tab"
              onClick={() => setSidebarMode("files")}
              role="tab"
              type="button"
            >
              {t("sidebar.files")}
            </button>
            <button
              aria-controls="sidebar-panel"
              aria-selected={sidebarMode === "outline"}
              className="sidebar__mode-tab"
              onClick={() => setSidebarMode("outline")}
              role="tab"
              type="button"
            >
              {t("sidebar.outline")}
            </button>
          </div>

          <div
            className="sidebar__body"
            id="sidebar-panel"
            onContextMenu={(event) => {
              if (sidebarMode !== "files" || workspaces.length === 0) return;
              const rootPath = workspace?.path ?? workspaces[0]?.selection.path;
              if (!rootPath) return;
              event.preventDefault();
              event.stopPropagation();
              setWorkspaceContextRequest({
                rootPath,
                x: event.clientX,
                y: event.clientY,
                id: ++workspaceContextRequestId.current,
              });
            }}
            role="tabpanel"
          >
            {sidebarMode === "files" ? (
              <>
                {settings.showFavorites && (
                  <FavoritesPanel
                    paths={favorites}
                    activePath={activeSession?.path}
                    locale={locale}
                    inspectPaths={inspectFavoritePaths}
                    onHide={() => updateSettings({ showFavorites: false })}
                    onOpen={(path) =>
                      openDocument(path, "current", undefined, undefined, {
                        treePreview: true,
                      })
                    }
                    onRemove={(path) =>
                      setFavorites((current) => toggleFavorite(current, path))
                    }
                  />
                )}
                {workspaces.length > 0 ? (
                  <div className="workspace-roots">
                    {workspaces.map((item) => {
                      const isActive = item.selection.path === workspace?.path;
                      return (
                        <section
                          className={
                            isActive
                              ? "workspace-root workspace-root--active"
                              : "workspace-root"
                          }
                          key={item.selection.path}
                        >
                          <WorkspaceTree
                            favoritePaths={settings.showFavorites ? favorites : undefined}
                            onToggleFavorite={
                              settings.showFavorites ? toggleFileFavorite : undefined
                            }
                            showHidden={getWorkspaceShowHidden(
                              workspaceHistory,
                              item.selection.path,
                            )}
                            onShowHiddenChange={(path, visible) =>
                              void changeWorkspaceHiddenFiles(path, visible)
                            }
                            onImageSettings={() =>
                              setImageSettingsWorkspace(item.selection)
                            }
                            actionLabels={{
                              collapseWorkspace: t("workspace.collapse"),
                              expandWorkspace: t("workspace.expand"),
                              closeWorkspace: t("workspace.close"),
                              copyPath: t("workspace.copyPath"),
                              deleteItem: t("workspace.delete"),
                            }}
                            activePath={
                              activeDocumentWorkspacePath === item.selection.path
                                ? activeSession?.path
                                : undefined
                            }
                            ariaLabel={`${t("workspace.tree")} · ${item.selection.name}`}
                            contextMenuRequest={
                              workspaceContextRequest?.rootPath === item.selection.path
                                ? workspaceContextRequest
                                : undefined
                            }
                            nodes={item.nodes}
                            onContextMenuRequestHandled={(id) =>
                              setWorkspaceContextRequest((current) =>
                                current?.id === id ? null : current,
                              )
                            }
                            onActivateWorkspace={activateWorkspace}
                            onCloseWorkspace={() => removeWorkspace(item.selection)}
                            onCopyPath={copyPath}
                            onCreateFile={(directoryPath, requestedFileName) =>
                              createWorkspaceFile(
                                item.selection,
                                directoryPath,
                                requestedFileName,
                              )
                            }
                            onCreateFolder={
                              adapter.createWorkspaceFolder
                                ? (directoryPath, folderName) =>
                                    createWorkspaceFolder(
                                      item.selection,
                                      directoryPath,
                                      folderName,
                                    )
                                : undefined
                            }
                            onDeleteRequested={(node) =>
                              requestWorkspaceDelete(item.selection, node)
                            }
                            onOpen={(path) => {
                              activateWorkspace(item.selection.path);
                              void openDocument(path, "current", undefined, undefined, {
                                treePreview: true,
                              });
                            }}
                            onOpenPermanent={(path) => {
                              activateWorkspace(item.selection.path);
                              void openDocument(path, "current", undefined, undefined, {
                                treePreview: true,
                                keepOpen: true,
                              });
                            }}
                            onOpenInNewTab={(path) => {
                              activateWorkspace(item.selection.path);
                              void openDocument(path, "newForeground");
                            }}
                            onQuickOpen={() => {
                              activateWorkspace(item.selection.path);
                              setQuickOpenQuery("");
                              setQuickOpenVisible(true);
                            }}
                            onReveal={revealInFileManager}
                            rootActive={isActive}
                            rootName={item.selection.name}
                            rootPath={item.selection.path}
                          />
                        </section>
                      );
                    })}
                  </div>
                ) : (
                  <div className="sidebar-empty">
                    <FolderIcon className="sidebar-empty__icon" />
                    <p className="sidebar-empty__title">{t("sidebar.noWorkspace")}</p>
                    <button
                      className="sidebar-empty__action"
                      onClick={openWorkspace}
                      type="button"
                    >
                      {t("welcome.openWorkspace")}
                    </button>
                  </div>
                )}
              </>
            ) : activeSession?.kind === "markdown" && activeTab ? (
              <Outline
                emptyLabel={t("outline.noHeadings")}
                label={t("outline.document")}
                lineLabel={(line) => t("outline.line", { line })}
                markdown={activeSession.text}
                onNavigate={(item) => {
                  const tab = appStateRef.current.tabs[activeTab.id];
                  if (!tab) return;
                  const groupId = selectTabGroupId(appStateRef.current, tab.id);
                  if (groupId) {
                    documentOpenRequestsRef.current.set(
                      groupId,
                      (documentOpenRequestsRef.current.get(groupId) ?? 0) + 1,
                    );
                  }
                  commitAction(
                    navigateToView(
                      tab.id,
                      createViewState({
                        ...tab.current.view,
                        selectionFrom: item.from,
                        selectionTo: item.from,
                        visualSelectionFrom: item.from,
                        visualSelectionTo: item.from,
                      }),
                    ),
                  );
                  setEditorRevealForTab(activeTab.id, {
                    documentId: activeSession.id,
                    headingText: item.title,
                    position: item.from,
                    requestId: revealCounter.current++,
                  });
                }}
              />
            ) : (
              <div className="sidebar-empty">
                <OutlineIcon className="sidebar-empty__icon" />
                <p className="sidebar-empty__title">{t("sidebar.noOutline")}</p>
                <p>{t("sidebar.noOutlineDetail")}</p>
              </div>
            )}
          </div>

          <div className="sidebar__footer">
            <span>
              {workspaces.length > 0
                ? t("sidebar.documents", { count: allWorkspaceFiles.length })
                : t("sidebar.localWorkspace")}
            </span>
            <span
              className="sidebar__privacy"
              title={adapter.kind === "demo" ? undefined : t("status.localFilesHint")}
            >
              {adapter.kind === "demo" ? t("sidebar.demo") : t("status.localFiles")}
            </span>
          </div>
        </aside>
      )}

      <main
        className="main-viewport"
        onClick={handleEditorClick}
        onPointerOut={handleEditorPointerOut}
        onPointerOver={handleEditorPointerOver}
      >
        <RestoreNotice
          locale={locale}
          entries={restoreIssues}
          pendingPaths={restorePending}
          onRetry={(entry) => void retryRestore(entry)}
          onForget={forgetRestore}
          onChooseWorkspace={() => void openWorkspace()}
          onDismiss={() => {
            restoreNoticeDismissedRef.current = true;
            setRestoreIssues([]);
          }}
        />
        <div className="workspace-panes">
          <section className="workspace-pane workspace-pane--primary">
            <EditorGroupLayout
              groups={editorGroups}
              focusedGroupId={appState.activeEditorGroupId}
              draggedTabId={draggedTabId}
              groupLabel={(index) => t("groups.editor", { index })}
              resizeLabel={(index) => t("groups.resize", { index })}
              dropLabel={t("groups.dropTab")}
              onActivateGroup={(groupId) => commitAction(activateEditorGroup(groupId))}
              onMoveTab={(tabId, groupId) => commitAction(moveTabToGroup(tabId, groupId))}
              onDragTabChange={setDraggedTabId}
              renderTabs={(group, index) => (
                <EditorGroupTabs
                  groupId={group.id}
                  tabs={group.tabs.map((tab) => ({
                    id: tab.id,
                    path: tab.current.path,
                    dirty: tabDirtyDocumentIds(appState, tab).length > 0,
                    preview: tab.preview,
                  }))}
                  activeTabId={group.activeTab?.id ?? null}
                  focused={appState.activeEditorGroupId === group.id}
                  destinations={editorGroups.map((item, destinationIndex) => ({
                    id: item.id,
                    label: t("groups.name", { index: destinationIndex + 1 }),
                  }))}
                  draggedTabId={draggedTabId}
                  onDragTabChange={setDraggedTabId}
                  onActivate={(tabId) => {
                    const state = appStateRef.current;
                    const group = state.editorGroups.find((item) =>
                      item.tabIds.includes(tabId),
                    );
                    if (group && group.activeTabId !== tabId) {
                      // Selecting another page is newer navigation, even within
                      // the same split. Do not let its previous disk read win.
                      documentOpenRequestsRef.current.set(
                        group.id,
                        (documentOpenRequestsRef.current.get(group.id) ?? 0) + 1,
                      );
                    }
                    commitAction(activateTab(tabId));
                  }}
                  onClose={(tabId) => {
                    const tab = appStateRef.current.tabs[tabId];
                    if (tab) closeTab(tab);
                  }}
                  onNew={() => newDocument("markdown", group.id)}
                  onKeepOpen={(tabId) => commitAction(keepTabOpen(tabId))}
                  onSplitRight={(tabId) =>
                    commitAction(
                      moveTabRight(tabId, `editor-group-${groupCounter.current++}`),
                    )
                  }
                  onMove={(tabId, targetGroupId, beforeTabId) =>
                    commitAction(moveTabToGroup(tabId, targetGroupId, beforeTabId))
                  }
                  labels={{
                    rail:
                      editorGroups.length === 1
                        ? t("tabs.label")
                        : t("groups.tabs", { index: index + 1 }),
                    start: t("tabs.start"),
                    newTab: t("tabs.new"),
                    unsaved: t("tabs.unsaved"),
                    closeTab: (name) => t("tabs.close", { name }),
                    tabActions: t("tabs.actions"),
                    splitRight: t("tabs.splitRight"),
                    keepOpen: t("tabs.keepOpen"),
                    moveTo: (label) => t("tabs.moveToGroup", { group: label }),
                    close: t("common.close"),
                  }}
                />
              )}
              renderTab={renderTabEditor}
              renderEmpty={(groupId) => (
                <Welcome
                  adapterKind={adapter.kind}
                  busy={busy}
                  onNewDocument={() => newDocument("markdown", groupId)}
                  onOpenFile={() => void openSingleFile()}
                  onOpenWorkspace={openWorkspace}
                />
              )}
            />
          </section>
        </div>

        {quickOpenVisible && (
          <div
            className="quick-open-backdrop"
            onMouseDown={() => setQuickOpenVisible(false)}
          >
            <section
              aria-label={t("quickOpen.title")}
              className="quick-open"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <label>
                <SearchIcon />
                <input
                  autoFocus
                  onChange={(event) => setQuickOpenQuery(event.target.value)}
                  placeholder={t("quickOpen.placeholder")}
                  value={quickOpenQuery}
                />
                <kbd>Esc</kbd>
              </label>
              <div className="quick-open__results">
                {quickOpenFiles.slice(0, 40).map(({ node, workspace: owner }) => (
                  <button
                    key={node.path}
                    onClick={() => {
                      activateWorkspace(owner.path);
                      void openDocument(node.path);
                    }}
                    type="button"
                  >
                    <span>{node.name}</span>
                    <small>
                      {workspaces.length > 1
                        ? `${owner.name} / ${node.relativePath}`
                        : node.relativePath}
                    </small>
                  </button>
                ))}
                {quickOpenFiles.length === 0 && <p>{t("quickOpen.noResults")}</p>}
              </div>
            </section>
          </div>
        )}

        {localPreview && (
          <aside
            aria-label={locale === "zh-CN" ? "本地文件预览" : "Local file preview"}
            className="local-file-preview-popover"
            onPointerEnter={clearLocalPreviewTimer}
            onPointerLeave={() => {
              clearLocalPreviewTimer();
              localPreviewTimerRef.current = window.setTimeout(closeLocalPreview, 180);
            }}
            style={{
              left: Math.max(12, Math.min(localPreview.left, window.innerWidth - 692)),
              top: Math.max(64, Math.min(localPreview.top, window.innerHeight - 700)),
            }}
          >
            {localPreview.loading ? (
              <div className="local-file-preview-popover__message">
                {locale === "zh-CN" ? "正在读取本地文件…" : "Reading local file…"}
              </div>
            ) : localPreview.preview ? (
              <CodeFilePreview
                codeWrap={settings.codeWrap}
                content={localPreview.preview.content}
                language={localPreview.preview.language}
                locale={locale}
                onOpenFile={() => {
                  const preview = localPreview.preview;
                  if (!preview) return;
                  closeLocalPreview();
                  void openDocument(
                    preview.path,
                    "newForeground",
                    undefined,
                    preview.targetLine,
                  );
                }}
                onOpenSide={() => {
                  const preview = localPreview.preview;
                  if (preview) void openLocalPreviewOnRight(preview);
                }}
                path={localPreview.preview.path}
                showLineNumbers={settings.showCodeLineNumbers}
                startLine={localPreview.preview.startLine}
                targetLine={localPreview.preview.targetLine}
                variant="popover"
              />
            ) : (
              <div className="local-file-preview-popover__message local-file-preview-popover__message--error">
                {localPreview.error ??
                  (locale === "zh-CN" ? "无法预览这个文件" : "Unable to preview this file")}
              </div>
            )}
          </aside>
        )}

        {visual && (
          <VisualViewer
            key={`${visual.kind}:${visual.source}`}
            visual={visual}
            onClose={() => setVisual(null)}
          />
        )}
      </main>

      {templateVisible && (
        <TemplateDialog
          locale={locale}
          library={templateLibrary}
          currentMarkdown={
            activeSession?.kind === "markdown" && activeSession.mode === "normal"
              ? activeSession.text
              : undefined
          }
          onClose={() => setTemplateVisible(false)}
          onSelect={(template) => {
            setTemplateVisible(false);
            newDocument("markdown", undefined, template);
          }}
        />
      )}
      {workspaceSearchVisible && searchWorkspaces && (
        <WorkspaceSearchDialog
          historyLimit={settings.searchHistoryLimit}
          locale={locale}
          onViewStateChange={setWorkspaceSearchViewState}
          workspaces={searchRoots}
          search={searchWorkspaces}
          viewState={workspaceSearchViewState}
          onOpen={(match) => {
            setWorkspaceSearchVisible(false);
            void openDocument(match.path, "current", undefined, match.line, {
              treePreview: true,
              searchColumn: match.column,
            });
          }}
          onOpenWorkspace={() => {
            setWorkspaceSearchVisible(false);
            void openWorkspace();
          }}
          onClose={() => setWorkspaceSearchVisible(false)}
        />
      )}
      {exportFormat && (
        <ExportDialog
          locale={locale}
          initialFormat={exportFormat}
          pdfAvailable={Boolean(adapter.exportPdf && getPlatform() === "mac")}
          onClose={() => setExportFormat(null)}
          onExport={(format, allowRemoteImages) => {
            setExportFormat(null);
            void exportActiveDocument(format, allowRemoteImages);
          }}
        />
      )}
      <SettingsDialog open={settingsVisible} onClose={() => setSettingsVisible(false)} />
      {helpVisible && <HelpDialog onClose={() => setHelpVisible(false)} />}
      {aboutVisible && (
        <AboutDialog
          onCheckForUpdate={adapter.checkForUpdate?.bind(adapter)}
          onClose={() => setAboutVisible(false)}
          onOpenExternalUrl={adapter.openExternalUrl?.bind(adapter)}
        />
      )}
      {availableUpdate &&
        updatePromptReady &&
        !pendingCloseRequest &&
        !pendingWorkspaceDelete &&
        !imageSettingsWorkspace &&
        !settingsVisible &&
        !aboutVisible &&
        !helpVisible &&
        !templateVisible &&
        !workspaceSearchVisible &&
        !exportFormat &&
        !visual &&
        !quickOpenVisible &&
        !moreMenuVisible &&
        !workspaceMenuVisible &&
        !contextMenu.open && (
          <UpdateDialog
            update={availableUpdate}
            onClose={() => {
              setUpdatePromptReady(false);
              setAvailableUpdate(null);
            }}
            onSkip={(version) => {
              saveSkippedUpdateVersion(version);
              setUpdatePromptReady(false);
              setAvailableUpdate(null);
            }}
            onOpenRelease={(url) => {
              if (!adapter.openExternalUrl) {
                return Promise.reject(new Error("External browser unavailable"));
              }
              return adapter.openExternalUrl(url);
            }}
          />
        )}
      {imageSettingsWorkspace && (
        <WorkspaceImageSettingsDialog
          key={imageSettingsWorkspace.path}
          workspaceName={imageSettingsWorkspace.name}
          imageDirectoryPath={getWorkspaceImageDirectory(
            workspaceHistory,
            imageSettingsWorkspace.path,
          )}
          labels={{
            title: t("workspaceImages.title"),
            description: t("workspaceImages.description"),
            sameDirectory: t("workspaceImages.sameDirectory"),
            sameDirectoryDescription: t("workspaceImages.sameDirectoryDescription"),
            customDirectory: t("workspaceImages.customDirectory"),
            customDirectoryDescription: t("workspaceImages.customDirectoryDescription"),
            directoryPath: t("workspaceImages.directoryPath"),
            chooseDirectory: t("workspaceImages.chooseDirectory"),
            chooseDirectoryHint: t("workspaceImages.chooseDirectoryHint"),
            chooseDirectoryError: t("workspaceImages.chooseDirectoryError"),
            cancel: t("workspaceImages.cancel"),
            save: t("workspaceImages.save"),
          }}
          onChooseDirectory={() =>
            adapter.pickImageDirectory
              ? adapter.pickImageDirectory(locale)
              : Promise.reject(new Error("Directory chooser unavailable"))
          }
          onSave={(directoryPath) => {
            const nextHistory = setWorkspaceImageDirectory(
              workspaceHistoryRef.current,
              imageSettingsWorkspace.path,
              directoryPath,
            );
            workspaceHistoryRef.current = nextHistory;
            setWorkspaceHistory(nextHistory);
            setStatus(
              t("status.workspaceImagesSaved", { name: imageSettingsWorkspace.name }),
            );
            setImageSettingsWorkspace(null);
          }}
          onClose={() => setImageSettingsWorkspace(null)}
        />
      )}
      {pendingCloseRequest && (
        <UnsavedCloseDialog
          dirtyPaths={pendingCloseRequest.dirtyPaths}
          kind={pendingCloseRequest.kind}
          onCancel={cancelPendingClose}
          onConfirm={confirmPendingClose}
        />
      )}
      {pendingWorkspaceDelete && (
        <WorkspaceDeleteDialog
          busy={busy}
          onCancel={cancelWorkspaceDelete}
          onConfirm={() => void confirmWorkspaceDelete()}
          pending={pendingWorkspaceDelete}
        />
      )}
      <EditorContextMenu
        actions={{
          revealImage: async ({ image }) => {
            if (image?.localPath) await revealInFileManager(image.localPath);
          },
        }}
        onClose={closeContextMenu}
        open={contextMenu.open}
        position={contextMenu.position}
        target={contextMenu.target}
      />

      <footer className="status-bar" role="status" aria-live="polite">
        <span
          className={
            activeStatusFailure
              ? "status-bar__state status-bar__state--error"
              : "status-bar__state"
          }
          title={activeStatusFailure ?? (activeSession?.dirty ? t("tabs.unsaved") : status)}
        >
          <span className="status-bar__dot" aria-hidden="true" />
          {activeStatusFailure ?? (activeSession?.dirty ? t("tabs.unsaved") : status)}
        </span>
        {activeSession ? (
          <DocumentStatisticsStatus
            session={activeSession}
            modeLabel={
              activeSession.kind === "text"
                ? activeSession.language
                : activeSession.mode === "sourceOnly"
                  ? t("status.sourceOnly")
                  : editorMode === "visual"
                    ? t("status.visualEditing")
                    : t("status.sourceEditing")
            }
          />
        ) : (
          <span>{t("status.localFirst")}</span>
        )}
        <span className="status-bar__app">
          {t("app.name")} {APP_VERSION}
        </span>
      </footer>
    </div>
  );
}
