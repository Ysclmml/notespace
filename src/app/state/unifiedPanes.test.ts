import { describe, expect, it } from "vitest";

import {
  INITIAL_EDITOR_GROUP_ID,
  activateEditorGroup,
  appStateReducer,
  createInitialAppState,
  createViewState,
  editDocument,
  goBack,
  keepTabOpen,
  moveTabRight,
  openInCurrent,
  openInNewTab,
  openPreviewTab,
  selectCurrentSession,
  selectTabGroupId,
  updateView,
  type AppState,
  type AppStateAction,
  type OpenDocument,
} from ".";

function document(path: string, text = "# Disk text\n"): OpenDocument {
  return {
    path,
    text,
    diskMtimeMs: 1,
    mode: "normal",
    kind: path.endsWith(".md") ? "markdown" : "text",
    language: path.endsWith(".md") ? "markdown" : "python",
  };
}

function reduce(state: AppState, ...actions: AppStateAction[]) {
  return actions.reduce((current, action) => appStateReducer(current, action), state);
}

function openRight(
  tabId: string,
  path: string,
  sourceGroupId = INITIAL_EDITOR_GROUP_ID,
  newGroupId = "right",
  focus = true,
): AppStateAction {
  return {
    type: "editor-group/open-right",
    tabId,
    document: document(path),
    sourceGroupId,
    newGroupId,
    focus,
  };
}

function expectTabOwnership(state: AppState) {
  expect(state.editorGroups.flatMap((group) => group.tabIds)).toEqual(state.tabOrder);
  expect(new Set(state.tabOrder).size).toBe(state.tabOrder.length);
  expect([...state.tabOrder].sort()).toEqual(Object.keys(state.tabs).sort());
  expect(
    state.editorGroups.find((group) => group.id === state.activeEditorGroupId)!.activeTabId,
  ).toBe(state.activeTabId);
  for (const group of state.editorGroups) {
    expect(group.tabIds.filter((id) => state.tabs[id]!.preview).length).toBeLessThanOrEqual(
      1,
    );
    if (group.tabIds.length) expect(group.tabIds).toContain(group.activeTabId);
    else expect(group.activeTabId).toBeNull();
  }
}

describe("moving the original tab right", () => {
  it("keeps the tab identity, current view, both histories and shared dirty body without duplication", () => {
    const view = createViewState({
      editorMode: "source",
      sourceScrollTop: 320,
      visualScrollTop: 210,
      selectionFrom: 3,
      selectionTo: 9,
    });
    const before = reduce(
      createInitialAppState(),
      openInNewTab("original", document("/fixtures/a.md")),
      openInCurrent("original", document("/fixtures/b.md")),
      openInCurrent("original", document("/fixtures/c.md")),
      goBack("original"),
      updateView("original", view),
      editDocument("/fixtures/b.md", "Unsaved shared body"),
    );
    const tab = before.tabs.original!;
    const session = before.sessions["/fixtures/b.md"]!;
    const after = appStateReducer(before, moveTabRight("original", "right"));
    expect(after.tabs.original).toBe(tab);
    expect(after.tabs.original!.current).toBe(tab.current);
    expect(after.tabs.original!.current.view).toEqual(view);
    expect(after.tabs.original!.back).toBe(tab.back);
    expect(after.tabs.original!.forward).toBe(tab.forward);
    expect(after.sessions["/fixtures/b.md"]).toBe(session);
    expect(session).toMatchObject({ text: "Unsaved shared body", dirty: true });
    expect(Object.keys(after.tabs)).toEqual(["original"]);
    expect(after.editorGroups).toHaveLength(2);
    expect(after.editorGroups[0]).toMatchObject({
      tabIds: [],
      activeTabId: null,
      keepEmpty: true,
    });
    expect(after.editorGroups[1]).toMatchObject({ id: "right", tabIds: ["original"] });
    expect(after.activeEditorGroupId).toBe("right");
    expectTabOwnership(after);
  });

  it("can activate the retained empty left group and route the next opened file into it", () => {
    let state = reduce(
      createInitialAppState(),
      openPreviewTab("moved", document("/fixtures/moved.md")),
      moveTabRight("moved", "right"),
      activateEditorGroup(INITIAL_EDITOR_GROUP_ID),
    );
    expect(state.activeTabId).toBeNull();
    expect(state.activeEditorGroupId).toBe(INITIAL_EDITOR_GROUP_ID);
    expect(state.tabs.moved!.preview).toBe(false);
    state = appStateReducer(
      state,
      openPreviewTab("new-left", document("/fixtures/new.md")),
    );
    expect(selectTabGroupId(state, "new-left")).toBe(INITIAL_EDITOR_GROUP_ID);
    expect(selectTabGroupId(state, "moved")).toBe("right");
    expect(state.editorGroups).toHaveLength(2);
    expect(state.activeTabId).toBe("new-left");
    expect(state.editorGroups[0]!.keepEmpty).not.toBe(true);
    expectTabOwnership(state);
  });

  it("reuses the immediate right group instead of creating another pane", () => {
    const before = reduce(
      createInitialAppState(),
      openInNewTab("left", document("/fixtures/left.md")),
      openInNewTab("moving", document("/fixtures/moving.md")),
      openRight("right-existing", "/fixtures/target.py"),
    );
    const after = appStateReducer(before, moveTabRight("moving", "unused-new-group"));
    expect(after.editorGroups.map((group) => group.id)).toEqual([
      INITIAL_EDITOR_GROUP_ID,
      "right",
    ]);
    expect(after.editorGroups[1]!.tabIds).toEqual(["right-existing", "moving"]);
    expect(after.tabs.moving).toBe(before.tabs.moving);
    expect(after.activeTabId).toBe("moving");
    expectTabOwnership(after);
  });
});

