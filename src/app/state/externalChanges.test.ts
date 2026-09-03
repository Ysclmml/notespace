import { describe, expect, it } from "vitest";

import {
  INITIAL_EDITOR_GROUP_ID,
  appStateReducer,
  closeTab,
  createInitialAppState,
  createViewState,
  editDocument,
  goBack,
  markDocumentExternalChange,
  markDocumentSaved,
  openInCurrent,
  openInNewTab,
  openPreviewTab,
  reloadDocument,
  relocateDocument,
  splitTabRight,
  updateView,
  type AppState,
  type AppStateAction,
  type DocumentExternalChange,
  type OpenDocument,
} from ".";

const PATH = "/fixtures/current.md";
const OTHER_PATH = "/fixtures/other.md";

function document(overrides: Partial<OpenDocument> = {}): OpenDocument {
  return {
    path: PATH,
    text: "# Original disk text\n",
    diskMtimeMs: 1,
    diskRevision: "revision-1",
    mode: "normal",
    kind: "markdown",
    language: "markdown",
    ...overrides,
  };
}

function reduce(state: AppState, ...actions: AppStateAction[]): AppState {
  return actions.reduce(appStateReducer, state);
}

function initial(opened = document()): AppState {
  return appStateReducer(createInitialAppState(), openInNewTab("left", opened));
}

function fresh(overrides: Partial<OpenDocument> = {}): OpenDocument {
  return document({
    text: "# Fresh disk text\n",
    diskMtimeMs: 2,
    diskRevision: "revision-2",
    ...overrides,
  });
}

function reload(state: AppState, opened = fresh(), allowDirty = false): AppState {
  const session = state.sessions[PATH]!;
  return appStateReducer(
    state,
    reloadDocument(PATH, opened, session.text, session.diskRevision, allowDirty),
  );
}

describe("external document status", () => {
  it.each(["modified", "missing", "unreadable", "blocked"] as const)(
    "records %s without replacing either clean or dirty contents",
    (status) => {
      const clean = initial();
      for (const before of [clean, appStateReducer(clean, editDocument(PATH, "Draft"))]) {
        const change: DocumentExternalChange = { status, revision: "revision-2" };
        const after = appStateReducer(before, markDocumentExternalChange(PATH, change));
        expect(after.sessions[PATH]).toEqual({
          ...before.sessions[PATH],
          externalChange: change,
        });
        expect(after.tabs).toBe(before.tabs);
        expect(after.navigation).toBe(before.navigation);
        expect(appStateReducer(after, markDocumentExternalChange(PATH, change))).toBe(
          after,
        );
      }
    },
  );

  it("clears a reverted disk conflict while retaining the dirty draft", () => {
    const before = reduce(
      initial(),
      editDocument(PATH, "Unsaved draft"),
      markDocumentExternalChange(PATH, { status: "missing" }),
    );
    const after = appStateReducer(before, markDocumentExternalChange(PATH, undefined));
    expect(after.sessions[PATH]).toMatchObject({
      text: "Unsaved draft",
      dirty: true,
      diskRevision: "revision-1",
    });
    expect(after.sessions[PATH]!.externalChange).toBeUndefined();
    expect(appStateReducer(after, markDocumentExternalChange(PATH, undefined))).toBe(after);
  });

  it("ignores observations for missing or no-longer-referenced sessions", () => {
    const closed = appStateReducer(initial(), closeTab("left"));
    for (const state of [createInitialAppState(), closed]) {
      expect(
        appStateReducer(state, markDocumentExternalChange(PATH, { status: "missing" })),
      ).toBe(state);
    }
  });
});

