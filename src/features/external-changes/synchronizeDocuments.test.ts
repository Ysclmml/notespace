import { describe, expect, it, vi } from "vitest";
import {
  appStateReducer,
  closeTab,
  createInitialAppState,
  editDocument,
  markDocumentSaved,
  openInNewTab,
  type AppState,
} from "../../app/state";
import type {
  DesktopAdapter,
  OpenDocumentResult,
} from "../../infrastructure/tauri/desktopAdapter";
import { referencedFilePaths, synchronizeDocuments } from "./synchronizeDocuments";

const PATH = "/synthetic/note.md";
function fixture() {
  let state = appStateReducer(
    createInitialAppState(),
    openInNewTab("tab", {
      path: PATH,
      text: "old",
      diskMtimeMs: 0,
      diskRevision: "one",
      mode: "normal",
    }),
  );
  const commit = (action: Parameters<typeof appStateReducer>[1]) => {
    state = appStateReducer(state, action);
  };
  const openDocument = vi.fn(async (): Promise<OpenDocumentResult> => ({
    status: "editable",
    path: PATH,
    content: "new",
    diskRevision: "two",
    mode: "normal",
    documentKind: "markdown",
    language: "markdown",
    preflight: { sizeBytes: 3, longestLineBytes: 3, containsDataImageBase64: false },
  }));
  const inspectDocuments = vi.fn(async () => [
    { path: PATH, status: "present" as const, revision: "two" },
  ]);
  const adapter = { openDocument, inspectDocuments } as unknown as DesktopAdapter;
  const isSaving = vi.fn(() => false);
  const onNotice = vi.fn();
  const sync = () =>
    synchronizeDocuments({ adapter, commit, getState: () => state, isSaving, onNotice });
  return {
    get state() {
      return state;
    },
    set state(next: AppState) {
      state = next;
    },
    commit,
    openDocument,
    inspectDocuments,
    isSaving,
    onNotice,
    sync,
  };
}

describe("external disk reconciliation", () => {
  it("reloads a clean shared body without changing tabs or navigation", async () => {
    const f = fixture();
    const tabs = f.state.tabs;
    const navigation = f.state.navigation;
    await f.sync();
    expect(f.state.sessions[PATH]).toMatchObject({
      text: "new",
      diskRevision: "two",
      dirty: false,
    });
    expect(f.state.tabs).toBe(tabs);
    expect(f.state.navigation).toBe(navigation);
    await f.sync();
    expect(f.openDocument).toHaveBeenCalledTimes(1);
  });
  it("keeps dirty edits and pauses them via conflict without reading disk bodies", async () => {
    const f = fixture();
    f.commit(editDocument(PATH, "draft"));
    await f.sync();
    expect(f.state.sessions[PATH]).toMatchObject({
      text: "draft",
      dirty: true,
      diskRevision: "one",
      externalChange: { status: "modified", revision: "two" },
    });
    expect(f.openDocument).not.toHaveBeenCalled();
    await f.sync();
    expect(f.onNotice).toHaveBeenCalledTimes(1);
  });
  it.each(["missing", "unreadable"] as const)(
    "retains an open buffer when %s",
    async (status) => {
      const f = fixture();
      f.inspectDocuments.mockResolvedValue([
        { path: PATH, status, revision: undefined },
      ] as never);
      await f.sync();
      expect(f.state.sessions[PATH]).toMatchObject({
        text: "old",
        externalChange: { status },
      });
      expect(f.state.tabs.tab).toBeDefined();
      expect(f.openDocument).not.toHaveBeenCalled();
    },
  );
  it("clears a conflict when the original revision reappears, keeping drafts", async () => {
    const f = fixture();
    f.commit(editDocument(PATH, "draft"));
    await f.sync();
    f.inspectDocuments.mockResolvedValue([
      { path: PATH, status: "present", revision: "one" },
    ]);
    await f.sync();
    expect(f.state.sessions[PATH]).toMatchObject({ text: "draft", dirty: true });
    expect(f.state.sessions[PATH]?.externalChange).toBeUndefined();
  });
  it("does not inspect while an own save is in flight or reload its resulting revision", async () => {
    const f = fixture();
    f.isSaving.mockReturnValue(true);
    await f.sync();
    expect(f.inspectDocuments).not.toHaveBeenCalled();
    f.isSaving.mockReturnValue(false);
    f.commit(markDocumentSaved(PATH, "old", 0, "two"));
    await f.sync();
    expect(f.openDocument).not.toHaveBeenCalled();
    expect(f.state.sessions[PATH]?.externalChange).toBeUndefined();
  });
  it.each(["edit", "save", "close"] as const)(
    "does not overwrite a late %s during reload",
    async (change) => {
      const f = fixture();
      const result = await f.openDocument();
      f.openDocument.mockImplementationOnce(async () => {
        if (change === "edit") f.commit(editDocument(PATH, "draft"));
        if (change === "save") f.commit(markDocumentSaved(PATH, "old", 0, "three"));
        if (change === "close") f.commit(closeTab("tab"));
        return result;
      });
      await f.sync();
      expect(f.state.sessions[PATH]?.text).not.toBe("new");
      if (change === "edit")
        expect(f.state.sessions[PATH]).toMatchObject({
          text: "draft",
          externalChange: { status: "modified" },
        });
      if (change === "close") expect(referencedFilePaths(f.state)).toEqual([]);
    },
  );
  it("does not load or repeatedly preflight blocked new contents", async () => {
    const f = fixture();
    f.openDocument.mockResolvedValue({
      status: "blocked",
      path: PATH,
      reason: "largeDataUri",
      preflight: {
        sizeBytes: 999999,
        longestLineBytes: 999999,
        containsDataImageBase64: true,
      },
    });
    await f.sync();
    await f.sync();
    expect(f.openDocument).toHaveBeenCalledTimes(1);
    expect(f.state.sessions[PATH]).toMatchObject({
      text: "old",
      externalChange: { status: "blocked" },
    });
  });
  it("includes history-only sessions and excludes untitled documents", () => {
    const f = fixture();
    f.state.tabs.tab!.back.push({ ...f.state.tabs.tab!.current });
    f.state.tabs.tab!.current = {
      ...f.state.tabs.tab!.current,
      documentId: "untitled://1",
      path: "untitled://1",
    };
    f.state.sessions["untitled://1"] = {
      ...f.state.sessions[PATH]!,
      id: "untitled://1",
      path: "untitled://1",
    };
    expect(referencedFilePaths(f.state)).toEqual([PATH]);
  });
});