describe("opening previews in ordinary right editor groups", () => {
  it("keeps the left source intact while replacing only the clean temporary right tab", () => {
    const before = reduce(
      createInitialAppState(),
      openPreviewTab("source", document("/fixtures/source.md")),
      openRight(
        "first-right",
        "/fixtures/first.py",
        INITIAL_EDITOR_GROUP_ID,
        "right",
        false,
      ),
    );
    const source = before.tabs.source;
    expect(before.activeEditorGroupId).toBe(INITIAL_EDITOR_GROUP_ID);
    const after = appStateReducer(
      before,
      openRight(
        "unused-tab-id",
        "/fixtures/second.py",
        INITIAL_EDITOR_GROUP_ID,
        "unused-group",
        false,
      ),
    );
    expect(after.tabs.source).toBe(source);
    expect(after.tabs["first-right"]!.current.path).toBe("/fixtures/second.py");
    expect(after.tabs["first-right"]!.preview).toBe(true);
    expect(after.tabs["unused-tab-id"]).toBeUndefined();
    expect(after.editorGroups).toHaveLength(2);
    expect(after.editorGroups[1]!.tabIds).toEqual(["first-right"]);
    expect(after.activeTabId).toBe("source");
    expectTabOwnership(after);
  });

  it.each(["fixed", "dirty"] as const)(
    "preserves a %s right tab when opening another preview",
    (kind) => {
      let before = reduce(
        createInitialAppState(),
        openInNewTab("source", document("/fixtures/source.md")),
        openRight("keep-right", "/fixtures/keep.py"),
      );
      before = appStateReducer(
        before,
        kind === "fixed"
          ? keepTabOpen("keep-right")
          : editDocument("/fixtures/keep.py", "Unsaved code"),
      );
      const retained = before.tabs["keep-right"];
      const session = before.sessions["/fixtures/keep.py"];
      const after = appStateReducer(before, openRight("new-preview", "/fixtures/next.py"));
      expect(after.tabs["keep-right"]).toBe(retained);
      expect(after.sessions["/fixtures/keep.py"]).toBe(session);
      expect(after.editorGroups[1]!.tabIds).toEqual(["keep-right", "new-preview"]);
      expect(after.tabs["new-preview"]!.preview).toBe(true);
      if (kind === "dirty")
        expect(selectCurrentSession(after, "keep-right")).toMatchObject({
          dirty: true,
          text: "Unsaved code",
        });
      expectTabOwnership(after);
    },
  );

  it("keeps a rightmost source tab when its link opens another page, without creating a third pane", () => {
    const before = reduce(
      createInitialAppState(),
      openInNewTab("left", document("/fixtures/left.md")),
      openRight("right-source", "/fixtures/right-source.md"),
    );
    const sourceView = before.tabs["right-source"]!.current.view;
    const after = appStateReducer(
      before,
      openRight("right-target", "/fixtures/target.py", "right", "must-not-exist"),
    );
    expect(after.editorGroups.map((group) => group.id)).toEqual([
      INITIAL_EDITOR_GROUP_ID,
      "right",
    ]);
    expect(after.editorGroups[1]!.tabIds).toEqual(["right-source", "right-target"]);
    expect(after.tabs["right-source"]!.current.path).toBe("/fixtures/right-source.md");
    expect(after.tabs["right-source"]!.current.view).toBe(sourceView);
    expect(after.tabs["right-source"]!.preview).toBe(false);
    expect(after.tabs["right-target"]!.preview).toBe(true);
    expectTabOwnership(after);
  });

  it("shares the existing dirty document session across groups and reuses an already open target", () => {
    let state = reduce(
      createInitialAppState(),
      openInNewTab("left", document("/fixtures/shared.py")),
      editDocument("/fixtures/shared.py", "Unsaved shared source"),
      openRight("right-shared", "/fixtures/shared.py"),
      updateView(
        "right-shared",
        createViewState({ sourceScrollTop: 222, editorMode: "source" }),
      ),
    );
    expect(selectCurrentSession(state, "left")).toBe(
      selectCurrentSession(state, "right-shared"),
    );
    expect(selectCurrentSession(state, "right-shared")).toMatchObject({
      dirty: true,
      text: "Unsaved shared source",
    });
    expect(state.tabs["right-shared"]!.preview).toBe(false);
    const tab = state.tabs["right-shared"];
    state = appStateReducer(state, openRight("must-not-duplicate", "/fixtures/shared.py"));
    expect(state.tabs["right-shared"]).toBe(tab);
    expect(state.tabs["must-not-duplicate"]).toBeUndefined();
    expect(state.tabs["right-shared"]!.current.view.sourceScrollTop).toBe(222);
    expect(state.editorGroups[1]!.tabIds).toEqual(["right-shared"]);
    expect(Object.keys(state.sessions)).toEqual(["/fixtures/shared.py"]);
    expectTabOwnership(state);
  });
});
