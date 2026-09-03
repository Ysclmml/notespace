import type {
  AppState,
  DocumentId,
  DocumentSession,
  EditorGroup,
  EditorGroupId,
  Tab,
  TabId,
  NavigationVisit,
} from "./model";
import { findNavigationIndex } from "./navigation";

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

export function selectActiveEditorGroup(state: AppState): EditorGroup | undefined {
  return state.editorGroups.find((group) => group.id === state.activeEditorGroupId);
}

export function selectTabGroupId(state: AppState, tabId: TabId): EditorGroupId | undefined {
  return state.editorGroups.find((group) => group.tabIds.includes(tabId))?.id;
}

export function selectEditorGroups(
  state: AppState,
): { id: EditorGroupId; tabs: Tab[]; activeTab: Tab | undefined }[] {
  return state.editorGroups.map((group) => ({
    id: group.id,
    tabs: group.tabIds.flatMap((tabId) => (state.tabs[tabId] ? [state.tabs[tabId]] : [])),
    activeTab: group.activeTabId === null ? undefined : state.tabs[group.activeTabId],
  }));
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

export function selectNavigationDestination(
  state: AppState,
  direction: "back" | "forward",
): NavigationVisit | undefined {
  return state.navigation.visits[findNavigationIndex(state, direction)];
}

export function selectCanNavigateBack(state: AppState): boolean {
  return findNavigationIndex(state, "back") >= 0;
}

export function selectCanNavigateForward(state: AppState): boolean {
  return findNavigationIndex(state, "forward") >= 0;
}
