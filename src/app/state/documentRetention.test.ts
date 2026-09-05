import { describe, expect, it } from "vitest";
import {
  activateTab,
  appStateReducer,
  closeTab,
  createInitialAppState,
  editDocument,
  goNavigationBack,
  goNavigationForward,
  markDocumentSaved,
  MAX_NAVIGATION_VISITS,
  openInCurrent,
  openInNewTab,
  openPreviewTab,
  type AppState,
} from ".";

const document = (id: number) => ({
  path: `/retention-fixture/${id}.md`,
  text: `document ${id}`,
  diskMtimeMs: 1,
  mode: "normal" as const,
});
const historyIds = (state: AppState, tabId: string) => {
  const tab = state.tabs[tabId]!;
  return [tab.current, ...tab.back, ...tab.forward].map((entry) => entry.documentId);
};

describe("document history retention", () => {
  it("bounds long preview browsing, preserves the window trail, and releases closed bodies", () => {
    let state = createInitialAppState();
    for (let index = 0; index < 1100; index++) {
      state = appStateReducer(state, openPreviewTab(`candidate-${index}`, document(index)));
    }
    const tabId = state.activeTabId!;
    expect(state.tabOrder).toEqual([tabId]);
    expect(state.tabs[tabId]!.back).toHaveLength(MAX_NAVIGATION_VISITS);
    expect(Object.keys(state.sessions)).toHaveLength(MAX_NAVIGATION_VISITS + 1);
    const destinations = state.navigation.visits.map((visit) => visit.entry.documentId);
    for (let index = destinations.length - 2; index >= 0; index--) {
      state = appStateReducer(state, goNavigationBack());
      expect(state.tabs[tabId]!.current.documentId).toBe(destinations[index]);
    }
    for (let index = 1; index < destinations.length; index++) {
      state = appStateReducer(state, goNavigationForward());
      expect(state.tabs[tabId]!.current.documentId).toBe(destinations[index]);
    }
    state = appStateReducer(state, closeTab(tabId));
    expect(state.sessions).toEqual({});
    expect(state.navigation.visits).toEqual([]);
  });

  it("keeps the last historical owner of an old draft until it is saved or explicitly closed", () => {
    let state = appStateReducer(
      createInitialAppState(),
      openInNewTab("owner", document(0)),
    );
    state = appStateReducer(state, editDocument(document(0).path, "unsaved draft"));
    for (let index = 1; index < 450; index++) {
      state = appStateReducer(state, openInCurrent("owner", document(index)));
    }
    expect(state.sessions[document(0).path]?.text).toBe("unsaved draft");
    expect(historyIds(state, "owner").filter((id) => id === document(0).path)).toHaveLength(
      1,
    );
    expect(state.tabs.owner!.back).toHaveLength(MAX_NAVIGATION_VISITS + 1);

    const closed = appStateReducer(state, closeTab("owner"));
    expect(closed.sessions).toEqual({});
    state = appStateReducer(state, markDocumentSaved(document(0).path, "unsaved draft", 2));
    expect(state.sessions[document(0).path]).toBeUndefined();
    expect(state.tabs.owner!.back).toHaveLength(MAX_NAVIGATION_VISITS);
  });

  it("retains an old window destination while its unfocused tab navigates beyond the history limit", () => {
    let state = appStateReducer(createInitialAppState(), openInNewTab("left", document(0)));
    state = appStateReducer(state, openInNewTab("right", document(1)));
    for (let index = 2; index < 450; index++) {
      state = appStateReducer(state, openInCurrent("left", document(index)));
    }
    expect(state.activeTabId).toBe("right");
    expect(state.sessions[document(0).path]).toBeDefined();
    state = appStateReducer(state, goNavigationBack());
    expect(state.activeTabId).toBe("left");
    expect(state.tabs.left!.current.path).toBe(document(0).path);
    state = appStateReducer(state, activateTab("right"));
    state = appStateReducer(state, closeTab("left"));
    expect(Object.keys(state.sessions)).toEqual([document(1).path]);
  });

  it("does not accumulate repeated old references even when the same document stays dirty", () => {
    let state = appStateReducer(
      createInitialAppState(),
      openInNewTab("owner", document(0)),
    );
    state = appStateReducer(state, editDocument(document(0).path, "draft"));
    for (let index = 1; index < 900; index++) {
      state = appStateReducer(state, openInCurrent("owner", document(index % 2)));
    }
    expect(state.tabs.owner!.back.length).toBeLessThanOrEqual(MAX_NAVIGATION_VISITS + 1);
    expect(Object.keys(state.sessions)).toHaveLength(2);
    expect(state.sessions[document(0).path]?.text).toBe("draft");
  });
});
