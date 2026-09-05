import { MAX_NAVIGATION_VISITS, type AppState, type HistoryEntry } from "./model";

/** Retain recent per-tab history plus one owner for older drafts/window visits. */
export function reclaimDocumentHistory(state: AppState): AppState {
  let tabs = state.tabs;
  const visitedDocuments = new Map<string, Set<string>>();
  for (const visit of state.navigation.visits) {
    const documents = visitedDocuments.get(visit.tabId) ?? new Set<string>();
    documents.add(visit.entry.documentId);
    visitedDocuments.set(visit.tabId, documents);
  }
  for (const tab of Object.values(state.tabs)) {
    if (
      tab.back.length <= MAX_NAVIGATION_VISITS &&
      tab.forward.length <= MAX_NAVIGATION_VISITS
    )
      continue;
    const recentBack = tab.back.slice(-MAX_NAVIGATION_VISITS);
    const recentForward = tab.forward.slice(-MAX_NAVIGATION_VISITS);
    const needed = new Set(visitedDocuments.get(tab.id));
    for (const entry of [...tab.back, ...tab.forward]) {
      if (state.sessions[entry.documentId]?.dirty) needed.add(entry.documentId);
    }
    for (const entry of [tab.current, ...recentBack, ...recentForward]) {
      needed.delete(entry.documentId);
    }
    const olderOwners = (history: HistoryEntry[]) => {
      const retained: HistoryEntry[] = [];
      for (let index = history.length - MAX_NAVIGATION_VISITS - 1; index >= 0; index--) {
        const entry = history[index]!;
        if (!needed.delete(entry.documentId)) continue;
        retained.push(entry);
      }
      return retained.reverse();
    };
    const back = [...olderOwners(tab.back), ...recentBack];
    const forward = [...olderOwners(tab.forward), ...recentForward];
    if (back.length === tab.back.length && forward.length === tab.forward.length) continue;
    if (tabs === state.tabs) tabs = { ...tabs };
    tabs[tab.id] = { ...tab, back, forward };
  }

  const referenced = new Set<string>();
  for (const tab of Object.values(tabs)) {
    for (const entry of [tab.current, ...tab.back, ...tab.forward]) {
      referenced.add(entry.documentId);
    }
  }
  let sessions = state.sessions;
  for (const id of Object.keys(sessions)) {
    if (referenced.has(id)) continue;
    // Orphaned clean bodies are re-read when opened; they are not a useful cache.
    // Dirty orphans are removed only by explicit close/discard, never by retention.
    if (sessions[id]!.dirty) continue;
    if (sessions === state.sessions) sessions = { ...sessions };
    delete sessions[id];
  }
  return tabs === state.tabs && sessions === state.sessions
    ? state
    : { ...state, tabs, sessions };
}
