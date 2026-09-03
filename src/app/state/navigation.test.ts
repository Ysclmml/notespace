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
  goNavigationBack,
  goNavigationForward,
  INITIAL_EDITOR_GROUP_ID,
  keepTabOpen,
  markDocumentSaved,
  MAX_NAVIGATION_VISITS,
  moveTabToGroup,
  navigateToView,
  openInCurrent,
  openInNewTab,
  openPreviewTab,
  relocateDocument,
  selectActiveTab,
  selectCanNavigateBack,
  selectCanNavigateForward,
  selectCurrentSession,
  selectNavigationDestination,
  selectTabGroupId,
  splitTabRight,
  updateView,
  type AppState,
  type AppStateAction,
  type OpenDocument,
} from ".";

function document(name: string): OpenDocument {
  return {
    path: name.startsWith("untitled:") ? name : `/navigation-fixtures/${name}.md`,
    text: `# ${name}\n\nText shared by all views.\n`,
    diskMtimeMs: 1,
    mode: "normal",
  };
}

function reduce(state: AppState, ...actions: AppStateAction[]): AppState {
  return actions.reduce((previous, action) => {
    const next = appStateReducer(previous, action);
    const active = selectActiveTab(next);
    const { visits, index } = next.navigation;
    expect(visits.length).toBeLessThanOrEqual(MAX_NAVIGATION_VISITS);
    if (active) {
      expect(visits[index]).toMatchObject({ tabId: active.id, entry: active.current });
    } else {
      expect(visits).toEqual([]);
      expect(index).toBe(-1);
    }
    for (const visit of visits) {
      expect(next.tabs[visit.tabId]).toBeDefined();
      expect(next.sessions[visit.entry.documentId]).toBeDefined();
      expect(Object.keys(visit)).toEqual(["tabId", "entry"]);
      expect(Object.keys(visit.entry).sort()).toEqual(["documentId", "path", "view"]);
    }
    return next;
  }, state);
}

function visits(state: AppState) {
  return state.navigation.visits.map((visit) => [visit.tabId, visit.entry.path]);
}

