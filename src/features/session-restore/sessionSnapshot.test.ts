import { describe, expect, it, vi } from "vitest";

import {
  createInitialAppState,
  createViewState,
  type AppState,
  type ViewState,
} from "../../app/state/model";
import type { SettingsStorage } from "../../app/settings/storage";
import type {
  EditableDocumentResult,
  OpenDocumentResult,
} from "../../infrastructure/tauri/desktopAdapter";
import {
  MAX_SESSION_GROUPS,
  MAX_SESSION_PATH_LENGTH,
  MAX_SESSION_STORAGE_LENGTH,
  MAX_SESSION_TABS,
  MAX_SESSION_WORKSPACES,
  SESSION_SNAPSHOT_STORAGE_KEY,
  buildSessionSnapshot,
  loadSessionSnapshot,
  normalizeSessionSnapshot,
  reopenSessionSnapshot,
  saveSessionSnapshot,
  type SessionSnapshot,
} from "./sessionSnapshot";

class MemoryStorage implements SettingsStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function editable(path: string, content = "Fresh disk body\n"): EditableDocumentResult {
  return {
    status: "editable",
    path,
    content,
    documentKind: "markdown",
    language: "markdown",
    mode: "normal",
    preflight: {
      sizeBytes: content.length,
      longestLineBytes: content.length,
      containsDataImageBase64: false,
    },
  };
}

function addTab(state: AppState, id: string, path: string, view = createViewState()) {
  state.sessions[path] ??= {
    id: path,
    path,
    text: "PRIVATE_UNSAVED_BODY",
    dirty: false,
    diskMtimeMs: 123,
    mode: "normal",
    kind: "markdown",
    language: "markdown",
  };
  state.tabs[id] = {
    id,
    preview: false,
    current: { documentId: path, path, view },
    back: [],
    forward: [],
  };
  state.tabOrder.push(id);
}

function exampleState(): AppState {
  const state = createInitialAppState();
  addTab(state, "untitled", "untitled://draft.md");
  addTab(
    state,
    "left-one",
    "/fixtures/one.md",
    createViewState({ editorMode: "source", sourceScrollTop: 180, selectionFrom: 3 }),
  );
  addTab(state, "left-two", "/fixtures/two.md");
  addTab(
    state,
    "right-one",
    "/fixtures/one.md",
    createViewState({ visualScrollTop: 240, visualSelectionFrom: 6 }),
  );
  state.tabs["left-two"]!.preview = true;
  state.editorGroups = [
    { id: "left", tabIds: ["untitled", "left-one", "left-two"], activeTabId: "left-two" },
    { id: "right", tabIds: ["right-one"], activeTabId: "right-one" },
  ];
  state.activeTabId = "right-one";
  state.activeEditorGroupId = "right";
  return state;
}

function exampleSnapshot() {
  return buildSessionSnapshot(exampleState(), {
    workspacePaths: ["/fixtures"],
    activeWorkspacePath: "/fixtures",
  });
}

