import type { AppState, DocumentId, DocumentSession, Tab, TabId } from "./model";

export function selectTab(state: AppState, tabId: TabId): Tab | undefined {
  return state.tabs[tabId];
}

export function selectActiveTab(state: AppState): Tab | undefined {
  return state.activeTabId === null ? undefined : state.tabs[state.activeTabId];
}

export function selectOrderedTabs(state: AppState): Tab[] {
  return state.tabOrder.flatMap((tabId) => {
    const tab = state.tabs[tabId];
    return tab ? [tab] : [];
  });
}

export function selectSession(
  state: AppState,
  documentId: DocumentId,
): DocumentSession | undefined {
  return state.sessions[documentId];
}

export function selectCurrentSession(
  state: AppState,
  tabId: TabId,
): DocumentSession | undefined {
  const tab = state.tabs[tabId];
  return tab ? state.sessions[tab.current.documentId] : undefined;
}

export function selectCanGoBack(state: AppState, tabId: TabId): boolean {
  return (state.tabs[tabId]?.back.length ?? 0) > 0;
}

export function selectCanGoForward(state: AppState, tabId: TabId): boolean {
  return (state.tabs[tabId]?.forward.length ?? 0) > 0;
}
