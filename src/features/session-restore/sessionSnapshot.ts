import {
  createInitialAppState,
  createViewState,
  type AppState,
  type ViewState,
} from "../../app/state/model";
import { browserSettingsStorage, type SettingsStorage } from "../../app/settings/storage";
import type {
  DesktopAdapter,
  EditableDocumentResult,
} from "../../infrastructure/tauri/desktopAdapter";

export const SESSION_SNAPSHOT_STORAGE_KEY = "markdown-workspace.session.v1";
export const MAX_SESSION_GROUPS = 8;
export const MAX_SESSION_TABS = 100;
export const MAX_SESSION_WORKSPACES = 32;
export const MAX_SESSION_PATH_LENGTH = 32_768;
export const MAX_SESSION_STORAGE_LENGTH = 4 * 1024 * 1024;
const MAX_VIEW_OFFSET = 1_000_000_000;

/** A numeric reading position, not a text excerpt or a persistent semantic anchor. */
export type SavedTabView = Omit<ViewState, "anchor">;

export interface SavedSessionTab {
  readonly path: string;
  readonly preview: boolean;
  readonly view: SavedTabView;
}

export interface SavedSessionGroup {
  readonly tabs: readonly SavedSessionTab[];
  readonly activeTabIndex: number;
  readonly keepEmpty?: boolean;
}

/** Convenience metadata only. Disk files remain the only persisted document bodies. */
export interface SessionSnapshot {
  readonly version: 1;
  readonly workspacePaths: readonly string[];
  readonly activeWorkspacePath: string | null;
  readonly groups: readonly SavedSessionGroup[];
  readonly activeGroupIndex: number;
}

export interface SessionSnapshotOptions {
  readonly workspacePaths: readonly string[];
  readonly activeWorkspacePath: string | null;
}

export interface ReopenedSession {
  readonly state: AppState;
  readonly skippedPaths: readonly string[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function localPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SESSION_PATH_LENGTH &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    }) &&
    (/^\//u.test(value) || /^[a-z]:[/\\]/iu.test(value) || /^\\\\/u.test(value))
  );
}

function offset(value: unknown, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const clamped = Math.min(MAX_VIEW_OFFSET, Math.max(0, value));
  return integer ? Math.floor(clamped) : clamped;
}

function savedView(value: unknown): SavedTabView {
  const view = record(value) ?? {};
  // Deliberately list every field. Never spread caller-owned view/session data:
  // it can contain anchors, selected text, or transient semantic text excerpts.
  return {
    editorMode: view.editorMode === "source" ? "source" : "visual",
    sourceScrollTop: offset(view.sourceScrollTop),
    visualScrollTop: offset(view.visualScrollTop),
    selectionFrom: offset(view.selectionFrom, true),
    selectionTo: offset(view.selectionTo, true),
    visualSelectionFrom: offset(view.visualSelectionFrom, true),
    visualSelectionTo: offset(view.visualSelectionTo, true),
  };
}

export function normalizeSessionSnapshot(value: unknown): SessionSnapshot | null {
  const candidate = record(value);
  if (!candidate || candidate.version !== 1) return null;
  if (!Array.isArray(candidate.groups) || !Array.isArray(candidate.workspacePaths)) {
    return null;
  }

  const workspacePaths = [...new Set(candidate.workspacePaths.filter(localPath))].slice(
    0,
    MAX_SESSION_WORKSPACES,
  );
  const activeWorkspacePath =
    localPath(candidate.activeWorkspacePath) &&
    workspacePaths.includes(candidate.activeWorkspacePath)
      ? candidate.activeWorkspacePath
      : (workspacePaths[0] ?? null);
  const groups: SavedSessionGroup[] = [];
  let activeGroupIndex = -1;
  let tabCount = 0;

  for (const [groupIndex, rawGroup] of candidate.groups.entries()) {
    if (groups.length >= MAX_SESSION_GROUPS || tabCount >= MAX_SESSION_TABS) break;
    const group = record(rawGroup);
    if (!group || !Array.isArray(group.tabs)) continue;
    const tabs: SavedSessionTab[] = [];
    let activeTabIndex = -1;
    let hasPreview = false;
    for (const [tabIndex, rawTab] of group.tabs.entries()) {
      if (tabCount >= MAX_SESSION_TABS) break;
      const tab = record(rawTab);
      if (!tab || !localPath(tab.path)) continue;
      if (group.activeTabIndex === tabIndex) activeTabIndex = tabs.length;
      const preview: boolean = tab.preview === true && !hasPreview;
      hasPreview ||= preview;
      tabs.push({ path: tab.path, preview, view: savedView(tab.view) });
      tabCount += 1;
    }
    const keepEmpty = group.keepEmpty === true && group.tabs.length === 0;
    if (!tabs.length && !keepEmpty) continue;
    if (candidate.activeGroupIndex === groupIndex) activeGroupIndex = groups.length;
    groups.push({
      tabs,
      activeTabIndex: tabs.length ? Math.max(0, activeTabIndex) : -1,
      ...(keepEmpty ? { keepEmpty: true } : {}),
    });
  }

  return {
    version: 1,
    workspacePaths,
    activeWorkspacePath,
    groups,
    activeGroupIndex: activeGroupIndex < 0 && groups.length ? 0 : activeGroupIndex,
  };
}

