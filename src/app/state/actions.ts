import type {
  DocumentExternalChange,
  DocumentId,
  EditorGroupId,
  OpenDocument,
  TabId,
  ViewState,
} from "./model";

export type AppStateAction =
  | {
      type: "tab/open-current";
      tabId: TabId;
      document: OpenDocument;
      previousView?: ViewState;
      targetView?: ViewState;
    }
  | {
      type: "tab/open-new";
      tabId: TabId;
      document: OpenDocument;
      active: boolean;
      view?: ViewState;
      groupId?: EditorGroupId;
      preview?: boolean;
      focus?: boolean;
    }
  | {
      type: "tab/open-preview";
      tabId: TabId;
      document: OpenDocument;
      groupId?: EditorGroupId;
      permanent: boolean;
      focus?: boolean;
    }
  | { type: "tab/keep-open"; tabId: TabId }
  | {
      type: "tab/go-back";
      tabId: TabId;
      currentView?: ViewState;
    }
  | {
      type: "tab/go-forward";
      tabId: TabId;
      currentView?: ViewState;
    }
  | { type: "tab/update-view"; tabId: TabId; view: ViewState }
  | { type: "tab/navigate-view"; tabId: TabId; view: ViewState }
  | { type: "navigation/go-back"; currentView?: ViewState }
  | { type: "navigation/go-forward"; currentView?: ViewState }
  | { type: "tab/activate"; tabId: TabId }
  | { type: "tab/close"; tabId: TabId }
  | {
      type: "tab/split-right";
      tabId: TabId;
      newTabId: TabId;
      newGroupId: EditorGroupId;
    }
  | {
      type: "tab/move-to-group";
      tabId: TabId;
      targetGroupId: EditorGroupId;
      beforeTabId?: TabId;
    }
  | { type: "editor-group/activate"; groupId: EditorGroupId }
  | { type: "tab/move-right"; tabId: TabId; newGroupId: EditorGroupId }
  | {
      type: "editor-group/open-right";
      sourceGroupId: EditorGroupId;
      newGroupId: EditorGroupId;
      tabId: TabId;
      document: OpenDocument;
      focus: boolean;
    }
  | { type: "session/restore"; state: import("./model").AppState }
  | { type: "document/discard"; documentIds: readonly DocumentId[] }
  | { type: "document/edit"; documentId: DocumentId; text: string }
  | {
      type: "document/external-change";
      documentId: DocumentId;
      change: DocumentExternalChange | undefined;
    }
  | {
      type: "document/reload";
      documentId: DocumentId;
      document: OpenDocument;
      expectedText: string;
      expectedRevision?: string;
      allowDirty: boolean;
    }
  | {
      type: "document/mark-saved";
      documentId: DocumentId;
      savedText: string;
      diskMtimeMs: number;
      diskRevision?: string;
    }
  | {
      type: "document/relocate";
      documentId: DocumentId;
      document: OpenDocument;
      savedText: string;
    };

export function openInCurrent(
  tabId: TabId,
  document: OpenDocument,
  previousView?: ViewState,
  targetView?: ViewState,
): AppStateAction {
  return { type: "tab/open-current", tabId, document, previousView, targetView };
}

export function openInNewTab(
  tabId: TabId,
  document: OpenDocument,
  active = true,
  view?: ViewState,
  groupId?: EditorGroupId,
  preview = false,
  focus = true,
): AppStateAction {
  return { type: "tab/open-new", tabId, document, active, view, groupId, preview, focus };
}

/** A single-click tree preview; permanent also supports atomic double-click opens. */
export function openPreviewTab(
  tabId: TabId,
  document: OpenDocument,
  groupId?: EditorGroupId,
  permanent = false,
  focus = true,
): AppStateAction {
  return { type: "tab/open-preview", tabId, document, groupId, permanent, focus };
}

export function keepTabOpen(tabId: TabId): AppStateAction {
  return { type: "tab/keep-open", tabId };
}

export function goBack(tabId: TabId, currentView?: ViewState): AppStateAction {
  return { type: "tab/go-back", tabId, currentView };
}

export function goForward(tabId: TabId, currentView?: ViewState): AppStateAction {
  return { type: "tab/go-forward", tabId, currentView };
}

export function updateView(tabId: TabId, view: ViewState): AppStateAction {
  return { type: "tab/update-view", tabId, view };
}

/** Explicit anchor/outline navigation; ordinary scroll and selection use updateView. */
export function navigateToView(tabId: TabId, view: ViewState): AppStateAction {
  return { type: "tab/navigate-view", tabId, view };
}

export function goNavigationBack(currentView?: ViewState): AppStateAction {
  return { type: "navigation/go-back", currentView };
}

export function goNavigationForward(currentView?: ViewState): AppStateAction {
  return { type: "navigation/go-forward", currentView };
}

export function activateTab(tabId: TabId): AppStateAction {
  return { type: "tab/activate", tabId };
}

export function closeTab(tabId: TabId): AppStateAction {
  return { type: "tab/close", tabId };
}

/** Duplicate a Tab's navigation state, not its shared document body. */
export function splitTabRight(
  tabId: TabId,
  newTabId: TabId,
  newGroupId: EditorGroupId,
): AppStateAction {
  return { type: "tab/split-right", tabId, newTabId, newGroupId };
}

export function moveTabToGroup(
  tabId: TabId,
  targetGroupId: EditorGroupId,
  beforeTabId?: TabId,
): AppStateAction {
  return { type: "tab/move-to-group", tabId, targetGroupId, beforeTabId };
}

/** Move the original tab to its neighbor, creating that group only when needed. */
export function moveTabRight(tabId: TabId, newGroupId: EditorGroupId): AppStateAction {
  return { type: "tab/move-right", tabId, newGroupId };
}

export function activateEditorGroup(groupId: EditorGroupId): AppStateAction {
  return { type: "editor-group/activate", groupId };
}

/** Forget documents only after the user has explicitly removed them from disk. */
export function discardDocuments(documentIds: readonly DocumentId[]): AppStateAction {
  return { type: "document/discard", documentIds };
}

export function editDocument(documentId: DocumentId, text: string): AppStateAction {
  return { type: "document/edit", documentId, text };
}

/** Track disk state without changing the in-memory body or its unsaved status. */
export function markDocumentExternalChange(
  documentId: DocumentId,
  change: DocumentExternalChange | undefined,
): AppStateAction {
  return { type: "document/external-change", documentId, change };
}

/** Apply a completed disk read only to the still-referenced, unchanged baseline. */
export function reloadDocument(
  documentId: DocumentId,
  document: OpenDocument,
  expectedText: string,
  expectedRevision?: string,
  allowDirty = false,
): AppStateAction {
  return {
    type: "document/reload",
    documentId,
    document,
    expectedText,
    expectedRevision,
    allowDirty,
  };
}

export function markDocumentSaved(
  documentId: DocumentId,
  savedText: string,
  diskMtimeMs: number,
  diskRevision?: string,
): AppStateAction {
  return { type: "document/mark-saved", documentId, savedText, diskMtimeMs, diskRevision };
}

/** Move an open session to its Save As path without losing shared Tab history. */
export function relocateDocument(
  documentId: DocumentId,
  document: OpenDocument,
  savedText: string,
): AppStateAction {
  return { type: "document/relocate", documentId, document, savedText };
}
