export type DocumentId = string;
export type TabId = string;
export type EditorGroupId = string;

export type DocumentMode = "normal" | "sourceOnly";
export type EditorMode = "visual" | "source";
export type DocumentKind = "markdown" | "text";

export interface DocumentExternalChange {
  status: "modified" | "missing" | "unreadable" | "blocked";
  revision?: string;
}

export interface DocumentSession {
  id: DocumentId;
  path: string;
  text: string;
  diskMtimeMs: number;
  diskRevision?: string;
  externalChange?: DocumentExternalChange;
  dirty: boolean;
  mode: DocumentMode;
  kind: DocumentKind;
  language: string;
}

export interface OpenDocument {
  path: string;
  text: string;
  diskMtimeMs: number;
  diskRevision?: string;
  mode: DocumentMode;
  kind?: DocumentKind;
  language?: string;
}

export interface ViewState {
  anchor?: string;
  editorMode: EditorMode;
  /** Scroll offset owned by the explicit source editor. */
  sourceScrollTop: number;
  /** Scroll offset owned by the visual editor. */
  visualScrollTop: number;
  /** Markdown character offsets used only by the explicit source editor. */
  selectionFrom: number;
  selectionTo: number;
  /** ProseMirror positions used only by the visual editor. */
  visualSelectionFrom: number;
  visualSelectionTo: number;
}

export interface HistoryEntry {
  documentId: DocumentId;
  path: string;
  view: ViewState;
}

export interface Tab {
  id: TabId;
  /** A replaceable file-tree preview; editing or keeping it makes it permanent. */
  preview: boolean;
  current: HistoryEntry;
  back: HistoryEntry[];
  forward: HistoryEntry[];
}

export interface EditorGroup {
  id: EditorGroupId;
  tabIds: TabId[];
  activeTabId: TabId | null;
  /** An intentional empty destination/source created by moving a sole tab. */
  keepEmpty?: boolean;
}

export const INITIAL_EDITOR_GROUP_ID = "editor-group-main";
export const MAX_NAVIGATION_VISITS = 200;

/** Window navigation remembers destinations and views, never document bodies. */
export interface NavigationVisit {
  tabId: TabId;
  entry: HistoryEntry;
}

export interface NavigationTrail {
  visits: NavigationVisit[];
  index: number;
}

export interface AppState {
  sessions: Record<DocumentId, DocumentSession>;
  tabs: Record<TabId, Tab>;
  tabOrder: TabId[];
  activeTabId: TabId | null;
  editorGroups: EditorGroup[];
  activeEditorGroupId: EditorGroupId;
  navigation: NavigationTrail;
}

export function createInitialAppState(): AppState {
  return {
    sessions: {},
    tabs: {},
    tabOrder: [],
    activeTabId: null,
    editorGroups: [{ id: INITIAL_EDITOR_GROUP_ID, tabIds: [], activeTabId: null }],
    activeEditorGroupId: INITIAL_EDITOR_GROUP_ID,
    navigation: { visits: [], index: -1 },
  };
}

export function createViewState(overrides: Partial<ViewState> = {}): ViewState {
  return {
    anchor: overrides.anchor,
    editorMode: overrides.editorMode ?? "visual",
    sourceScrollTop: overrides.sourceScrollTop ?? 0,
    visualScrollTop: overrides.visualScrollTop ?? 0,
    selectionFrom: overrides.selectionFrom ?? 0,
    selectionTo: overrides.selectionTo ?? overrides.selectionFrom ?? 0,
    visualSelectionFrom: overrides.visualSelectionFrom ?? 0,
    visualSelectionTo: overrides.visualSelectionTo ?? overrides.visualSelectionFrom ?? 0,
  };
}

export function documentIdFromPath(path: string): DocumentId {
  return path;
}
