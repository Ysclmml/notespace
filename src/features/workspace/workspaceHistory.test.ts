import { describe, expect, it } from "vitest";

import {
  activateRememberedWorkspace,
  emptyWorkspaceHistory,
  forgetOpenWorkspace,
  getWorkspaceShowHidden,
  loadWorkspaceHistory,
  rememberFile,
  rememberWorkspace,
  saveWorkspaceHistory,
  setWorkspaceShowHidden,
  WORKSPACE_HISTORY_STORAGE_KEY,
  type StorageLike,
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
});
