export type DocumentId = string;
export type TabId = string;

export type DocumentMode = "normal" | "sourceOnly";

export interface DocumentSession {
  id: DocumentId;
  path: string;
  text: string;
  diskMtimeMs: number;
  dirty: boolean;
  mode: DocumentMode;
}

export interface OpenDocument {
  path: string;
  text: string;
  diskMtimeMs: number;
  mode: DocumentMode;
}

export interface ViewState {
  anchor?: string;
  scrollTop: number;
  selectionFrom: number;
  selectionTo: number;
}

export interface HistoryEntry {
  documentId: DocumentId;
  path: string;
  view: ViewState;
}

export interface Tab {
  id: TabId;
  current: HistoryEntry;
  back: HistoryEntry[];
  forward: HistoryEntry[];
}

export interface AppState {
  sessions: Record<DocumentId, DocumentSession>;
  tabs: Record<TabId, Tab>;
  tabOrder: TabId[];
  activeTabId: TabId | null;
}

export function createInitialAppState(): AppState {
  return {
    sessions: {},
    tabs: {},
    tabOrder: [],
    activeTabId: null,
  };
}

export function createViewState(overrides: Partial<ViewState> = {}): ViewState {
  return {
    anchor: overrides.anchor,
    scrollTop: overrides.scrollTop ?? 0,
    selectionFrom: overrides.selectionFrom ?? 0,
    selectionTo: overrides.selectionTo ?? overrides.selectionFrom ?? 0,
  };
}

export function documentIdFromPath(path: string): DocumentId {
  return path;
}
