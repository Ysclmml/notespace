import { describe, expect, it } from "vitest";

import {
  activateEditorGroup,
  activateTab,
  appStateReducer,
  closeTab,
  createInitialAppState,
  createViewState,
  discardDocuments,
  editDocument,
  goBack,
  goForward,
  INITIAL_EDITOR_GROUP_ID,
  keepTabOpen,
  markDocumentSaved,
  moveTabToGroup,
  openInCurrent,
  openInNewTab,
  openPreviewTab,
  relocateDocument,
  selectActiveEditorGroup,
  selectActiveTab,
  selectCurrentSession,
  selectEditorGroups,
  selectTabGroupId,
  splitTabRight,
  updateView,
  type AppState,
  type AppStateAction,
  type OpenDocument,
} from ".";

function document(path: string, kind: "markdown" | "text" = "markdown"): OpenDocument {
  return {
    path,
    text: kind === "markdown" ? "# Original\n" : "const original = true;\n",
    kind,
    language: kind === "markdown" ? "markdown" : "javascript",
    diskMtimeMs: 1,
    mode: "normal",
  };
}

function expectGroupInvariants(state: AppState) {
  expect(state.editorGroups.length).toBeGreaterThan(0);
  expect(state.editorGroups.flatMap((group) => group.tabIds)).toEqual(state.tabOrder);
  expect(new Set(state.tabOrder).size).toBe(state.tabOrder.length);
  expect(new Set(state.editorGroups.map((group) => group.id)).size).toBe(
    state.editorGroups.length,
  );
  expect([...state.tabOrder].sort()).toEqual(Object.keys(state.tabs).sort());
  expect(selectActiveEditorGroup(state)?.activeTabId).toBe(state.activeTabId);
  for (const group of state.editorGroups) {
    expect(group.tabIds.filter((id) => state.tabs[id]?.preview).length).toBeLessThanOrEqual(
      1,
    );
    if (group.tabIds.length > 0) {
      expect(group.tabIds).toContain(group.activeTabId);
    } else {
      expect(state.editorGroups).toHaveLength(1);
      expect(group.activeTabId).toBeNull();
    }
  }
}

function reduce(state: AppState, ...actions: AppStateAction[]) {
  return actions.reduce((current, action) => {
    const next = appStateReducer(current, action);
    expectGroupInvariants(next);
    return next;
  }, state);
}

