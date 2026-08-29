import type { DocumentId, OpenDocument, TabId, ViewState } from "./model";

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
    }
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
  | { type: "tab/activate"; tabId: TabId }
  | { type: "tab/close"; tabId: TabId }
  | { type: "document/edit"; documentId: DocumentId; text: string }
  | {
      type: "document/mark-saved";
      documentId: DocumentId;
      savedText: string;
      diskMtimeMs: number;
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
): AppStateAction {
  return { type: "tab/open-new", tabId, document, active, view };
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

export function activateTab(tabId: TabId): AppStateAction {
  return { type: "tab/activate", tabId };
}

export function closeTab(tabId: TabId): AppStateAction {
  return { type: "tab/close", tabId };
}

export function editDocument(documentId: DocumentId, text: string): AppStateAction {
  return { type: "document/edit", documentId, text };
}

export function markDocumentSaved(
  documentId: DocumentId,
  savedText: string,
  diskMtimeMs: number,
): AppStateAction {
  return { type: "document/mark-saved", documentId, savedText, diskMtimeMs };
}
