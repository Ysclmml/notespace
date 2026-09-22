import type { AppState, Tab } from "../../app/state";

export type TabCloseScope = "all" | "left" | "right";

export interface PendingCloseRequest {
  readonly kind: "tabs" | "window";
  readonly tabIds: readonly string[];
  // Consent applies only to the text the user reviewed, and never survives Cancel.
  readonly discardedTexts: ReadonlyMap<string, string>;
}

export function tabsToClose(state: AppState, tabId: string, scope: TabCloseScope) {
  if (!state.tabs[tabId]) return [];
  if (scope === "all") return [...state.tabOrder];
  const group = state.editorGroups.find((item) => item.tabIds.includes(tabId));
  if (!group) return [];
  const index = group.tabIds.indexOf(tabId);
  return scope === "left" ? group.tabIds.slice(0, index) : group.tabIds.slice(index + 1);
}

function documents(tab: Tab) {
  return [tab.current, ...tab.back, ...tab.forward].map((entry) => entry.documentId);
}

export function closingDirtyDocumentIds(state: AppState, request: PendingCloseRequest) {
  const targets = new Set(request.kind === "window" ? state.tabOrder : request.tabIds);
  const retained = new Set(
    state.tabOrder.flatMap((id) =>
      !targets.has(id) && state.tabs[id] ? documents(state.tabs[id]) : [],
    ),
  );
  const candidates = new Set(
    [...targets].flatMap((id) => (state.tabs[id] ? documents(state.tabs[id]) : [])),
  );
  return [...candidates].filter((id) => {
    const session = state.sessions[id];
    return (
      session?.dirty && !retained.has(id) && request.discardedTexts.get(id) !== session.text
    );
  });
}
