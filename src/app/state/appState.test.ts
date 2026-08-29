import { describe, expect, it } from "vitest";

import {
  appStateReducer,
  closeTab,
  createInitialAppState,
  createViewState,
  editDocument,
  goBack,
  goForward,
  markDocumentSaved,
  openInCurrent,
  openInNewTab,
  selectCanGoForward,
  selectCurrentSession,
  selectTab,
  updateView,
  type AppState,
  type OpenDocument,
} from ".";

function document(path: string, text = `# ${path}\n`): OpenDocument {
  return { path, text, diskMtimeMs: 1, mode: "normal" };
}

function reduce(state: AppState, ...actions: Parameters<typeof appStateReducer>[1][]) {
  return actions.reduce(appStateReducer, state);
}

describe("P1-STATE-01 navigation state", () => {
  it("AC-NAV-001 restores A and B view state across back and forward", () => {
    const viewA = createViewState({
      anchor: "intro",
      scrollTop: 120,
      selectionFrom: 4,
      selectionTo: 8,
    });
    const viewB = createViewState({
      anchor: "details",
      scrollTop: 640,
      selectionFrom: 12,
      selectionTo: 12,
    });

    let state = reduce(
      createInitialAppState(),
      openInNewTab("tab-1", document("/workspace/a.md")),
      openInCurrent("tab-1", document("/workspace/b.md"), viewA),
      updateView("tab-1", viewB),
    );

    state = appStateReducer(state, goBack("tab-1", viewB));
    expect(selectTab(state, "tab-1")?.current).toMatchObject({
      path: "/workspace/a.md",
      view: viewA,
    });

    state = appStateReducer(state, goForward("tab-1", viewA));
    expect(selectTab(state, "tab-1")?.current).toMatchObject({
      path: "/workspace/b.md",
      view: viewB,
    });
  });

  it("NAV-HISTORY-001 keeps each tab's history and view independent", () => {
    const firstView = createViewState({ scrollTop: 80, selectionFrom: 1 });
    const secondView = createViewState({ scrollTop: 900, selectionFrom: 9 });
    let state = reduce(
      createInitialAppState(),
      openInNewTab("tab-1", document("/workspace/a.md")),
      openInCurrent("tab-1", document("/workspace/b.md"), firstView),
      openInNewTab("tab-2", document("/workspace/a.md"), true, secondView),
      openInCurrent("tab-2", document("/workspace/c.md"), secondView),
    );

    state = appStateReducer(state, goBack("tab-1"));

    expect(selectTab(state, "tab-1")?.current.path).toBe("/workspace/a.md");
    expect(selectTab(state, "tab-1")?.current.view).toEqual(firstView);
    expect(selectTab(state, "tab-2")?.current.path).toBe("/workspace/c.md");
    expect(selectTab(state, "tab-2")?.back).toHaveLength(1);
  });

  it("NAV-SESSION-001 reuses one session and shares edits without sharing views", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("tab-1", document("/workspace/shared.md", "original")),
      openInNewTab("tab-2", document("/workspace/shared.md", "stale reload"), false),
      updateView("tab-1", createViewState({ scrollTop: 45, selectionFrom: 3 })),
      editDocument("/workspace/shared.md", "edited in tab 1"),
    );

    expect(Object.keys(state.sessions)).toEqual(["/workspace/shared.md"]);
    expect(selectCurrentSession(state, "tab-1")).toBe(selectCurrentSession(state, "tab-2"));
    expect(selectCurrentSession(state, "tab-2")).toMatchObject({
      text: "edited in tab 1",
      dirty: true,
    });
    expect(selectTab(state, "tab-1")?.current.view.scrollTop).toBe(45);
    expect(selectTab(state, "tab-2")?.current.view.scrollTop).toBe(0);

    state = appStateReducer(
      state,
      markDocumentSaved("/workspace/shared.md", "edited in tab 1", 2),
    );
    expect(selectCurrentSession(state, "tab-1")).toMatchObject({
      diskMtimeMs: 2,
      dirty: false,
    });

    state = reduce(
      state,
      editDocument("/workspace/shared.md", "edited while saving"),
      markDocumentSaved("/workspace/shared.md", "edited in tab 1", 3),
    );
    expect(selectCurrentSession(state, "tab-2")?.dirty).toBe(true);
  });

  it("NAV-HISTORY-001 clears forward history after navigating from a back entry", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("tab-1", document("/workspace/a.md")),
      openInCurrent("tab-1", document("/workspace/b.md")),
      openInCurrent("tab-1", document("/workspace/c.md")),
      goBack("tab-1"),
    );

    expect(selectCanGoForward(state, "tab-1")).toBe(true);
    state = appStateReducer(state, openInCurrent("tab-1", document("/workspace/d.md")));

    expect(selectTab(state, "tab-1")?.current.path).toBe("/workspace/d.md");
    expect(selectTab(state, "tab-1")?.back.map((entry) => entry.path)).toEqual([
      "/workspace/a.md",
      "/workspace/b.md",
    ]);
    expect(selectCanGoForward(state, "tab-1")).toBe(false);
  });

  it("NAV-TAB-001 closes tabs and activates the right neighbor then the left", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("tab-1", document("/workspace/a.md")),
      openInNewTab("tab-2", document("/workspace/b.md"), false),
      openInNewTab("tab-3", document("/workspace/c.md"), false),
      closeTab("tab-1"),
    );

    expect(state.tabOrder).toEqual(["tab-2", "tab-3"]);
    expect(state.activeTabId).toBe("tab-2");

    state = reduce(state, closeTab("tab-3"), closeTab("tab-2"));
    expect(state.tabOrder).toEqual([]);
    expect(state.activeTabId).toBeNull();
    expect(state.sessions["/workspace/a.md"]).toBeDefined();
  });
});