describe("horizontal editor groups", () => {
  it("starts and returns to a single empty group", () => {
    const initial = createInitialAppState();
    expectGroupInvariants(initial);
    expect(selectEditorGroups(initial)).toEqual([
      { id: INITIAL_EDITOR_GROUP_ID, tabs: [], activeTab: undefined },
    ]);
    const state = reduce(
      initial,
      openInNewTab("a", document("/workspace/a.md")),
      closeTab("a"),
    );
    expect(selectEditorGroups(state)).toEqual(selectEditorGroups(initial));
    expect(selectActiveTab(state)).toBeUndefined();
  });

  it.each(["markdown", "text"] as const)(
    "splits %s with shared dirty body and independent navigation/views",
    (kind) => {
      const view = createViewState({
        editorMode: "source",
        sourceScrollTop: 420,
        visualScrollTop: 210,
        selectionFrom: 8,
        selectionTo: 14,
      });
      let state = reduce(
        createInitialAppState(),
        openInNewTab("a", document("/workspace/a", kind), true, view),
        openInCurrent("a", document("/workspace/b", kind), view),
        openInCurrent("a", document("/workspace/c", kind)),
        goBack("a"),
        updateView("a", view),
        editDocument("/workspace/b", "shared edit"),
        splitTabRight("a", "copy", "right"),
      );
      expect(selectCurrentSession(state, "a")).toBe(selectCurrentSession(state, "copy"));
      expect(selectCurrentSession(state, "copy")).toMatchObject({
        kind,
        text: "shared edit",
        dirty: true,
      });
      expect(state.tabs.copy).toEqual({ ...state.tabs.a, id: "copy" });
      expect(state.tabs.copy?.current.view).not.toBe(state.tabs.a?.current.view);
      expect(state.tabs.copy?.back[0]?.view).not.toBe(state.tabs.a?.back[0]?.view);
      expect(state.tabs.copy?.forward[0]?.view).not.toBe(state.tabs.a?.forward[0]?.view);
      state = reduce(
        state,
        goBack("copy"),
        updateView("a", createViewState({ sourceScrollTop: 900 })),
      );
      expect(state.tabs.a?.current.path).toBe("/workspace/b");
      expect(state.tabs.copy?.current.path).toBe("/workspace/a");
      expect(state.tabs.copy?.current.view).toEqual(view);
      expect(state.tabs.a?.current.view.sourceScrollTop).toBe(900);
      state = reduce(
        state,
        goForward("copy"),
        markDocumentSaved("/workspace/b", "shared edit", 2),
      );
      expect(selectCurrentSession(state, "copy")?.dirty).toBe(false);
      expect(state.activeTabId).toBe("copy");
    },
  );

  it("inserts a split beside its source and keeps every group's active tab", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("a", document("/workspace/a.md")),
      openInNewTab("b", document("/workspace/b.md")),
      splitTabRight("a", "right-tab", "right"),
      splitTabRight("a", "middle-tab", "middle"),
    );
    expect(state.editorGroups.map((group) => group.id)).toEqual([
      INITIAL_EDITOR_GROUP_ID,
      "middle",
      "right",
    ]);
    expect(state.editorGroups.map((group) => group.activeTabId)).toEqual([
      "b",
      "middle-tab",
      "right-tab",
    ]);
    state = reduce(state, activateTab("a"), activateEditorGroup("right"));
    expect(state.activeTabId).toBe("right-tab");
    expect(state.editorGroups.map((group) => group.activeTabId)).toEqual([
      "a",
      "middle-tab",
      "right-tab",
    ]);
    expect(selectTabGroupId(state, "a")).toBe(INITIAL_EDITOR_GROUP_ID);
    expect(selectTabGroupId(state, "missing")).toBeUndefined();
  });

  it("opens new tabs in the focused or explicitly requested group", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("a", document("/workspace/a.md")),
      splitTabRight("a", "copy", "right"),
      openInNewTab("background", document("/workspace/b.md"), false),
      openInNewTab(
        "left-background",
        document("/workspace/c.md"),
        false,
        undefined,
        INITIAL_EDITOR_GROUP_ID,
      ),
    );
    expect(state.activeTabId).toBe("copy");
    expect(state.editorGroups[0]?.activeTabId).toBe("a");
    expect(selectTabGroupId(state, "background")).toBe("right");
    expect(selectTabGroupId(state, "left-background")).toBe(INITIAL_EDITOR_GROUP_ID);
    state = reduce(
      state,
      openInNewTab(
        "left-active",
        document("/workspace/d.md"),
        true,
        undefined,
        INITIAL_EDITOR_GROUP_ID,
      ),
    );
    expect(state.activeTabId).toBe("left-active");
    expect(state.editorGroups[1]?.activeTabId).toBe("copy");
  });

  it("moves/reorders tabs without changing their history, view or body", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("a", document("/workspace/a.md")),
      openInNewTab("b", document("/workspace/b.md")),
      openInCurrent("b", document("/workspace/c.md")),
      updateView("b", createViewState({ visualScrollTop: 400 })),
      editDocument("/workspace/c.md", "unsaved"),
      splitTabRight("a", "copy", "right"),
    );
    const tab = state.tabs.b;
    const session = state.sessions["/workspace/c.md"];
    state = reduce(state, moveTabToGroup("b", "right", "copy"));
    expect(state.tabs.b).toBe(tab);
    expect(state.sessions["/workspace/c.md"]).toBe(session);
    expect(state.editorGroups[1]?.tabIds).toEqual(["b", "copy"]);
    expect(state.activeTabId).toBe("b");
    state = reduce(state, moveTabToGroup("b", "right"));
    expect(state.editorGroups[1]?.tabIds).toEqual(["copy", "b"]);
    state = reduce(state, moveTabToGroup("a", "right", "b"));
    expect(state.editorGroups).toHaveLength(1);
    expect(state.editorGroups[0]?.tabIds).toEqual(["copy", "a", "b"]);
    expect(state.activeEditorGroupId).toBe("right");
  });

  it("closing tabs in another group updates that group without stealing focus", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("a", document("/workspace/a.md")),
      openInNewTab("b", document("/workspace/b.md")),
      splitTabRight("a", "right-tab", "right"),
      closeTab("b"),
    );
    expect(state.activeTabId).toBe("right-tab");
    expect(state.editorGroups[0]?.activeTabId).toBe("a");
    state = reduce(state, closeTab("a"));
    expect(state.editorGroups.map((group) => group.id)).toEqual(["right"]);
    expect(state.activeTabId).toBe("right-tab");
    state = reduce(state, closeTab("right-tab"));
    expect(state.activeTabId).toBeNull();
    expect(state.editorGroups).toEqual([{ id: "right", tabIds: [], activeTabId: null }]);
  });

  it.each(["markdown", "text"] as const)(
    "reopening %s after discarding its last tab uses freshly read disk text",
    (kind) => {
      const path = "/workspace/discarded";
      let state = reduce(
        createInitialAppState(),
        openInNewTab("clean", document("/workspace/clean.md")),
        openInNewTab("edited", document(path, kind)),
        editDocument(path, "discard this unsaved text"),
      );
      const cleanSession = state.sessions["/workspace/clean.md"];
      state = reduce(state, closeTab("edited"));
      expect(state.sessions[path]).toBeUndefined();
      expect(state.sessions["/workspace/clean.md"]).toBe(cleanSession);

      const diskDocument = {
        ...document(path, kind),
        text: "fresh disk text",
        diskMtimeMs: 2,
      };
      state = reduce(state, openPreviewTab("reopened", diskDocument));
      expect(selectCurrentSession(state, "reopened")).toMatchObject({
        text: "fresh disk text",
        diskMtimeMs: 2,
        dirty: false,
        kind,
      });
      expect(state.tabs.reopened?.preview).toBe(true);
      state = reduce(state, closeTab("reopened"), closeTab("clean"));
      expect(state.sessions["/workspace/clean.md"]).toBe(cleanSession);
      expect(state.sessions[path]?.text).toBe("fresh disk text");
    },
  );

  it.each(["current", "back", "forward"] as const)(
    "retains shared dirty text referenced by another group's %s until its last tab closes",
    (reference) => {
      const sharedPath = "/workspace/shared.md";
      let state = reduce(
        createInitialAppState(),
        openInNewTab("source", document("/workspace/start.md")),
        openInCurrent("source", document(sharedPath)),
        editDocument(sharedPath, "keep while referenced"),
        splitTabRight("source", "copy", "right"),
      );
      if (reference === "back") {
        state = reduce(state, openInCurrent("copy", document("/workspace/next.md")));
      } else if (reference === "forward") {
        state = reduce(state, goBack("copy"));
      }
      const copiedTab = state.tabs.copy!;
      const entries = reference === "current" ? [copiedTab.current] : copiedTab[reference];
      expect(entries.some((entry) => entry.documentId === sharedPath)).toBe(true);
      const sharedSession = state.sessions[sharedPath];
      state = reduce(state, closeTab("source"));
      expect(state.sessions[sharedPath]).toBe(sharedSession);
      expect(state.sessions[sharedPath]).toMatchObject({
        text: "keep while referenced",
        dirty: true,
      });
      expect(state.editorGroups.map((group) => group.id)).toEqual(["right"]);
      state = reduce(state, closeTab("copy"));
      expect(state.sessions[sharedPath]).toBeUndefined();
      expect(state.sessions["/workspace/start.md"]).toBeDefined();
    },
  );

  it("closing the focused group chooses the right neighbor then the left", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("a", document("/workspace/a.md")),
      splitTabRight("a", "b", "middle"),
      splitTabRight("b", "c", "right"),
      activateEditorGroup("middle"),
      closeTab("b"),
    );
    expect(state.activeTabId).toBe("c");
    state = reduce(state, closeTab("c"));
    expect(state.activeTabId).toBe("a");
    expect(state.activeEditorGroupId).toBe(INITIAL_EDITOR_GROUP_ID);
  });

  it("discarding documents prunes all groups and chooses a surviving adjacent group", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("a", document("/workspace/a.md")),
      splitTabRight("a", "b", "second"),
      openInCurrent("b", document("/workspace/b.md")),
      splitTabRight("b", "c", "third"),
      openInCurrent("c", document("/workspace/c.md")),
      splitTabRight("c", "d", "fourth"),
      openInCurrent("d", document("/workspace/d.md")),
      activateTab("b"),
      discardDocuments(["/workspace/a.md", "/workspace/b.md"]),
    );
    expect(state.editorGroups.map((group) => group.id)).toEqual(["third", "fourth"]);
    expect(state.activeTabId).toBe("c");
    expect(state.tabs.c?.back).toEqual([]);
    expect(state.tabs.d?.back.map((entry) => entry.path)).toEqual(["/workspace/c.md"]);
    state = reduce(state, discardDocuments(["/workspace/c.md", "/workspace/d.md"]));
    expect(state.editorGroups).toHaveLength(1);
    expect(state.tabOrder).toEqual([]);
    expect(state.activeTabId).toBeNull();
  });

  it("Save As migrates all group histories and preserves edits that happened during saving", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("a", document("untitled://Draft.md")),
      splitTabRight("a", "b", "right"),
      openInCurrent("b", document("/workspace/b.md")),
      splitTabRight("b", "c", "far-right"),
      goBack("c"),
      editDocument("untitled://Draft.md", "latest"),
      relocateDocument("untitled://Draft.md", document("/workspace/saved.md"), "earlier"),
    );
    expect(state.sessions["untitled://Draft.md"]).toBeUndefined();
    expect(state.sessions["/workspace/saved.md"]).toMatchObject({
      text: "latest",
      dirty: true,
    });
    expect(state.tabs.a?.current.path).toBe("/workspace/saved.md");
    expect(state.tabs.b?.back[0]?.path).toBe("/workspace/saved.md");
    expect(state.tabs.c?.current.path).toBe("/workspace/saved.md");
    state = reduce(state, goForward("c"));
    expect(state.tabs.c?.back[0]?.documentId).toBe("/workspace/saved.md");
    expect(state.activeEditorGroupId).toBe("far-right");
  });

  it("rejects missing targets and duplicate ids without corrupting groups", () => {
    const state = reduce(
      createInitialAppState(),
      openInNewTab("a", document("/workspace/a.md")),
    );
    for (const action of [
      splitTabRight("missing", "copy", "right"),
      splitTabRight("a", "a", "right"),
      splitTabRight("a", "copy", INITIAL_EDITOR_GROUP_ID),
      activateEditorGroup("missing"),
      moveTabToGroup("missing", INITIAL_EDITOR_GROUP_ID),
      moveTabToGroup("a", "missing"),
      moveTabToGroup("a", INITIAL_EDITOR_GROUP_ID, "missing"),
      moveTabToGroup("a", INITIAL_EDITOR_GROUP_ID, "a"),
      openInNewTab("b", document("/workspace/b.md"), true, undefined, "missing"),
    ])
      expect(appStateReducer(state, action)).toBe(state);
  });
});

