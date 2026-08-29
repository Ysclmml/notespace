import type { AppStateAction } from "./actions";
import {
  createViewState,
  documentIdFromPath,
  type AppState,
  type DocumentSession,
  type HistoryEntry,
  type OpenDocument,
  type Tab,
  type ViewState,
} from "./model";

function copyView(view: ViewState): ViewState {
  return createViewState(view);
}

function copyEntryWithView(entry: HistoryEntry, view?: ViewState): HistoryEntry {
  return {
    ...entry,
    view: copyView(view ?? entry.view),
  };
}

function entryFor(document: OpenDocument, view?: ViewState): HistoryEntry {
  return {
    documentId: documentIdFromPath(document.path),
    path: document.path,
    view: copyView(view ?? createViewState()),
  };
}

function sessionsWithDocument(
  sessions: AppState["sessions"],
  document: OpenDocument,
): AppState["sessions"] {
  const documentId = documentIdFromPath(document.path);
  if (sessions[documentId]) return sessions;

  const session: DocumentSession = {
    id: documentId,
    path: document.path,
    text: document.text,
    diskMtimeMs: document.diskMtimeMs,
    dirty: false,
    mode: document.mode,
  };

  return { ...sessions, [documentId]: session };
}

function moveBack(tab: Tab, currentView?: ViewState): Tab {
  const destination = tab.back.at(-1);
  if (!destination) return tab;

  return {
    ...tab,
    current: copyEntryWithView(destination),
    back: tab.back.slice(0, -1),
    forward: [...tab.forward, copyEntryWithView(tab.current, currentView)],
  };
}

function moveForward(tab: Tab, currentView?: ViewState): Tab {
  const destination = tab.forward.at(-1);
  if (!destination) return tab;

  return {
    ...tab,
    current: copyEntryWithView(destination),
    back: [...tab.back, copyEntryWithView(tab.current, currentView)],
    forward: tab.forward.slice(0, -1),
  };
}

export function appStateReducer(state: AppState, action: AppStateAction): AppState {
  switch (action.type) {
    case "tab/open-current": {
      const tab = state.tabs[action.tabId];
      if (!tab) return state;

      return {
        ...state,
        sessions: sessionsWithDocument(state.sessions, action.document),
        tabs: {
          ...state.tabs,
          [action.tabId]: {
            ...tab,
            current: entryFor(action.document, action.targetView),
            back: [...tab.back, copyEntryWithView(tab.current, action.previousView)],
            forward: [],
          },
        },
      };
    }

    case "tab/open-new": {
      if (state.tabs[action.tabId]) return state;

      const tab: Tab = {
        id: action.tabId,
        current: entryFor(action.document, action.view),
        back: [],
        forward: [],
      };

      return {
        ...state,
        sessions: sessionsWithDocument(state.sessions, action.document),
        tabs: { ...state.tabs, [action.tabId]: tab },
        tabOrder: [...state.tabOrder, action.tabId],
        activeTabId:
          action.active || state.activeTabId === null ? action.tabId : state.activeTabId,
      };
    }

    case "tab/go-back": {
      const tab = state.tabs[action.tabId];
      if (!tab || tab.back.length === 0) return state;
      return {
        ...state,
        tabs: { ...state.tabs, [action.tabId]: moveBack(tab, action.currentView) },
      };
    }

    case "tab/go-forward": {
      const tab = state.tabs[action.tabId];
      if (!tab || tab.forward.length === 0) return state;
      return {
        ...state,
        tabs: { ...state.tabs, [action.tabId]: moveForward(tab, action.currentView) },
      };
    }

    case "tab/update-view": {
      const tab = state.tabs[action.tabId];
      if (!tab) return state;
      return {
        ...state,
        tabs: {
          ...state.tabs,
          [action.tabId]: {
            ...tab,
            current: copyEntryWithView(tab.current, action.view),
          },
        },
      };
    }

    case "tab/activate":
      if (!state.tabs[action.tabId] || state.activeTabId === action.tabId) return state;
      return { ...state, activeTabId: action.tabId };

    case "tab/close": {
      const closingIndex = state.tabOrder.indexOf(action.tabId);
      if (closingIndex === -1) return state;

      const tabs = { ...state.tabs };
      delete tabs[action.tabId];
      const tabOrder = state.tabOrder.filter((tabId) => tabId !== action.tabId);
      const activeTabId =
        state.activeTabId === action.tabId
          ? (tabOrder[Math.min(closingIndex, tabOrder.length - 1)] ?? null)
          : state.activeTabId;

      return { ...state, tabs, tabOrder, activeTabId };
    }

    case "document/edit": {
      const session = state.sessions[action.documentId];
      if (!session || session.text === action.text) return state;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.documentId]: { ...session, text: action.text, dirty: true },
        },
      };
    }

    case "document/mark-saved": {
      const session = state.sessions[action.documentId];
      if (!session) return state;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.documentId]: {
            ...session,
            diskMtimeMs: action.diskMtimeMs,
            dirty: session.text !== action.savedText,
          },
        },
      };
    }
  }
}