describe("guarded disk reload", () => {
  it("updates a shared clean session while preserving all tab positions, groups and history", () => {
    const before = reduce(
      initial(),
      updateView("left", createViewState({ visualScrollTop: 190, visualSelectionFrom: 8 })),
      openInCurrent("left", document({ path: OTHER_PATH })),
      goBack("left"),
      splitTabRight("left", "right", "right-group"),
      updateView(
        "right",
        createViewState({ editorMode: "source", sourceScrollTop: 240, selectionFrom: 5 }),
      ),
      markDocumentExternalChange(PATH, { status: "modified", revision: "revision-2" }),
    );
    const after = reload(before);
    expect(after.sessions[PATH]).toMatchObject({
      text: fresh().text,
      diskRevision: "revision-2",
      diskMtimeMs: 2,
      dirty: false,
    });
    expect(after.sessions[PATH]!.externalChange).toBeUndefined();
    expect(after.sessions[OTHER_PATH]).toBe(before.sessions[OTHER_PATH]);
    expect(after.tabs).toBe(before.tabs);
    expect(after.editorGroups).toBe(before.editorGroups);
    expect(after.navigation).toBe(before.navigation);
    expect(after.activeTabId).toBe("right");
  });

  it("can refresh a clean document owned only by tab history", () => {
    const before = appStateReducer(
      initial(),
      openInCurrent("left", document({ path: OTHER_PATH })),
    );
    const after = reload(before);
    expect(after.sessions[PATH]!.text).toBe(fresh().text);
    expect(after.tabs).toBe(before.tabs);
    expect(after.tabs.left!.current.path).toBe(OTHER_PATH);
    expect(after.tabs.left!.back[0]!.path).toBe(PATH);
  });

  it("does not replace dirty text until discard is explicitly allowed", () => {
    const before = reduce(
      initial(),
      editDocument(PATH, "Unsaved draft"),
      markDocumentExternalChange(PATH, { status: "modified", revision: "revision-2" }),
    );
    expect(reload(before)).toBe(before);
    const after = reload(before, fresh(), true);
    expect(after.sessions[PATH]).toMatchObject({ text: fresh().text, dirty: false });
    expect(after.sessions[PATH]!.externalChange).toBeUndefined();
    expect(after.tabs).toBe(before.tabs);
    expect(after.navigation).toBe(before.navigation);
  });

  it.each([false, true])(
    "rejects a late read after editing, even with allowDirty=%s",
    (allowDirty) => {
      const before = initial();
      const action = reloadDocument(
        PATH,
        fresh(),
        before.sessions[PATH]!.text,
        "revision-1",
        allowDirty,
      );
      const edited = appStateReducer(before, editDocument(PATH, "Newer local edit"));
      expect(appStateReducer(edited, action)).toBe(edited);
    },
  );

  it("rejects a late read after a same-text save advances the disk baseline", () => {
    const before = initial();
    const action = reloadDocument(PATH, fresh(), before.sessions[PATH]!.text, "revision-1");
    const saved = appStateReducer(
      before,
      markDocumentSaved(PATH, before.sessions[PATH]!.text, 3, "revision-3"),
    );
    expect(appStateReducer(saved, action)).toBe(saved);
  });

  it("requires an exact revision match, including a missing legacy revision", () => {
    const legacy = initial(document({ diskRevision: undefined }));
    expect(reload(legacy).sessions[PATH]!.diskRevision).toBe("revision-2");
    expect(
      appStateReducer(legacy, reloadDocument(PATH, fresh(), document().text, "revision-1")),
    ).toBe(legacy);
    const versioned = initial();
    expect(appStateReducer(versioned, reloadDocument(PATH, fresh(), document().text))).toBe(
      versioned,
    );
  });

  it.each([false, true])("does not resurrect a closed session (dirty=%s)", (dirty) => {
    const before = dirty
      ? appStateReducer(initial(), editDocument(PATH, "Draft"))
      : initial();
    const action = reloadDocument(
      PATH,
      fresh(),
      before.sessions[PATH]!.text,
      "revision-1",
      true,
    );
    const closed = appStateReducer(before, closeTab("left"));
    expect(appStateReducer(closed, action)).toBe(closed);
    expect(Object.keys(closed.tabs)).toEqual([]);
    if (dirty) expect(closed.sessions[PATH]).toBeUndefined();
    else expect(closed.sessions[PATH]!.text).toBe(document().text);
  });

  it("rejects mismatching paths, session identities and results arriving after Save As", () => {
    const before = initial();
    expect(reload(before, fresh({ path: OTHER_PATH }))).toBe(before);
    const malformed: AppState = {
      ...before,
      sessions: {
        ...before.sessions,
        [PATH]: { ...before.sessions[PATH]!, id: OTHER_PATH },
      },
    };
    expect(reload(malformed)).toBe(malformed);
    const relocated = appStateReducer(
      before,
      relocateDocument(PATH, fresh({ path: OTHER_PATH }), document().text),
    );
    expect(
      appStateReducer(
        relocated,
        reloadDocument(PATH, fresh(), document().text, "revision-1"),
      ),
    ).toBe(relocated);
  });

  it.each([{ mode: "sourceOnly" as const }, { kind: "text" as const, language: "python" }])(
    "normalizes source-only views in current/back/forward and window visits without adding history (%j)",
    (classification) => {
      const before = reduce(
        initial(),
        updateView(
          "left",
          createViewState({ visualScrollTop: 144, sourceScrollTop: 70, selectionFrom: 3 }),
        ),
        splitTabRight("left", "right", "right-group"),
        openInCurrent("left", document({ path: OTHER_PATH })),
        openInCurrent("right", document({ path: OTHER_PATH })),
        goBack("right"),
        openInNewTab("third", document({ path: OTHER_PATH })),
        openInCurrent("third", document()),
        goBack("third"),
      );
      const after = reload(before, fresh(classification));
      for (const [tabId, tab] of Object.entries(after.tabs)) {
        const original = before.tabs[tabId]!;
        const entries = [tab.current, ...tab.back, ...tab.forward];
        const originalEntries = [original.current, ...original.back, ...original.forward];
        expect(entries).toHaveLength(originalEntries.length);
        entries.forEach((entry, index) => {
          const old = originalEntries[index]!;
          expect(entry).toEqual(
            entry.documentId === PATH
              ? {
                  ...old,
                  view: { ...old.view, editorMode: "source" },
                }
              : old,
          );
        });
      }
      expect(after.navigation.index).toBe(before.navigation.index);
      expect(after.navigation.visits).toHaveLength(before.navigation.visits.length);
      after.navigation.visits.forEach((visit, index) => {
        const original = before.navigation.visits[index]!;
        expect(visit).toEqual(
          visit.entry.documentId === PATH
            ? {
                ...original,
                entry: {
                  ...original.entry,
                  view: { ...original.entry.view, editorMode: "source" },
                },
              }
            : original,
        );
      });
      expect(after.editorGroups).toBe(before.editorGroups);
      expect(after.activeTabId).toBe(before.activeTabId);
    },
  );
});

