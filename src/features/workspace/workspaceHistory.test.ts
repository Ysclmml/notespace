import { describe, expect, it } from "vitest";

import {
  activateRememberedWorkspace,
  emptyWorkspaceHistory,
  forgetOpenWorkspace,
  getWorkspaceImageDirectory,
  getWorkspaceShowHidden,
  loadWorkspaceHistory,
  normalizeWorkspaceImageDirectoryPath,
  rememberFile,
  rememberWorkspace,
  saveWorkspaceHistory,
  setWorkspaceShowHidden,
  setWorkspaceImageDirectory,
  WORKSPACE_HISTORY_STORAGE_KEY,
  type StorageLike,
  type WorkspaceHistoryState,
} from "./workspaceHistory";

function memoryStorage(): StorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("workspace history", () => {
  it("persists multiple open workspaces, active workspace and recent files", () => {
    const storage = memoryStorage();
    let state = rememberWorkspace(emptyWorkspaceHistory, { path: "/a", name: "A" }, 1);
    state = rememberWorkspace(state, { path: "/b", name: "B" }, 2);
    state = rememberFile(state, { path: "/outside/note.py", name: "note.py" }, 3);
    saveWorkspaceHistory(state, storage);

    expect(loadWorkspaceHistory(storage)).toEqual(state);
    expect(storage.values.has(WORKSPACE_HISTORY_STORAGE_KEY)).toBe(true);
  });

  it("switches and closes workspaces without deleting recents", () => {
    let state = rememberWorkspace(emptyWorkspaceHistory, { path: "/a", name: "A" }, 1);
    state = rememberWorkspace(state, { path: "/b", name: "B" }, 2);
    state = activateRememberedWorkspace(state, "/a");
    state = forgetOpenWorkspace(state, "/a");

    expect(state.openWorkspaces.map((item) => item.path)).toEqual(["/b"]);
    expect(state.activeWorkspacePath).toBe("/b");
    expect(state.recentWorkspaces.map((item) => item.path)).toEqual(["/b", "/a"]);
  });

  it("fails closed to an empty convenience history when storage is malformed", () => {
    const storage = memoryStorage();
    storage.setItem(WORKSPACE_HISTORY_STORAGE_KEY, "{broken");
    expect(loadWorkspaceHistory(storage)).toBe(emptyWorkspaceHistory);
  });

  it("persists independent hidden-entry preferences without changing workspace activity", () => {
    const storage = memoryStorage();
    let state = rememberWorkspace(emptyWorkspaceHistory, { path: "/a", name: "A" }, 1);
    state = rememberWorkspace(state, { path: "/b", name: "B" }, 2);
    expect(getWorkspaceShowHidden(state, "/a")).toBe(false);
    expect(getWorkspaceShowHidden(state, "/missing")).toBe(false);

    state = setWorkspaceShowHidden(state, "/a", true);
    saveWorkspaceHistory(state, storage);
    state = loadWorkspaceHistory(storage);

    expect(getWorkspaceShowHidden(state, "/a")).toBe(true);
    expect(getWorkspaceShowHidden(state, "/b")).toBe(false);
    expect(state.activeWorkspacePath).toBe("/b");
    expect(
      state.openWorkspaces.map(({ path, lastOpenedAt }) => ({ path, lastOpenedAt })),
    ).toEqual([
      { path: "/a", lastOpenedAt: 1 },
      { path: "/b", lastOpenedAt: 2 },
    ]);

    state = forgetOpenWorkspace(state, "/a");
    expect(getWorkspaceShowHidden(state, "/a")).toBe(true);
    state = rememberWorkspace(state, { path: "/a", name: "A" }, 3);
    expect(state.openWorkspaces.at(-1)?.showHidden).toBe(true);
    state = setWorkspaceShowHidden(state, "/a", false);
    expect(state.recentWorkspaces.find((item) => item.path === "/a")?.showHidden).toBe(
      false,
    );
    expect(getWorkspaceShowHidden(state, "/a")).toBe(false);
  });

  it("defaults old and malformed preferences off while retaining valid workspace records", () => {
    const storage = memoryStorage();
    storage.setItem(
      WORKSPACE_HISTORY_STORAGE_KEY,
      JSON.stringify({
        openWorkspaces: [
          { path: "/old", name: "Old", lastOpenedAt: 1 },
          { path: "/invalid", name: "Invalid", lastOpenedAt: 2, showHidden: "true" },
          { path: "/valid", name: "Valid", lastOpenedAt: 3, showHidden: true },
        ],
      }),
    );
    const state = loadWorkspaceHistory(storage);
    expect(state.openWorkspaces).toHaveLength(3);
    expect(getWorkspaceShowHidden(state, "/old")).toBe(false);
    expect(getWorkspaceShowHidden(state, "/invalid")).toBe(false);
    expect(state.openWorkspaces[1]).not.toHaveProperty("showHidden");
    expect(getWorkspaceShowHidden(state, "/valid")).toBe(true);
  });

  it("persists image directories per workspace and keeps the preference after reopening", () => {
    const storage = memoryStorage();
    let state = rememberWorkspace(emptyWorkspaceHistory, { path: "/a", name: "A" }, 1);
    state = rememberWorkspace(state, { path: "/b", name: "B" }, 2);
    expect(getWorkspaceImageDirectory(state, "/a")).toBeNull();
    expect(getWorkspaceImageDirectory(state, "/missing")).toBeNull();

    state = setWorkspaceImageDirectory(state, "/a", "/a/图片 资料");
    state = setWorkspaceShowHidden(state, "/a", true);
    saveWorkspaceHistory(state, storage);
    state = loadWorkspaceHistory(storage);
    expect(getWorkspaceImageDirectory(state, "/a")).toBe("/a/图片 资料");
    expect(getWorkspaceImageDirectory(state, "/b")).toBeNull();
    expect(state.activeWorkspacePath).toBe("/b");
    expect(state.openWorkspaces[0]?.lastOpenedAt).toBe(1);
    expect(getWorkspaceShowHidden(state, "/a")).toBe(true);

    state = forgetOpenWorkspace(state, "/a");
    state = rememberWorkspace(state, { path: "/a", name: "A" }, 3);
    expect(getWorkspaceImageDirectory(state, "/a")).toBe("/a/图片 资料");
    state = rememberWorkspace(
      state,
      { path: "/a", name: "A", imageDirectoryPath: null },
      4,
    );
    expect(getWorkspaceImageDirectory(state, "/a")).toBeNull();
    expect(state.recentWorkspaces[0]?.imageDirectoryPath).toBeNull();
    expect(getWorkspaceShowHidden(state, "/a")).toBe(true);
  });

  it("resets one image destination without changing other roots or unrelated state", () => {
    let state = rememberWorkspace(emptyWorkspaceHistory, { path: "/a", name: "A" }, 1);
    state = rememberWorkspace(state, { path: "/b", name: "B" }, 2);
    state = rememberFile(state, { path: "/a/note.md", name: "note.md" }, 3);
    state = setWorkspaceImageDirectory(state, "/a", "/images/a");
    state = setWorkspaceImageDirectory(state, "/b", "/images/b");
    const recentFiles = state.recentFiles;
    state = setWorkspaceImageDirectory(state, "/a", null);
    expect(getWorkspaceImageDirectory(state, "/a")).toBeNull();
    expect(getWorkspaceImageDirectory(state, "/b")).toBe("/images/b");
    expect(state.activeWorkspacePath).toBe("/b");
    expect(state.recentFiles).toBe(recentFiles);
    expect(setWorkspaceImageDirectory(state, "/missing", "/images/c")).toEqual(state);
  });

  it.each([
    undefined,
    null,
    12,
    {},
    "",
    "assets",
    "../images",
    "file:///images",
    "https://example.test/images",
    "C:images",
    "/bad\npath",
    "/bad\u0000path",
    `/${"a".repeat(4096)}`,
  ])("defaults invalid image destinations to the document directory: %j", (value) => {
    expect(normalizeWorkspaceImageDirectoryPath(value)).toBeNull();
    const storage = memoryStorage();
    storage.setItem(
      WORKSPACE_HISTORY_STORAGE_KEY,
      JSON.stringify({
        openWorkspaces: [
          { path: "/a", name: "A", lastOpenedAt: 1, imageDirectoryPath: value },
        ],
      }),
    );
    const state = loadWorkspaceHistory(storage);
    expect(state.openWorkspaces).toHaveLength(1);
    expect(getWorkspaceImageDirectory(state, "/a")).toBeNull();
  });

  it.each([
    "/images",
    "/图片 资料",
    "C:\\Images",
    "D:/Pictures",
    "\\\\server\\share\\images",
  ])("preserves concrete native directory paths: %s", (path) =>
    expect(normalizeWorkspaceImageDirectoryPath(path)).toBe(path),
  );

  it("whitelists persisted fields instead of writing document data or unrecognized preferences", () => {
    const storage = memoryStorage();
    const workspace = {
      path: "/a",
      name: "A",
      lastOpenedAt: 1,
      imageDirectoryPath: "/images",
      text: "DO NOT SAVE DOCUMENT TEXT",
      arbitraryPreference: true,
    };
    const file = {
      path: "/a/note.md",
      name: "note.md",
      lastOpenedAt: 2,
      text: "DO NOT SAVE DOCUMENT TEXT",
      imageDirectoryPath: "/not-a-file-setting",
    };
    const state: WorkspaceHistoryState = {
      openWorkspaces: [workspace],
      recentWorkspaces: [workspace],
      recentFiles: [file],
      activeWorkspacePath: "/a",
    };
    saveWorkspaceHistory(state, storage);
    const serialized = storage.getItem(WORKSPACE_HISTORY_STORAGE_KEY)!;
    expect(serialized).not.toContain("DO NOT SAVE");
    expect(serialized).not.toContain("arbitraryPreference");
    expect(serialized).not.toContain("not-a-file-setting");
    expect(loadWorkspaceHistory(storage).openWorkspaces[0]?.imageDirectoryPath).toBe(
      "/images",
    );

    storage.setItem(WORKSPACE_HISTORY_STORAGE_KEY, JSON.stringify(state));
    expect(loadWorkspaceHistory(storage).recentFiles[0]).toEqual({
      path: "/a/note.md",
      name: "note.md",
      lastOpenedAt: 2,
    });
  });
});