export function buildSessionSnapshot(
  state: AppState,
  options: SessionSnapshotOptions,
): SessionSnapshot {
  return normalizeSessionSnapshot({
    version: 1,
    workspacePaths: options.workspacePaths,
    activeWorkspacePath: options.activeWorkspacePath,
    activeGroupIndex: state.editorGroups.findIndex(
      (group) => group.id === state.activeEditorGroupId,
    ),
    groups: state.editorGroups.map((group) => ({
      activeTabIndex: group.tabIds.indexOf(group.activeTabId ?? ""),
      keepEmpty: group.keepEmpty,
      tabs: group.tabIds.map((id) => {
        const tab = state.tabs[id];
        const session = tab && state.sessions[tab.current.documentId];
        if (!tab || !session) return null;
        return {
          path: session.path,
          preview: tab.preview && !session.dirty,
          view: savedView(tab.current.view),
        };
      }),
    })),
  })!;
}

export function loadSessionSnapshot(
  storage: SettingsStorage | null = browserSettingsStorage(),
): SessionSnapshot | null {
  if (!storage) return null;
  try {
    const serialized = storage.getItem(SESSION_SNAPSHOT_STORAGE_KEY);
    if (!serialized || serialized.length > MAX_SESSION_STORAGE_LENGTH) return null;
    return normalizeSessionSnapshot(JSON.parse(serialized));
  } catch {
    return null;
  }
}

export function saveSessionSnapshot(
  snapshot: SessionSnapshot,
  storage: SettingsStorage | null = browserSettingsStorage(),
): boolean {
  if (!storage) return false;
  try {
    const normalized = normalizeSessionSnapshot(snapshot);
    if (!normalized) return false;
    const serialized = JSON.stringify(normalized);
    if (serialized.length > MAX_SESSION_STORAGE_LENGTH) return false;
    storage.setItem(SESSION_SNAPSHOT_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

/** Reopen each path once. Never recover cached text, dirty drafts, or history. */
export async function reopenSessionSnapshot(
  snapshot: SessionSnapshot,
  adapter: Pick<DesktopAdapter, "openDocument">,
  shouldContinue: () => boolean = () => true,
): Promise<ReopenedSession | null> {
  const normalized = normalizeSessionSnapshot(snapshot);
  if (!normalized || !shouldContinue()) return null;
  const documents = new Map<string, EditableDocumentResult>();
  const skippedPaths: string[] = [];
  const paths = new Set(
    normalized.groups.flatMap((group) => group.tabs.map((t) => t.path)),
  );

  for (const path of paths) {
    if (!shouldContinue()) return null;
    try {
      const result = await adapter.openDocument(path);
      if (!shouldContinue()) return null;
      if (result.status === "editable" && localPath(result.path)) {
        documents.set(path, result);
      } else {
        skippedPaths.push(path);
      }
    } catch {
      if (!shouldContinue()) return null;
      skippedPaths.push(path);
    }
  }

  const state = createInitialAppState();
  const groups: AppState["editorGroups"] = [];
  let activeGroupId: string | undefined;
  let nextTabId = 0;
  for (const [groupIndex, savedGroup] of normalized.groups.entries()) {
    const group = {
      id: `restored-group-${groupIndex + 1}`,
      tabIds: [] as string[],
      activeTabId: null as string | null,
      ...(savedGroup.keepEmpty ? { keepEmpty: true } : {}),
    };
    for (const [tabIndex, savedTab] of savedGroup.tabs.entries()) {
      const document = documents.get(savedTab.path);
      if (!document) continue;
      const tabId = `restored-tab-${++nextTabId}`;
      const path = document.path;
      state.sessions[path] ??= {
        id: path,
        path,
        text: document.content,
        diskMtimeMs: 0,
        diskRevision: document.diskRevision,
        dirty: false,
        mode: document.mode,
        kind: document.documentKind,
        language: document.language,
      };
      const view = createViewState(savedTab.view);
      if (document.mode === "sourceOnly" || document.documentKind === "text") {
        view.editorMode = "source";
      }
      view.selectionFrom = Math.min(view.selectionFrom, document.content.length);
      view.selectionTo = Math.min(view.selectionTo, document.content.length);
      view.visualSelectionFrom = Math.min(
        view.visualSelectionFrom,
        document.content.length,
      );
      view.visualSelectionTo = Math.min(view.visualSelectionTo, document.content.length);
      state.tabs[tabId] = {
        id: tabId,
        preview: savedTab.preview,
        current: { documentId: path, path, view },
        back: [],
        forward: [],
      };
      group.tabIds.push(tabId);
      if (savedGroup.activeTabIndex === tabIndex) group.activeTabId = tabId;
    }
    if (!group.tabIds.length && !group.keepEmpty) continue;
    group.activeTabId ??= group.tabIds[0] ?? null;
    if (normalized.activeGroupIndex === groupIndex) activeGroupId = group.id;
    groups.push(group);
  }
  if (groups.length) {
    state.editorGroups = groups;
    state.activeEditorGroupId = activeGroupId ?? groups[0]!.id;
    state.tabOrder = groups.flatMap((group) => group.tabIds);
    state.activeTabId = groups.find(
      (group) => group.id === state.activeEditorGroupId,
    )!.activeTabId;
  }
  return { state, skippedPaths };
}
