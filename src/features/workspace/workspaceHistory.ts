export const WORKSPACE_HISTORY_STORAGE_KEY = "markdown-workspace.workspaces.v1";

const MAX_RECENT_ITEMS = 12;

export interface RememberedWorkspace {
  readonly path: string;
  readonly name: string;
  readonly lastOpenedAt: number;
  readonly showHidden?: boolean;
}

export interface RememberedFile {
  readonly path: string;
  readonly name: string;
  readonly lastOpenedAt: number;
}

export interface WorkspaceHistoryState {
  readonly openWorkspaces: readonly RememberedWorkspace[];
  readonly recentWorkspaces: readonly RememberedWorkspace[];
  readonly recentFiles: readonly RememberedFile[];
  readonly activeWorkspacePath: string | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const emptyWorkspaceHistory: WorkspaceHistoryState = Object.freeze({
  openWorkspaces: Object.freeze([]),
  recentWorkspaces: Object.freeze([]),
  recentFiles: Object.freeze([]),
  activeWorkspacePath: null,
});

function currentStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function validWorkspace(value: unknown): value is RememberedWorkspace {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RememberedWorkspace>;
  return (
    typeof item.path === "string" &&
    item.path.length > 0 &&
    typeof item.name === "string" &&
    item.name.length > 0 &&
    typeof item.lastOpenedAt === "number" &&
    Number.isFinite(item.lastOpenedAt)
  );
}

function validFile(value: unknown): value is RememberedFile {
  return validWorkspace(value);
}

function normalizeWorkspace(workspace: RememberedWorkspace): RememberedWorkspace {
  const { path, name, lastOpenedAt, showHidden } = workspace;
  return {
    path,
    name,
    lastOpenedAt,
    ...(typeof showHidden === "boolean" ? { showHidden } : {}),
  };
}

function uniqueByPath<T extends { readonly path: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.path)) return false;
    seen.add(item.path);
    return true;
  });
}

export function loadWorkspaceHistory(
  storage: StorageLike | null = currentStorage(),
): WorkspaceHistoryState {
  if (!storage) return emptyWorkspaceHistory;

  try {
    const serialized = storage.getItem(WORKSPACE_HISTORY_STORAGE_KEY);
    if (!serialized) return emptyWorkspaceHistory;
    const parsed = JSON.parse(serialized) as Partial<WorkspaceHistoryState>;
    const openWorkspaces = uniqueByPath(
      (Array.isArray(parsed.openWorkspaces) ? parsed.openWorkspaces : [])
        .filter(validWorkspace)
        .map(normalizeWorkspace),
    );
    const recentWorkspaces = uniqueByPath(
      (Array.isArray(parsed.recentWorkspaces) ? parsed.recentWorkspaces : [])
        .filter(validWorkspace)
        .map(normalizeWorkspace)
        .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
        .slice(0, MAX_RECENT_ITEMS),
    );
    const recentFiles = uniqueByPath(
      (Array.isArray(parsed.recentFiles) ? parsed.recentFiles : [])
        .filter(validFile)
        .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
        .slice(0, MAX_RECENT_ITEMS),
    );
    const activeWorkspacePath =
      typeof parsed.activeWorkspacePath === "string" &&
      openWorkspaces.some((workspace) => workspace.path === parsed.activeWorkspacePath)
        ? parsed.activeWorkspacePath
        : (openWorkspaces[0]?.path ?? null);

    return { openWorkspaces, recentWorkspaces, recentFiles, activeWorkspacePath };
  } catch {
    return emptyWorkspaceHistory;
  }
}

export function saveWorkspaceHistory(
  state: WorkspaceHistoryState,
  storage: StorageLike | null = currentStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(WORKSPACE_HISTORY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Preferences are a convenience; editing must continue if storage is unavailable.
  }
}

export function rememberWorkspace(
  state: WorkspaceHistoryState,
  workspace: {
    readonly path: string;
    readonly name: string;
    readonly showHidden?: boolean;
  },
  now = Date.now(),
): WorkspaceHistoryState {
  const previous = [...state.openWorkspaces, ...state.recentWorkspaces].find(
    (item) => item.path === workspace.path,
  );
  const showHidden = workspace.showHidden ?? previous?.showHidden;
  const remembered: RememberedWorkspace = {
    ...workspace,
    ...(showHidden !== undefined ? { showHidden } : {}),
    lastOpenedAt: now,
  };
  return {
    ...state,
    openWorkspaces: [
      ...state.openWorkspaces.filter((item) => item.path !== workspace.path),
      remembered,
    ],
    recentWorkspaces: [
      remembered,
      ...state.recentWorkspaces.filter((item) => item.path !== workspace.path),
    ].slice(0, MAX_RECENT_ITEMS),
    activeWorkspacePath: workspace.path,
  };
}

export function getWorkspaceShowHidden(
  state: WorkspaceHistoryState,
  path: string,
): boolean {
  return (
    [...state.openWorkspaces, ...state.recentWorkspaces].find((item) => item.path === path)
      ?.showHidden === true
  );
}

export function setWorkspaceShowHidden(
  state: WorkspaceHistoryState,
  path: string,
  showHidden: boolean,
): WorkspaceHistoryState {
  const update = (workspace: RememberedWorkspace) =>
    workspace.path === path ? { ...workspace, showHidden } : workspace;
  return {
    ...state,
    openWorkspaces: state.openWorkspaces.map(update),
    recentWorkspaces: state.recentWorkspaces.map(update),
  };
}

export function forgetOpenWorkspace(
  state: WorkspaceHistoryState,
  path: string,
): WorkspaceHistoryState {
  const openWorkspaces = state.openWorkspaces.filter(
    (workspace) => workspace.path !== path,
  );
  return {
    ...state,
    openWorkspaces,
    activeWorkspacePath:
      state.activeWorkspacePath === path
        ? (openWorkspaces.at(-1)?.path ?? null)
        : state.activeWorkspacePath,
  };
}

export function activateRememberedWorkspace(
  state: WorkspaceHistoryState,
  path: string,
): WorkspaceHistoryState {
  if (!state.openWorkspaces.some((workspace) => workspace.path === path)) return state;
  return { ...state, activeWorkspacePath: path };
}

export function rememberFile(
  state: WorkspaceHistoryState,
  file: { readonly path: string; readonly name: string },
  now = Date.now(),
): WorkspaceHistoryState {
  const remembered: RememberedFile = { ...file, lastOpenedAt: now };
  return {
    ...state,
    recentFiles: [
      remembered,
      ...state.recentFiles.filter((item) => item.path !== file.path),
    ].slice(0, MAX_RECENT_ITEMS),
  };
}
