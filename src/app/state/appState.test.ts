import { describe, expect, it } from "vitest";

import {
  appStateReducer,
  closeTab,
  createInitialAppState,
  createViewState,
  discardDocuments,
  editDocument,
  goBack,
  goForward,
  markDocumentSaved,
  openInCurrent,
  openInNewTab,
  relocateDocument,
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
      visualScrollTop: 120,
      selectionFrom: 4,
      selectionTo: 8,
    });
    const viewB = createViewState({
      anchor: "details",
      visualScrollTop: 640,
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
    const firstView = createViewState({ visualScrollTop: 80, selectionFrom: 1 });
    const secondView = createViewState({ visualScrollTop: 900, selectionFrom: 9 });
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
      updateView("tab-1", createViewState({ visualScrollTop: 45, selectionFrom: 3 })),
      editDocument("/workspace/shared.md", "edited in tab 1"),
    );

    expect(Object.keys(state.sessions)).toEqual(["/workspace/shared.md"]);
    expect(selectCurrentSession(state, "tab-1")).toBe(selectCurrentSession(state, "tab-2"));
    expect(selectCurrentSession(state, "tab-2")).toMatchObject({
      text: "edited in tab 1",
      dirty: true,
    });
    expect(selectTab(state, "tab-1")?.current.view.visualScrollTop).toBe(45);
    expect(selectTab(state, "tab-2")?.current.view.visualScrollTop).toBe(0);

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

  it("keeps visual/source choice with each tab history entry", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab(
        "tab-1",
        document("/workspace/a.md"),
        true,
        createViewState({ editorMode: "source", sourceScrollTop: 90 }),
      ),
      openInCurrent(
        "tab-1",
        document("/workspace/b.md"),
        createViewState({ editorMode: "source", sourceScrollTop: 90 }),
        createViewState({ editorMode: "visual" }),
      ),
    );

    expect(selectTab(state, "tab-1")?.current.view.editorMode).toBe("visual");
    state = appStateReducer(state, goBack("tab-1"));
    expect(selectTab(state, "tab-1")?.current.view).toMatchObject({
      editorMode: "source",
      sourceScrollTop: 90,
    });
  });

  it("keeps visual and source scroll positions independent in one history entry", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("tab-1", document("/workspace/a.md")),
      updateView("tab-1", createViewState({ visualScrollTop: 480, sourceScrollTop: 72 })),
    );

    state = appStateReducer(
      state,
      updateView(
        "tab-1",
        createViewState({
          ...selectTab(state, "tab-1")?.current.view,
          editorMode: "source",
          sourceScrollTop: 360,
        }),
      ),
    );

    expect(selectTab(state, "tab-1")?.current.view).toMatchObject({
      editorMode: "source",
      visualScrollTop: 480,
      sourceScrollTop: 360,
    });
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

  it("discards deleted documents from current and history without leaving stale tabs", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("tab-1", document("/workspace/00.md", "zero")),
      openInCurrent("tab-1", document("/workspace/01.md", "one")),
      openInCurrent("tab-1", document("/workspace/02.md", "two")),
      openInNewTab("tab-2", document("/workspace/removed.md", "removed"), true),
    );

    state = reduce(
      state,
      discardDocuments(["/workspace/00.md", "/workspace/02.md", "/workspace/removed.md"]),
    );

    expect(state.sessions["/workspace/00.md"]).toBeUndefined();
    expect(state.sessions["/workspace/02.md"]).toBeUndefined();
    expect(state.sessions["/workspace/removed.md"]).toBeUndefined();
    expect(state.tabs["tab-1"]?.current.documentId).toBe("/workspace/01.md");
    expect(state.tabs["tab-1"]?.back).toEqual([]);
    expect(state.tabs["tab-2"]).toBeUndefined();
    expect(state.tabOrder).toEqual(["tab-1"]);
    expect(state.activeTabId).toBe("tab-1");
  });

  it("moves an untitled session and every shared history entry after Save As", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("tab-1", document("untitled://Untitled-1.md", "draft")),
      openInCurrent("tab-1", document("/workspace/other.md")),
      openInNewTab("tab-2", document("untitled://Untitled-1.md", "stale")),
      editDocument("untitled://Untitled-1.md", "draft while saving"),
    );

    state = appStateReducer(
      state,
      relocateDocument(
        "untitled://Untitled-1.md",
        {
          path: "/workspace/note.md",
          text: "draft",
          diskMtimeMs: 42,
          mode: "normal",
          kind: "markdown",
          language: "markdown",
        },
        "draft",
      ),
    );

    expect(state.sessions["untitled://Untitled-1.md"]).toBeUndefined();
    expect(state.sessions["/workspace/note.md"]).toMatchObject({
      path: "/workspace/note.md",
      text: "draft while saving",
      dirty: true,
      diskMtimeMs: 42,
    });
    expect(state.tabs["tab-1"]?.back[0]).toMatchObject({
      documentId: "/workspace/note.md",
      path: "/workspace/note.md",
    });
    expect(state.tabs["tab-2"]?.current).toMatchObject({
      documentId: "/workspace/note.md",
      path: "/workspace/note.md",
    });
  });
});