describe("file-tree preview tabs", () => {
  it("replaces the group's clean preview while retaining navigation history without extra tabs", () => {
    const state = reduce(
      createInitialAppState(),
      openPreviewTab("preview", document("/workspace/a.md")),
      openInCurrent("preview", document("/workspace/b.md")),
      openPreviewTab("unused-id", document("/workspace/c.md")),
    );
    expect(state.tabOrder).toEqual(["preview"]);
    expect(state.tabs.preview).toMatchObject({
      preview: true,
      current: { path: "/workspace/c.md" },
      back: [{ path: "/workspace/a.md" }, { path: "/workspace/b.md" }],
      forward: [],
    });
    expect(state.activeTabId).toBe("preview");
  });

  it("double-click keeps the current preview and subsequent clicks use a new preview", () => {
    let state = reduce(
      createInitialAppState(),
      openPreviewTab("a", document("/workspace/a.md")),
      keepTabOpen("a"),
      openPreviewTab("b", document("/workspace/b.md")),
    );
    expect(state.tabOrder).toEqual(["a", "b"]);
    expect(state.tabs.a?.preview).toBe(false);
    expect(state.tabs.b?.preview).toBe(true);
    state = reduce(
      state,
      openPreviewTab("unused", document("/workspace/b.md"), undefined, true),
    );
    expect(state.tabs.b?.preview).toBe(false);
    expect(state.tabOrder).toEqual(["a", "b"]);
    state = reduce(
      state,
      openPreviewTab("c", document("/workspace/c.md"), undefined, true),
    );
    expect(state.tabs.c?.preview).toBe(false);
    expect(state.tabOrder).toEqual(["a", "b", "c"]);
  });

  it("selects an already-open path instead of duplicating it or changing its view/history", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("fixed", document("/workspace/fixed.md")),
      updateView("fixed", createViewState({ visualScrollTop: 700 })),
      openPreviewTab("preview", document("/workspace/preview.md")),
    );
    const fixed = state.tabs.fixed;
    state = reduce(state, openPreviewTab("unused", document("/workspace/fixed.md")));
    expect(state.tabOrder).toEqual(["fixed", "preview"]);
    expect(state.tabs.fixed).toBe(fixed);
    expect(state.activeTabId).toBe("fixed");
  });

  it("editing a session fixes its previews across groups including historical references", () => {
    let state = reduce(
      createInitialAppState(),
      openPreviewTab("a", document("/workspace/a.md")),
      splitTabRight("a", "right-fixed", "right"),
      openPreviewTab("right-preview", document("/workspace/shared.md")),
      openInCurrent("right-preview", document("/workspace/other.md")),
      activateEditorGroup(INITIAL_EDITOR_GROUP_ID),
      openPreviewTab("left-preview", document("/workspace/shared.md")),
      editDocument("/workspace/shared.md", "edited"),
    );
    expect(state.tabs["left-preview"]?.preview).toBe(false);
    expect(state.tabs["right-preview"]?.preview).toBe(false);
    state = reduce(state, openPreviewTab("new-preview", document("/workspace/new.md")));
    expect(state.tabs["left-preview"]?.current.path).toBe("/workspace/shared.md");
    expect(state.tabs["right-preview"]?.back[0]?.path).toBe("/workspace/shared.md");
    expect(state.sessions["/workspace/shared.md"]?.text).toBe("edited");
  });

  it("never replaces a preview that navigated to a dirty document in its history", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("dirty", document("/workspace/dirty.md")),
      editDocument("/workspace/dirty.md", "unsaved body"),
      openPreviewTab("preview", document("/workspace/clean.md")),
      openInCurrent("preview", document("/workspace/dirty.md")),
      openInCurrent("preview", document("/workspace/other.md")),
      openPreviewTab("next-preview", document("/workspace/next.md")),
    );
    expect(state.tabs.preview?.preview).toBe(false);
    expect(state.tabs.preview?.back.map((entry) => entry.path)).toEqual([
      "/workspace/clean.md",
      "/workspace/dirty.md",
    ]);
    expect(state.tabOrder).toEqual(["dirty", "preview", "next-preview"]);
    state = reduce(state, goBack("preview"));
    expect(selectCurrentSession(state, "preview")?.text).toBe("unsaved body");
  });

  it("keeps one independent preview in each group and pins previews when dragging/splitting", () => {
    let state = reduce(
      createInitialAppState(),
      openPreviewTab("initial", document("/workspace/initial.md")),
      splitTabRight("initial", "right-fixed", "right"),
      openPreviewTab("right-preview", document("/workspace/right.md")),
      activateEditorGroup(INITIAL_EDITOR_GROUP_ID),
      openPreviewTab("left-preview", document("/workspace/left.md")),
      openPreviewTab("unused", document("/workspace/left-next.md")),
    );
    expect(state.tabs.initial?.preview).toBe(false);
    expect(state.tabs["right-fixed"]?.preview).toBe(false);
    expect(state.tabs["right-preview"]?.current.path).toBe("/workspace/right.md");
    expect(state.tabs["left-preview"]?.current.path).toBe("/workspace/left-next.md");
    expect(state.activeEditorGroupId).toBe(INITIAL_EDITOR_GROUP_ID);
    state = reduce(state, moveTabToGroup("left-preview", "right"));
    expect(state.tabs["left-preview"]?.preview).toBe(false);
    expect(state.tabs["right-preview"]?.preview).toBe(true);
    expect(state.editorGroups[1]?.tabIds).toEqual([
      "right-fixed",
      "right-preview",
      "left-preview",
    ]);
  });

  it("opens shared dirty content as permanent rather than offering to replace it", () => {
    const state = reduce(
      createInitialAppState(),
      openInNewTab("dirty", document("/workspace/shared.md")),
      editDocument("/workspace/shared.md", "unsaved"),
      splitTabRight("dirty", "copy", "right"),
      openInCurrent("copy", document("/workspace/other.md")),
      openPreviewTab("new", document("/workspace/shared.md")),
    );
    expect(state.tabs.new?.preview).toBe(false);
    expect(selectCurrentSession(state, "new")?.text).toBe("unsaved");
  });
});