describe("window-level document navigation", () => {
  it("seeds the first active tab and excludes background opens", () => {
    let state = createInitialAppState();
    expect(selectCanNavigateBack(state)).toBe(false);
    expect(selectCanNavigateForward(state)).toBe(false);
    expect(appStateReducer(state, goNavigationBack())).toBe(state);
    state = reduce(
      state,
      openInNewTab("a", document("a")),
      openInNewTab("background", document("b"), false),
    );
    expect(visits(state)).toEqual([["a", document("a").path]]);
    expect(selectCanNavigateBack(state)).toBe(false);
    state = reduce(state, activateTab("background"));
    expect(selectCanNavigateBack(state)).toBe(true);
    expect(selectNavigationDestination(state, "back")?.tabId).toBe("a");
    expect(selectCanNavigateForward(state)).toBe(false);

    const initialBackground = reduce(
      createInitialAppState(),
      openInNewTab("first", document("first"), false),
    );
    expect(visits(initialBackground)).toHaveLength(1);
    expect(initialBackground.activeTabId).toBe("first");
  });

  it("goes fixed A → new preview B → replacement C and back across tabs without changing shared text", () => {
    const bView = createViewState({ anchor: "details", visualSelectionFrom: 40 });
    let state = reduce(
      createInitialAppState(),
      openInNewTab("a", document("a")),
      openInNewTab("b", document("b"), true, bView, undefined, true),
      openInCurrent("b", document("c")),
    );
    const sessions = state.sessions;
    expect(state.tabs.a?.preview).toBe(false);
    expect(state.tabs.b?.preview).toBe(true);
    expect(state.tabOrder).toEqual(["a", "b"]);
    expect(visits(state)).toEqual([
      ["a", document("a").path],
      ["b", document("b").path],
      ["b", document("c").path],
    ]);
    state = reduce(state, goNavigationBack());
    expect(state.tabs.b?.current).toMatchObject({ path: document("b").path, view: bView });
    expect(state.tabs.b?.forward.map((entry) => entry.path)).toEqual([document("c").path]);
    state = reduce(state, goNavigationBack());
    expect(state.activeTabId).toBe("a");
    expect(state.tabs.a?.back).toEqual([]);
    expect(state.tabs.b?.current.path).toBe(document("b").path);
    state = reduce(state, goNavigationForward(), goNavigationForward());
    expect(state.activeTabId).toBe("b");
    expect(state.tabs.b?.current.path).toBe(document("c").path);
    expect(state.navigation.visits).toHaveLength(3);
    expect(state.sessions).toBe(sessions);
  });

  it("a fresh link preview fixes an existing preview instead of replacing it", () => {
    const anchor = createViewState({ anchor: "target", selectionFrom: 12 });
    const state = reduce(
      createInitialAppState(),
      openInNewTab("fixed", document("a")),
      openPreviewTab("tree-preview", document("unrelated")),
      activateTab("fixed"),
      openInNewTab("link-preview", document("b"), true, anchor, undefined, true),
    );
    expect(state.tabOrder).toEqual(["fixed", "tree-preview", "link-preview"]);
    expect(state.tabs["tree-preview"]?.preview).toBe(false);
    expect(state.tabs["link-preview"]?.preview).toBe(true);
    expect(state.tabs["link-preview"]?.current.view).toEqual(anchor);
    expect(state.navigation.visits.at(-1)?.entry.view).toEqual(anchor);
  });

  it("tree replacements keep both window and per-tab back/forward histories", () => {
    let state = reduce(
      createInitialAppState(),
      openPreviewTab("preview", document("a")),
      updateView("preview", createViewState({ visualScrollTop: 210 })),
      openPreviewTab("unused-b", document("b")),
      openPreviewTab("unused-c", document("c")),
      goNavigationBack(),
      goNavigationBack(),
    );
    expect(state.tabOrder).toEqual(["preview"]);
    expect(state.tabs.preview?.current.path).toBe(document("a").path);
    expect(state.tabs.preview?.current.view.visualScrollTop).toBe(210);
    expect(state.tabs.preview?.back).toEqual([]);
    expect(state.tabs.preview?.forward.map((entry) => entry.path)).toEqual([
      document("c").path,
      document("b").path,
    ]);
    state = reduce(state, goNavigationForward(), goNavigationForward());
    expect(state.tabs.preview?.current.path).toBe(document("c").path);
    expect(state.tabs.preview?.back.map((entry) => entry.path)).toEqual([
      document("a").path,
      document("b").path,
    ]);
  });

  it("crosses tab/group activations and restores a moved tab in its current group", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("a", document("a")),
      splitTabRight("a", "copy", "right"),
      openInNewTab("b", document("b")),
      activateTab("a"),
      moveTabToGroup("b", INITIAL_EDITOR_GROUP_ID),
      goNavigationBack(),
    );
    expect(state.activeTabId).toBe("a");
    expect(selectTabGroupId(state, "b")).toBe(INITIAL_EDITOR_GROUP_ID);
    state = reduce(state, goNavigationBack());
    expect(state.activeTabId).toBe("b");
    expect(state.activeEditorGroupId).toBe(INITIAL_EDITOR_GROUP_ID);
    expect(state.editorGroups[1]?.activeTabId).toBe("copy");
    state = reduce(state, goNavigationBack());
    expect(state.activeTabId).toBe("copy");
    expect(state.activeEditorGroupId).toBe("right");
    expect(state.editorGroups[0]?.activeTabId).toBe("b");
  });

  it("explicit anchors record views, while selection, scrolling and mode updates do not add visits", () => {
    const first = createViewState({ visualScrollTop: 90, visualSelectionFrom: 10 });
    const target = createViewState({ anchor: "heading", visualSelectionFrom: 80 });
    const scrolledTarget = createViewState({
      ...target,
      visualScrollTop: 600,
      visualSelectionFrom: 85,
    });
    let state = reduce(
      createInitialAppState(),
      openInNewTab("a", document("a"), true, first),
      navigateToView("a", target),
      updateView("a", scrolledTarget),
    );
    expect(state.navigation.visits).toHaveLength(2);
    expect(appStateReducer(state, navigateToView("a", scrolledTarget))).toBe(state);
    state = reduce(state, goNavigationBack());
    expect(state.tabs.a?.current.view).toEqual(first);
    const sourceView = createViewState({
      ...first,
      editorMode: "source",
      sourceScrollTop: 150,
      selectionFrom: 23,
    });
    state = reduce(state, updateView("a", sourceView));
    expect(selectCanNavigateForward(state)).toBe(true);
    expect(state.navigation.visits).toHaveLength(2);
    state = reduce(state, goNavigationForward());
    expect(state.tabs.a?.current.view).toEqual(scrolledTarget);
    state = reduce(state, goNavigationBack());
    expect(state.tabs.a?.current.view).toEqual(sourceView);
    expect(selectCurrentSession(state, "a")?.dirty).toBe(false);
  });

  it("captures a departing live view and restores it on forward without extending the trail", () => {
    const departure = createViewState({
      editorMode: "source",
      sourceScrollTop: 780,
      selectionFrom: 54,
      selectionTo: 61,
    });
    let state = reduce(
      createInitialAppState(),
      openInNewTab("a", document("a")),
      openInNewTab("b", document("b")),
      goNavigationBack(departure),
    );
    expect(state.tabs.b?.current.view).toEqual(departure);
    expect(state.navigation.visits[1]?.entry.view).toEqual(departure);
    state = reduce(state, goNavigationForward());
    expect(state.tabs.b?.current.view).toEqual(departure);
    expect(state.navigation.visits).toHaveLength(2);
    expect(appStateReducer(state, goNavigationForward())).toBe(state);
  });

  it("editor autofocus after traversal cannot append a visit or erase forward destinations", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("a", document("a")),
      splitTabRight("a", "copy", "right"),
      openInNewTab("b", document("b")),
      goNavigationBack(),
    );
    const before = visits(state);
    const index = state.navigation.index;
    state = reduce(
      state,
      activateEditorGroup("right"),
      activateTab("copy"),
      updateView("copy", createViewState({ visualScrollTop: 180 })),
      activateEditorGroup("right"),
      activateTab("copy"),
    );
    expect(visits(state)).toEqual(before);
    expect(state.navigation.index).toBe(index);
    expect(selectCanNavigateForward(state)).toBe(true);
    state = reduce(state, goNavigationForward());
    expect(state.activeTabId).toBe("b");
    expect(state.navigation.visits).toHaveLength(before.length);
  });

  it("restoring an older visit retains dirty current text as a per-tab forward reference", () => {
    let state = reduce(
      createInitialAppState(),
      openPreviewTab("a", document("a")),
      openInCurrent("a", document("b")),
      editDocument(document("b").path, "unsaved current text"),
      splitTabRight("a", "copy", "right"),
      goNavigationBack(),
      goNavigationBack(),
    );
    expect(state.activeTabId).toBe("a");
    expect(state.tabs.a?.current.path).toBe(document("a").path);
    expect(state.tabs.a?.forward.map((entry) => entry.path)).toContain(document("b").path);
    state = reduce(state, closeTab("copy"));
    expect(state.sessions[document("b").path]).toMatchObject({
      text: "unsaved current text",
      dirty: true,
    });
    state = reduce(state, openPreviewTab("new-preview", document("c")));
    expect(state.tabs.a).toBeDefined();
    expect(state.tabs.a?.forward.map((entry) => entry.path)).toContain(document("b").path);
    expect(state.sessions[document("b").path]?.dirty).toBe(true);
  });

  it.each(["anchor", "document"] as const)(
    "branching to a new %s after going back keeps dirty forward text owned by the tab",
    (branch) => {
      let state = reduce(
        createInitialAppState(),
        openPreviewTab("preview", document("a")),
        openInCurrent("preview", document("b")),
        editDocument(document("b").path, "unsaved B"),
        goNavigationBack(),
      );
      const dirtySession = state.sessions[document("b").path];
      expect(state.tabs.preview?.back).toEqual([]);
      expect(state.tabs.preview?.forward.map((entry) => entry.path)).toEqual([
        document("b").path,
      ]);
      state = reduce(
        state,
        branch === "anchor"
          ? navigateToView(
              "preview",
              createViewState({ anchor: "heading", visualSelectionFrom: 10 }),
            )
          : openInCurrent("preview", document("c")),
      );
      expect(state.tabs.preview?.forward).toEqual([]);
      expect(state.tabs.preview?.back.map((entry) => entry.path)).toEqual([
        document("b").path,
        document("a").path,
      ]);
      expect(state.sessions[document("b").path]).toBe(dirtySession);
      expect(state.sessions[document("b").path]?.dirty).toBe(true);
      expect(
        state.navigation.visits.some((visit) => visit.entry.path === document("b").path),
      ).toBe(false);
      expect(selectCanNavigateForward(state)).toBe(false);
      state = reduce(state, goBack("preview"), goBack("preview"));
      expect(selectCurrentSession(state, "preview")).toBe(dirtySession);
      state = reduce(state, closeTab("preview"));
      expect(state.sessions[document("b").path]).toBeUndefined();
    },
  );

  it("retains one dirty forward reference per document while dropping clean abandoned entries", () => {
    let state = reduce(
      createInitialAppState(),
      openPreviewTab("preview", document("a")),
      openInCurrent(
        "preview",
        document("b"),
        undefined,
        createViewState({ anchor: "first" }),
      ),
      navigateToView("preview", createViewState({ anchor: "second" })),
      openInCurrent("preview", document("clean")),
      editDocument(document("b").path, "unsaved B"),
      goNavigationBack(),
      goNavigationBack(),
      goNavigationBack(),
      openInCurrent("preview", document("branch")),
    );
    expect(state.tabs.preview?.back.map((entry) => entry.path)).toEqual([
      document("b").path,
      document("a").path,
    ]);
    expect(state.tabs.preview?.forward).toEqual([]);
    expect(state.sessions[document("b").path]?.dirty).toBe(true);
    state = reduce(state, openInCurrent("preview", document("another")));
    expect(
      state.tabs.preview?.back.filter((entry) => entry.path === document("b").path),
    ).toHaveLength(1);
  });

  it("does not duplicate a dirty forward document already owned by back or the new target", () => {
    let state = reduce(
      createInitialAppState(),
      openPreviewTab("preview", document("a")),
      openInCurrent("preview", document("b")),
      openInCurrent("preview", document("c")),
      openInCurrent(
        "preview",
        document("b"),
        undefined,
        createViewState({ anchor: "second" }),
      ),
      editDocument(document("b").path, "unsaved B"),
      goNavigationBack(),
      openInCurrent("preview", document("d")),
    );
    expect(
      state.tabs.preview?.back.filter((entry) => entry.path === document("b").path),
    ).toHaveLength(1);
    state = reduce(
      createInitialAppState(),
      openPreviewTab("preview", document("a")),
      openInCurrent("preview", document("b")),
      editDocument(document("b").path, "unsaved B"),
      goNavigationBack(),
      openInCurrent("preview", document("b")),
    );
    expect(state.tabs.preview?.back.map((entry) => entry.path)).toEqual([
      document("a").path,
    ]);
    expect(selectCurrentSession(state, "preview")).toMatchObject({
      dirty: true,
      text: "unsaved B",
    });
  });

  it("a tree preview after going back cannot replace a tab holding dirty forward text", () => {
    const state = reduce(
      createInitialAppState(),
      openPreviewTab("preview", document("a")),
      openInCurrent("preview", document("b")),
      editDocument(document("b").path, "unsaved B"),
      goNavigationBack(),
      openPreviewTab("new-preview", document("c")),
    );
    expect(state.tabOrder).toEqual(["preview", "new-preview"]);
    expect(state.tabs.preview?.forward.map((entry) => entry.path)).toEqual([
      document("b").path,
    ]);
    expect(state.sessions[document("b").path]?.dirty).toBe(true);
  });

  it.each([
    { label: "document", anchorOnly: false },
    { label: "anchor", anchorOnly: true },
  ])(
    "repeated $label destinations restore the directionally correct tab stack",
    ({ anchorOnly }) => {
      let state = reduce(
        createInitialAppState(),
        openPreviewTab("preview", document("a")),
        anchorOnly
          ? navigateToView("preview", createViewState({ anchor: "b" }))
          : openInCurrent("preview", document("b")),
        anchorOnly
          ? navigateToView("preview", createViewState())
          : openInCurrent("preview", document("a")),
        anchorOnly
          ? navigateToView("preview", createViewState({ anchor: "c" }))
          : openInCurrent("preview", document("c")),
        goNavigationBack(),
        goNavigationBack(),
        goNavigationForward(),
      );
      const destination = (entry: { path: string; view: { anchor?: string } }) =>
        anchorOnly ? entry.view.anchor : entry.path;
      expect(state.tabs.preview?.back.map(destination)).toEqual(
        anchorOnly ? [undefined, "b"] : [document("a").path, document("b").path],
      );
      expect(state.tabs.preview?.forward.map(destination)).toEqual(
        anchorOnly ? ["c"] : [document("c").path],
      );
      state = reduce(state, goBack("preview"));
      expect(destination(state.tabs.preview!.current)).toBe(
        anchorOnly ? "b" : document("b").path,
      );
    },
  );

  it("keeps forward history through edits, saving, background opens and keep-open until a fresh visit", () => {
    let state = reduce(
      createInitialAppState(),
      openPreviewTab("a", document("a")),
      openInNewTab("b", document("b")),
      goNavigationBack(),
      editDocument(document("a").path, "new body"),
      markDocumentSaved(document("a").path, "new body", 2),
      keepTabOpen("a"),
      openInNewTab("background", document("background"), false),
    );
    expect(state.navigation.visits).toHaveLength(2);
    expect(selectCanNavigateForward(state)).toBe(true);
    state = reduce(state, openInNewTab("c", document("c")));
    expect(visits(state)).toEqual([
      ["a", document("a").path],
      ["c", document("c").path],
    ]);
    expect(selectCanNavigateForward(state)).toBe(false);
    expect(state.tabs.b).toBeDefined();
  });

  it("does not turn late opens in an unfocused group into phantom visits or steal focus", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("a", document("a")),
      splitTabRight("a", "right-a", "right"),
      activateTab("a"),
    );
    const originalNavigation = state.navigation;
    state = reduce(
      state,
      openPreviewTab("late-preview", document("b"), "right", false, false),
      openInNewTab("late-link", document("c"), true, undefined, "right", true, false),
      openInCurrent("late-link", document("d")),
    );
    expect(state.navigation).toBe(originalNavigation);
    expect(state.activeTabId).toBe("a");
    expect(state.editorGroups[1]?.activeTabId).toBe("late-link");
    expect(state.tabs["late-preview"]?.preview).toBe(false);
    state = reduce(state, activateEditorGroup("right"));
    expect(state.navigation.visits.at(-1)).toMatchObject({
      tabId: "late-link",
      entry: { path: document("d").path },
    });
    expect(state.navigation.visits).toHaveLength(originalNavigation.visits.length + 1);
  });

  it("closed tabs disappear from all visits and closing does not append a neighboring tab again", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("a", document("a")),
      openInNewTab("b", document("b")),
      activateTab("a"),
      openInNewTab("c", document("c")),
      closeTab("a"),
    );
    expect(visits(state)).toEqual([
      ["b", document("b").path],
      ["c", document("c").path],
    ]);
    state = reduce(state, closeTab("c"));
    expect(state.activeTabId).toBe("b");
    expect(visits(state)).toEqual([["b", document("b").path]]);
    expect(selectCanNavigateBack(state)).toBe(false);
    expect(selectCanNavigateForward(state)).toBe(false);
    expect(appStateReducer(state, goNavigationBack())).toBe(state);
    state = reduce(state, closeTab("b"));
    expect(state.navigation).toEqual({ visits: [], index: -1 });
  });

  it("gives a background-only surviving neighbor its first current position after close", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("a", document("a")),
      openInNewTab("b", document("b"), false),
      closeTab("a"),
    );
    expect(state.activeTabId).toBe("b");
    expect(visits(state)).toEqual([["b", document("b").path]]);
    state = reduce(state, openInNewTab("c", document("c")), goNavigationBack());
    expect(state.activeTabId).toBe("b");
  });

  it("removing an earlier tab while traversing preserves surviving forward history", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("a", document("a")),
      openInNewTab("b", document("b")),
      openInNewTab("c", document("c")),
      goNavigationBack(),
      closeTab("a"),
    );
    expect(visits(state)).toEqual([
      ["b", document("b").path],
      ["c", document("c").path],
    ]);
    expect(state.navigation.index).toBe(0);
    expect(selectCanNavigateForward(state)).toBe(true);
    state = reduce(state, goNavigationForward());
    expect(state.activeTabId).toBe("c");
  });

  it("discarding a document removes its visits and per-tab references without resurrecting it", () => {
    let state = reduce(
      createInitialAppState(),
      openPreviewTab("a", document("a")),
      openInCurrent("a", document("b")),
      splitTabRight("a", "copy", "right"),
      openInCurrent("copy", document("c")),
      discardDocuments([document("b").path]),
    );
    expect(
      state.navigation.visits.every((visit) => visit.entry.path !== document("b").path),
    ).toBe(true);
    expect(state.sessions[document("b").path]).toBeUndefined();
    state = reduce(state, goNavigationBack());
    expect(state.activeTabId).toBe("a");
    expect(state.tabs.a?.current.path).toBe(document("a").path);
    state = reduce(state, goNavigationForward());
    expect(state.activeTabId).toBe("copy");
    expect(state.tabs.copy?.current.path).toBe(document("c").path);
  });

  it("Save As migrates window visits along with every tab and preserves shared unsaved edits", () => {
    const untitled = document("untitled://Draft.md");
    const saved = document("saved");
    const draftView = createViewState({ visualScrollTop: 123 });
    let state = reduce(
      createInitialAppState(),
      openInNewTab("draft", untitled, true, draftView),
      splitTabRight("draft", "copy", "right"),
      openInCurrent("copy", document("other")),
      editDocument(untitled.path, "newer draft text"),
      relocateDocument(untitled.path, saved, "earlier written text"),
    );
    expect(state.navigation.visits.slice(0, 2).map((visit) => visit.entry.path)).toEqual([
      saved.path,
      saved.path,
    ]);
    expect(state.navigation.visits[0]?.entry.view).toEqual(draftView);
    expect(state.sessions[untitled.path]).toBeUndefined();
    state = reduce(state, goNavigationBack(), goNavigationBack());
    expect(state.activeTabId).toBe("draft");
    expect(selectCurrentSession(state, "draft")).toBe(selectCurrentSession(state, "copy"));
    expect(selectCurrentSession(state, "draft")).toMatchObject({
      text: "newer draft text",
      dirty: true,
      path: saved.path,
    });
  });

  it("keeps per-tab navigation compatible without merging either tab's history", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("a", document("a")),
      openInCurrent("a", document("b")),
      openInNewTab("other", document("other")),
      goBack("a"),
    );
    expect(state.activeTabId).toBe("other");
    expect(state.navigation.visits).toHaveLength(3);
    expect(state.tabs.other?.back).toEqual([]);
    state = reduce(state, activateTab("a"), goForward("a"));
    expect(state.tabs.a?.current.path).toBe(document("b").path);
    expect(state.tabs.other?.current.path).toBe(document("other").path);
    expect(state.navigation.visits.at(-1)?.entry.path).toBe(document("b").path);
  });

  it("never resurrects discarded dirty text after closing its final reference", () => {
    let state = reduce(
      createInitialAppState(),
      openPreviewTab("edited", document("a")),
      editDocument(document("a").path, "discard me"),
      openInCurrent("edited", document("b")),
      openInNewTab("other", document("other")),
      closeTab("edited"),
    );
    expect(state.sessions[document("a").path]).toBeUndefined();
    expect(state.navigation.visits.every((visit) => visit.tabId !== "edited")).toBe(true);
    state = reduce(state, openPreviewTab("reopened", document("a")));
    expect(selectCurrentSession(state, "reopened")?.text).toBe(document("a").text);
    expect(selectCurrentSession(state, "reopened")?.dirty).toBe(false);
  });

  it("caps the trail, preserves forward on traversal, and branches only on a new visit", () => {
    let state = createInitialAppState();
    for (let index = 0; index < MAX_NAVIGATION_VISITS + 5; index++) {
      state = reduce(state, openPreviewTab(`tab-${index}`, document(`file-${index}`)));
    }
    expect(state.tabOrder).toEqual(["tab-0"]);
    expect(state.navigation.visits).toHaveLength(MAX_NAVIGATION_VISITS);
    expect(state.navigation.visits[0]?.entry.path).toBe(document("file-5").path);
    const originalVisits = visits(state);
    for (let index = 0; index < MAX_NAVIGATION_VISITS - 1; index++) {
      state = reduce(state, goNavigationBack());
    }
    expect(selectCanNavigateBack(state)).toBe(false);
    expect(selectCanNavigateForward(state)).toBe(true);
    expect(visits(state)).toEqual(originalVisits);
    state = reduce(state, openPreviewTab("unused-branch", document("branch")));
    expect(visits(state)).toEqual([
      ["tab-0", document("file-5").path],
      ["tab-0", document("branch").path],
    ]);
    expect(selectCanNavigateForward(state)).toBe(false);
  });
});