describe("closed caches and save baselines", () => {
  it.each(["new", "current", "preview", "right"] as const)(
    "uses the fresh disk body when reopening a clean closed cache via %s",
    (target) => {
      let before = reduce(
        initial(),
        markDocumentExternalChange(PATH, { status: "modified", revision: "revision-2" }),
        closeTab("left"),
      );
      expect(before.sessions[PATH]!.text).toBe(document().text);
      let action: AppStateAction;
      if (target === "current" || target === "right") {
        before = appStateReducer(
          before,
          openInNewTab("other", document({ path: OTHER_PATH })),
        );
      }
      if (target === "current") action = openInCurrent("other", fresh());
      else if (target === "preview") action = openPreviewTab("fresh", fresh());
      else if (target === "right")
        action = {
          type: "editor-group/open-right",
          sourceGroupId: INITIAL_EDITOR_GROUP_ID,
          newGroupId: "right-group",
          tabId: "fresh",
          document: fresh(),
          focus: true,
        };
      else action = openInNewTab("fresh", fresh());
      const after = appStateReducer(before, action);
      expect(after.sessions[PATH]).toMatchObject({
        text: fresh().text,
        diskRevision: "revision-2",
        diskMtimeMs: 2,
        dirty: false,
      });
      expect(after.sessions[PATH]!.externalChange).toBeUndefined();
    },
  );

  it.each([false, true])(
    "preserves a still-referenced clean/dirty session when another tab closes (dirty=%s)",
    (dirty) => {
      let before = reduce(initial(), openInNewTab("shared", document()), closeTab("left"));
      if (dirty) before = appStateReducer(before, editDocument(PATH, "Shared dirty draft"));
      const after = appStateReducer(before, openInNewTab("reopened", fresh()));
      expect(after.sessions[PATH]).toBe(before.sessions[PATH]);
      expect(after.tabs.shared).toBe(before.tabs.shared);
    },
  );

  it.each([false, true])(
    "does not silently replace a body still owned by history (dirty=%s)",
    (dirty) => {
      let before = initial();
      if (dirty)
        before = appStateReducer(before, editDocument(PATH, "Historical dirty draft"));
      before = appStateReducer(
        before,
        openInCurrent("left", document({ path: OTHER_PATH })),
      );
      const after = appStateReducer(before, openPreviewTab("preview", fresh()));
      expect(after.sessions[PATH]).toBe(before.sessions[PATH]);
      expect(after.tabs.left!.back).toBe(before.tabs.left!.back);
      expect(after.tabs.preview!.preview).toBe(!dirty);
    },
  );

  it("advances a safe save baseline and clears conflict without clearing later edits", () => {
    const before = reduce(
      initial(),
      editDocument(PATH, "Newer draft"),
      markDocumentExternalChange(PATH, { status: "modified", revision: "revision-2" }),
    );
    const after = appStateReducer(
      before,
      markDocumentSaved(PATH, "Saved earlier draft", 3, "revision-3"),
    );
    expect(after.sessions[PATH]).toMatchObject({
      text: "Newer draft",
      dirty: true,
      diskMtimeMs: 3,
      diskRevision: "revision-3",
    });
    expect(after.sessions[PATH]!.externalChange).toBeUndefined();
    const saved = appStateReducer(
      after,
      markDocumentSaved(PATH, "Newer draft", 4, "revision-4"),
    );
    expect(saved.sessions[PATH]).toMatchObject({
      text: "Newer draft",
      dirty: false,
      diskRevision: "revision-4",
    });
  });

  it("keeps the legacy save API and clears any superseded disk revision", () => {
    const after = appStateReducer(initial(), markDocumentSaved(PATH, document().text, 2));
    expect(after.sessions[PATH]).toMatchObject({ dirty: false, diskMtimeMs: 2 });
    expect(after.sessions[PATH]!.diskRevision).toBeUndefined();
  });

  it.each(["new-path-revision", undefined])(
    "resets old conflict and baseline when relocating (%s)",
    (diskRevision) => {
      const before = reduce(
        initial(),
        editDocument(PATH, "Newer draft"),
        markDocumentExternalChange(PATH, { status: "missing" }),
      );
      const after = appStateReducer(
        before,
        relocateDocument(
          PATH,
          fresh({ path: OTHER_PATH, diskRevision }),
          "Saved earlier draft",
        ),
      );
      expect(after.sessions[PATH]).toBeUndefined();
      expect(after.sessions[OTHER_PATH]).toMatchObject({
        path: OTHER_PATH,
        text: "Newer draft",
        dirty: true,
        diskRevision,
      });
      expect(after.sessions[OTHER_PATH]!.externalChange).toBeUndefined();
      expect(after.tabs.left!.current.path).toBe(OTHER_PATH);
      expect(
        after.navigation.visits.every((visit) => visit.entry.path === OTHER_PATH),
      ).toBe(true);
    },
  );
});