describe("session browsing metadata", () => {
  it("stores current paths, group order, pinning and numeric views but no document text", () => {
    const state = exampleState();
    state.sessions["/fixtures/one.md"]!.dirty = true;
    state.tabs["left-one"]!.preview = true;
    state.tabs["left-one"]!.current.view = {
      ...state.tabs["left-one"]!.current.view,
      anchor: "PRIVATE_HEADING",
      selectedText: "PRIVATE_SELECTION",
      semanticPosition: { nearbyText: "PRIVATE_EXCERPT" },
    } as ViewState;
    state.tabs["left-one"]!.back = [
      {
        documentId: "/fixtures/history.md",
        path: "/fixtures/history.md",
        view: createViewState(),
      },
    ];
    state.navigation = {
      visits: [{ tabId: "left-one", entry: state.tabs["left-one"]!.back[0]! }],
      index: 0,
    };
    const snapshot = buildSessionSnapshot(state, {
      workspacePaths: ["/fixtures", "/second", "/fixtures"],
      activeWorkspacePath: "/second",
    });
    expect(snapshot.workspacePaths).toEqual(["/fixtures", "/second"]);
    expect(snapshot.activeWorkspacePath).toBe("/second");
    expect(snapshot.activeGroupIndex).toBe(1);
    expect(snapshot.groups[0]!.activeTabIndex).toBe(1);
    expect(snapshot.groups[0]!.tabs.map((tab) => [tab.path, tab.preview])).toEqual([
      ["/fixtures/one.md", false],
      ["/fixtures/two.md", true],
    ]);
    expect(snapshot.groups[1]!.tabs[0]!.view.visualScrollTop).toBe(240);
    const storage = new MemoryStorage();
    expect(saveSessionSnapshot(snapshot, storage)).toBe(true);
    const serialized = storage.getItem(SESSION_SNAPSHOT_STORAGE_KEY)!;
    for (const forbidden of [
      "PRIVATE_",
      "untitled",
      "history.md",
      "back",
      "forward",
      "navigation",
      "dirty",
      "anchor",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(loadSessionSnapshot(storage)).toEqual(snapshot);
  });

  it("bounds counts and paths, ignores invalid entries and normalizes view offsets", () => {
    const snapshot = normalizeSessionSnapshot({
      version: 1,
      workspacePaths: Array.from({ length: 60 }, (_, index) => `/root-${index}`),
      activeWorkspacePath: "/missing-root",
      activeGroupIndex: 999,
      groups: Array.from({ length: 20 }, () => ({
        activeTabIndex: 3,
        tabs: [
          { path: "untitled://draft.md" },
          { path: "https://example.test/not-local.md" },
          { path: "/" + "a".repeat(MAX_SESSION_PATH_LENGTH) },
          ...Array.from({ length: 20 }, (_, index) => ({
            path: `/fixtures/${index}.md`,
            preview: true,
            view: {
              editorMode: "nonsense",
              sourceScrollTop: -10,
              visualScrollTop: Infinity,
              selectionFrom: 3.7,
              selectionTo: NaN,
            },
          })),
        ],
      })),
    })!;
    expect(snapshot.workspacePaths).toHaveLength(MAX_SESSION_WORKSPACES);
    expect(snapshot.activeWorkspacePath).toBe("/root-0");
    expect(snapshot.groups.length).toBeLessThanOrEqual(MAX_SESSION_GROUPS);
    expect(snapshot.groups.flatMap((group) => group.tabs)).toHaveLength(MAX_SESSION_TABS);
    expect(snapshot.groups[0]!.activeTabIndex).toBe(0);
    expect(snapshot.activeGroupIndex).toBe(0);
    for (const group of snapshot.groups) {
      expect(group.tabs.filter((tab) => tab.preview)).toHaveLength(1);
    }
    expect(snapshot.groups[0]!.tabs[0]!.view).toMatchObject({
      editorMode: "visual",
      sourceScrollTop: 0,
      visualScrollTop: 0,
      selectionFrom: 3,
      selectionTo: 0,
    });
    expect(
      normalizeSessionSnapshot({
        ...snapshot,
        groups: Array.from({ length: 20 }, () => snapshot.groups[0]),
      })!.groups.length,
    ).toBeLessThanOrEqual(MAX_SESSION_GROUPS);
  });

  it("preserves exact Unicode, spaces, Windows drive, UNC and long-path spelling", () => {
    const paths = [
      "/fixtures/中文 note.md",
      "C:\\Notes\\My note.md",
      "\\\\server\\notes\\文档.md",
      "\\\\?\\C:\\Notes\\long.md",
    ];
    const snapshot = normalizeSessionSnapshot({
      version: 1,
      workspacePaths: [],
      groups: [{ activeTabIndex: 0, tabs: paths.map((path) => ({ path })) }],
      activeGroupIndex: 0,
    })!;
    expect(snapshot.groups[0]!.tabs.map((tab) => tab.path)).toEqual(paths);
  });

  it("falls back for malformed, unsupported, oversized or inaccessible storage", () => {
    const storage = new MemoryStorage();
    for (const value of [
      "not json",
      "null",
      '{"version":2}',
      '{"version":1,"groups":{}}',
      "x".repeat(MAX_SESSION_STORAGE_LENGTH + 1),
    ]) {
      storage.setItem(SESSION_SNAPSHOT_STORAGE_KEY, value);
      expect(loadSessionSnapshot(storage)).toBeNull();
    }
    const unavailable = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(loadSessionSnapshot(unavailable)).toBeNull();
    expect(saveSessionSnapshot(exampleSnapshot(), unavailable)).toBe(false);
    expect(loadSessionSnapshot(null)).toBeNull();
    expect(saveSessionSnapshot(exampleSnapshot(), null)).toBe(false);
  });

  it("whitelists metadata again when saving caller-supplied snapshots", () => {
    const storage = new MemoryStorage();
    const snapshot = exampleSnapshot();
    const extra = {
      ...snapshot,
      content: "SECRET_EXTRA",
      groups: snapshot.groups.map((group) => ({
        ...group,
        text: "SECRET_GROUP",
        tabs: group.tabs.map((tab) => ({
          ...tab,
          content: "SECRET_TAB",
          view: { ...tab.view, anchor: "SECRET_VIEW" },
        })),
      })),
    };
    expect(saveSessionSnapshot(extra, storage)).toBe(true);
    expect(storage.getItem(SESSION_SNAPSHOT_STORAGE_KEY)).not.toContain("SECRET");
  });
});

describe("reopenSessionSnapshot", () => {
  it("preserves explicitly empty split groups without reviving filtered untitled tabs", async () => {
    const state = exampleState();
    state.editorGroups = [
      { id: "empty-left", tabIds: [], activeTabId: null, keepEmpty: true },
      {
        id: "untitled-only",
        tabIds: ["untitled"],
        activeTabId: "untitled",
        keepEmpty: true,
      },
      { id: "right", tabIds: ["right-one"], activeTabId: "right-one" },
    ];
    state.activeEditorGroupId = "empty-left";
    state.activeTabId = null;
    const snapshot = buildSessionSnapshot(state, {
      workspacePaths: [],
      activeWorkspacePath: null,
    });
    expect(snapshot.groups).toHaveLength(2);
    expect(snapshot.groups[0]).toEqual({ tabs: [], activeTabIndex: -1, keepEmpty: true });
    const restored = (await reopenSessionSnapshot(snapshot, {
      openDocument: async (path) => editable(path),
    }))!;
    expect(restored.state.editorGroups).toHaveLength(2);
    expect(restored.state.editorGroups[0]).toMatchObject({
      tabIds: [],
      activeTabId: null,
      keepEmpty: true,
    });
    expect(restored.state.activeEditorGroupId).toBe(restored.state.editorGroups[0]!.id);
    expect(restored.state.activeTabId).toBeNull();
  });

  it("reopens fresh disk content once per path and restores independent group views", async () => {
    const snapshot = exampleSnapshot();
    const openDocument = vi.fn(async (path: string) =>
      editable(path, "Changed on disk after closing\n"),
    );
    const restored = await reopenSessionSnapshot(snapshot, { openDocument });
    expect(openDocument.mock.calls).toEqual([["/fixtures/one.md"], ["/fixtures/two.md"]]);
    expect(restored!.skippedPaths).toEqual([]);
    const { state } = restored!;
    expect(Object.keys(state.sessions)).toHaveLength(2);
    expect(state.sessions["/fixtures/one.md"]).toMatchObject({
      text: "Changed on disk after closing\n",
      dirty: false,
    });
    expect(state.editorGroups).toHaveLength(2);
    expect(state.activeEditorGroupId).toBe(state.editorGroups[1]!.id);
    expect(state.activeTabId).toBe(state.editorGroups[1]!.activeTabId);
    const left = state.tabs[state.editorGroups[0]!.tabIds[0]!]!;
    const right = state.tabs[state.editorGroups[1]!.tabIds[0]!]!;
    expect(left.current.documentId).toBe(right.current.documentId);
    expect(left.current.view).toMatchObject({ editorMode: "source", sourceScrollTop: 180 });
    expect(right.current.view).toMatchObject({
      editorMode: "visual",
      visualScrollTop: 240,
    });
    expect(left.current.view).not.toBe(right.current.view);
    expect(state.tabs[state.editorGroups[0]!.activeTabId!]!.preview).toBe(true);
    expect(state.navigation).toEqual({ visits: [], index: -1 });
    for (const tab of Object.values(state.tabs)) {
      expect(tab.back).toEqual([]);
      expect(tab.forward).toEqual([]);
    }
  });

  it("skips missing and blocked files and falls back to a surviving group", async () => {
    const snapshot: SessionSnapshot = {
      ...exampleSnapshot(),
      activeGroupIndex: 0,
      groups: [
        {
          tabs: [
            { path: "/missing.md", preview: true, view: createViewState() },
            { path: "/blocked.md", preview: false, view: createViewState() },
          ],
          activeTabIndex: 0,
        },
        {
          tabs: [
            {
              path: "/short.py",
              preview: true,
              view: createViewState({
                selectionFrom: 999,
                selectionTo: 999,
                visualSelectionFrom: 999,
              }),
            },
          ],
          activeTabIndex: 0,
        },
      ],
    };
    const openDocument = vi.fn(async (path: string): Promise<OpenDocumentResult> => {
      if (path === "/missing.md") throw new Error("missing");
      if (path === "/blocked.md")
        return {
          status: "blocked",
          path,
          reason: "largeDataUri",
          preflight: { sizeBytes: 99, longestLineBytes: 99, containsDataImageBase64: true },
        };
      return { ...editable(path, "x"), documentKind: "text", language: "python" };
    });
    const restored = (await reopenSessionSnapshot(snapshot, { openDocument }))!;
    expect(restored.skippedPaths).toEqual(["/missing.md", "/blocked.md"]);
    expect(restored.state.editorGroups).toHaveLength(1);
    expect(restored.state.activeEditorGroupId).toBe(restored.state.editorGroups[0]!.id);
    expect(restored.state.tabs[restored.state.activeTabId!]!.current.view).toMatchObject({
      editorMode: "source",
      selectionFrom: 1,
      selectionTo: 1,
      visualSelectionFrom: 1,
    });
  });

  it("returns an empty editor when no saved path can be reopened", async () => {
    const restored = await reopenSessionSnapshot(exampleSnapshot(), {
      openDocument: async () => {
        throw new Error("gone");
      },
    });
    expect(restored!.state).toEqual(createInitialAppState());
    expect(restored!.skippedPaths).toHaveLength(2);
  });

  it("honors current source-only classification and canonical disk paths", async () => {
    const snapshot = exampleSnapshot();
    const restored = (await reopenSessionSnapshot(snapshot, {
      openDocument: async () => ({ ...editable("/canonical/same.md"), mode: "sourceOnly" }),
    }))!;
    expect(Object.keys(restored.state.sessions)).toEqual(["/canonical/same.md"]);
    for (const tab of Object.values(restored.state.tabs)) {
      expect(tab.current.path).toBe("/canonical/same.md");
      expect(tab.current.view.editorMode).toBe("source");
    }
  });

  it("discards late reads after cancellation and does not start remaining files", async () => {
    let complete: (result: OpenDocumentResult) => void = () => {};
    const openDocument = vi.fn(
      () =>
        new Promise<OpenDocumentResult>((resolve) => {
          complete = resolve;
        }),
    );
    let current = true;
    const pending = reopenSessionSnapshot(
      exampleSnapshot(),
      { openDocument },
      () => current,
    );
    expect(openDocument).toHaveBeenCalledOnce();
    current = false;
    complete(editable("/fixtures/one.md"));
    expect(await pending).toBeNull();
    expect(openDocument).toHaveBeenCalledOnce();
    openDocument.mockClear();
    expect(
      await reopenSessionSnapshot(exampleSnapshot(), { openDocument }, () => false),
    ).toBeNull();
    expect(openDocument).not.toHaveBeenCalled();
  });
});
