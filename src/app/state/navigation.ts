import {
  createViewState,
  MAX_NAVIGATION_VISITS,
  type AppState,
  type HistoryEntry,
  type NavigationTrail,
  type NavigationVisit,
  type Tab,
  type ViewState,
} from "./model";

export function copyNavigationEntry(entry: HistoryEntry, view = entry.view): HistoryEntry {
  return { ...entry, view: createViewState(view) };
}

export function sameView(left: ViewState, right: ViewState): boolean {
  return (
    left.anchor === right.anchor &&
    left.editorMode === right.editorMode &&
    left.sourceScrollTop === right.sourceScrollTop &&
    left.visualScrollTop === right.visualScrollTop &&
    left.selectionFrom === right.selectionFrom &&
    left.selectionTo === right.selectionTo &&
    left.visualSelectionFrom === right.visualSelectionFrom &&
    left.visualSelectionTo === right.visualSelectionTo
  );
}

function sameDestination(left: HistoryEntry, right: HistoryEntry): boolean {
  return (
    left.documentId === right.documentId &&
    left.path === right.path &&
    left.view.anchor === right.view.anchor
  );
}

function lastDestinationIndex(entries: HistoryEntry[], entry: HistoryEntry): number {
  for (let index = entries.length - 1; index >= 0; index--) {
    if (sameDestination(entries[index]!, entry)) return index;
  }
  return -1;
}

function sameVisit(left: NavigationVisit, right: NavigationVisit): boolean {
  return (
    left.tabId === right.tabId &&
    sameDestination(left.entry, right.entry) &&
    sameView(left.entry.view, right.entry.view)
  );
}

function activeVisit(state: AppState): NavigationVisit | undefined {
  const tab = state.activeTabId ? state.tabs[state.activeTabId] : undefined;
  return tab ? { tabId: tab.id, entry: copyNavigationEntry(tab.current) } : undefined;
}

export function navigationVisitExists(state: AppState, visit: NavigationVisit): boolean {
  return Boolean(state.tabs[visit.tabId] && state.sessions[visit.entry.documentId]);
}

export function findNavigationIndex(state: AppState, direction: "back" | "forward") {
  const step = direction === "back" ? -1 : 1;
  for (
    let index = state.navigation.index + step;
    index >= 0 && index < state.navigation.visits.length;
    index += step
  ) {
    if (navigationVisitExists(state, state.navigation.visits[index]!)) return index;
  }
  return -1;
}

/** Refresh only the current visit. Scrolling must never create or truncate history. */
export function refreshNavigationView(state: AppState, view?: ViewState): NavigationTrail {
  const tab = state.activeTabId ? state.tabs[state.activeTabId] : undefined;
  const visit = state.navigation.visits[state.navigation.index];
  if (
    !tab ||
    !visit ||
    visit.tabId !== tab.id ||
    !sameDestination(visit.entry, tab.current) ||
    sameView(visit.entry.view, view ?? tab.current.view)
  )
    return state.navigation;
  const visits = [...state.navigation.visits];
  visits[state.navigation.index] = {
    tabId: tab.id,
    entry: copyNavigationEntry(tab.current, view),
  };
  return { ...state.navigation, visits };
}

export function recordNavigationVisit(
  previous: AppState,
  next: AppState,
  previousView?: ViewState,
): AppState {
  const destination = activeVisit(next);
  if (!destination) return next;
  const navigation = refreshNavigationView(previous, previousView);
  const current = navigation.visits[navigation.index];
  if (current && sameVisit(current, destination)) return { ...next, navigation };

  const visits = [...navigation.visits.slice(0, navigation.index + 1), destination].slice(
    -MAX_NAVIGATION_VISITS,
  );
  return { ...next, navigation: { visits, index: visits.length - 1 } };
}

/** Forget closed/deleted destinations without resurrecting tabs or changing close focus. */
export function reconcileNavigation(state: AppState): AppState {
  const { visits: previousVisits, index: previousIndex } = state.navigation;
  const visits: NavigationVisit[] = [];
  let nearestIndex = -1;
  let retainedCurrentIndex = -1;
  for (const [index, visit] of previousVisits.entries()) {
    if (!navigationVisitExists(state, visit)) continue;
    visits.push(visit);
    if (index <= previousIndex) nearestIndex = visits.length - 1;
    if (index === previousIndex) retainedCurrentIndex = visits.length - 1;
  }
  const current = activeVisit(state);
  if (!current) return { ...state, navigation: { visits: [], index: -1 } };

  const matchesCurrent = (visit: NavigationVisit) =>
    visit.tabId === current.tabId && sameDestination(visit.entry, current.entry);
  let index = retainedCurrentIndex;
  if (index < 0 || !matchesCurrent(visits[index]!)) {
    index = -1;
    for (
      let candidate = Math.min(nearestIndex, visits.length - 1);
      candidate >= 0;
      candidate--
    ) {
      if (matchesCurrent(visits[candidate]!)) {
        index = candidate;
        break;
      }
    }
    if (index < 0) index = visits.findIndex(matchesCurrent);
  }
  if (index >= 0) {
    visits[index] = current;
  } else {
    // A background-only tab can become visible for the first time after its neighbor closes.
    index = Math.min(nearestIndex + 1, visits.length);
    visits.splice(index, 0, current);
  }
  const excess = Math.max(0, visits.length - MAX_NAVIGATION_VISITS);
  return {
    ...state,
    navigation: { visits: visits.slice(excess), index: Math.max(0, index - excess) },
  };
}

/** Restore a window visit while retaining every other per-tab document reference. */
export function restoreTabVisit(
  tab: Tab,
  entry: HistoryEntry,
  direction: "back" | "forward",
): Tab {
  const current = copyNavigationEntry(entry);
  if (sameDestination(tab.current, entry)) return { ...tab, current };
  const backIndex = lastDestinationIndex(tab.back, entry);
  const forwardIndex = lastDestinationIndex(tab.forward, entry);
  if (backIndex >= 0 && (direction === "back" || forwardIndex < 0)) {
    return {
      ...tab,
      current,
      back: tab.back.slice(0, backIndex),
      forward: [
        ...tab.forward,
        copyNavigationEntry(tab.current),
        ...tab.back.slice(backIndex + 1).reverse(),
      ],
    };
  }
  if (forwardIndex >= 0) {
    return {
      ...tab,
      current,
      back: [
        ...tab.back,
        copyNavigationEntry(tab.current),
        ...tab.forward.slice(forwardIndex + 1).reverse(),
      ],
      forward: tab.forward.slice(0, forwardIndex),
    };
  }
  return {
    ...tab,
    current,
    back:
      direction === "forward" ? [...tab.back, copyNavigationEntry(tab.current)] : tab.back,
    forward:
      direction === "back"
        ? [...tab.forward, copyNavigationEntry(tab.current)]
        : tab.forward,
  };
}
