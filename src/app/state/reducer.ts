import type { AppStateAction } from "./actions";
import {
  createViewState,
  documentIdFromPath,
  INITIAL_EDITOR_GROUP_ID,
  type AppState,
  type DocumentSession,
  type EditorGroup,
  type HistoryEntry,
  type OpenDocument,
  type Tab,
  type ViewState,
} from "./model";
import {
  findNavigationIndex,
  reconcileNavigation,
  recordNavigationVisit,
  refreshNavigationView,
  restoreTabVisit,
  sameView,
} from "./navigation";

function groupWithTabs(group: EditorGroup, tabIds: string[]): EditorGroup {
  const previousIndex = group.activeTabId ? group.tabIds.indexOf(group.activeTabId) : 0;
  const remaining = new Set(tabIds);
  const neighbor =
    group.tabIds.slice(previousIndex + 1).find((id) => remaining.has(id)) ??
    group.tabIds
      .slice(0, previousIndex)
      .reverse()
      .find((id) => remaining.has(id)) ??
    tabIds[0];
  return {
    ...group,
    tabIds,
    keepEmpty: tabIds.length ? undefined : group.keepEmpty,
    activeTabId:
      group.activeTabId && tabIds.includes(group.activeTabId)
        ? group.activeTabId
        : (neighbor ?? null),
  };
}

/** Keep one empty group at Welcome and retain focus when another group disappears. */
function withEditorGroups(
  state: AppState,
  groups = state.editorGroups,
  focusedGroupId = state.activeEditorGroupId,
): AppState {
  const previousFocusedIndex = groups.findIndex((group) => group.id === focusedGroupId);
  const editorGroups = groups
    .map((group) =>
      groupWithTabs(
        group,
        group.tabIds.filter((id) => Boolean(state.tabs[id])),
      ),
    )
    .filter((group) => group.tabIds.length > 0 || group.keepEmpty);
  if (editorGroups.length === 0) {
    editorGroups.push({
      id: groups[previousFocusedIndex]?.id ?? groups[0]?.id ?? INITIAL_EDITOR_GROUP_ID,
      tabIds: [],
      activeTabId: null,
    });
  }
  const focusedGroup =
    editorGroups.find((group) => group.id === focusedGroupId) ??
    groups
      .slice(previousFocusedIndex + 1)
      .map((group) => editorGroups.find((candidate) => candidate.id === group.id))
      .find((group) => group !== undefined) ??
    groups
      .slice(0, previousFocusedIndex)
      .reverse()
      .map((group) => editorGroups.find((candidate) => candidate.id === group.id))
      .find((group) => group !== undefined) ??
    editorGroups[0]!;
  return {
    ...state,
    editorGroups,
    activeEditorGroupId: focusedGroup.id,
    tabOrder: editorGroups.flatMap((group) => group.tabIds),
    activeTabId: focusedGroup.activeTabId,
  };
}

function copyView(view: ViewState): ViewState {
  return createViewState(view);
}

function copyEntryWithView(entry: HistoryEntry, view?: ViewState): HistoryEntry {
  return {
    ...entry,
    view: copyView(view ?? entry.view),
  };
}

function entryFor(document: OpenDocument, view?: ViewState): HistoryEntry {
  return {
    documentId: documentIdFromPath(document.path),
    path: document.path,
    view: copyView(view ?? createViewState()),
  };
}

function sessionsWithDocument(
  state: AppState,
  document: OpenDocument,
): AppState["sessions"] {
  const { sessions } = state;
  const documentId = documentIdFromPath(document.path);
  const existing = sessions[documentId];
  // A closed clean cache does not own the body. A fresh open must use its disk read.
  if (existing && (existing.dirty || documentIsReferenced(state, documentId)))
    return sessions;

  const session: DocumentSession = {
    id: documentId,
    path: document.path,
    text: document.text,
    diskMtimeMs: document.diskMtimeMs,
    diskRevision: document.diskRevision,
    dirty: document.path.startsWith("untitled://") && document.initialDirty === true,
    mode: document.mode,
    kind: document.kind ?? "markdown",
    language: document.language ?? "markdown",
  };

  return { ...sessions, [documentId]: session };
}

function tabReferencesDocument(tab: Tab, documentId: string): boolean {
  return [tab.current, ...tab.back, ...tab.forward].some(
    (entry) => entry.documentId === documentId,
  );
}

function documentIsReferenced(state: AppState, documentId: string): boolean {
  return Object.values(state.tabs).some((tab) => tabReferencesDocument(tab, documentId));
}

function sourceEntry(entry: HistoryEntry, documentId: string): HistoryEntry {
  return entry.documentId === documentId && entry.view.editorMode !== "source"
    ? { ...entry, view: { ...entry.view, editorMode: "source" } }
    : entry;
}

/** A reclassified disk file must remain source-only when old visits are restored. */
function withSourceViews(state: AppState, documentId: string): AppState {
  return {
    ...state,
    tabs: Object.fromEntries(
      Object.entries(state.tabs).map(([tabId, tab]) => [
        tabId,
        tabReferencesDocument(tab, documentId)
          ? {
              ...tab,
              current: sourceEntry(tab.current, documentId),
              back: tab.back.map((entry) => sourceEntry(entry, documentId)),
              forward: tab.forward.map((entry) => sourceEntry(entry, documentId)),
            }
          : tab,
      ]),
    ),
    navigation: {
      ...state.navigation,
      visits: state.navigation.visits.map((visit) => {
        const entry = sourceEntry(visit.entry, documentId);
        return entry === visit.entry ? visit : { ...visit, entry };
      }),
    },
  };
}

function tabHasDirtyDocuments(state: AppState, tab: Tab): boolean {
  return [tab.current, ...tab.back, ...tab.forward].some(
    (entry) => state.sessions[entry.documentId]?.dirty,
  );
}

/** A new branch drops forward navigation, but its unsaved documents still need an owner. */
function historyBeforeNavigation(
  state: AppState,
  tab: Tab,
  targetDocumentId: string,
  previousView?: ViewState,
): HistoryEntry[] {
  const previous = copyEntryWithView(tab.current, previousView);
  const retainedDocumentIds = new Set([
    targetDocumentId,
    previous.documentId,
    ...tab.back.map((entry) => entry.documentId),
  ]);
  const retainedDirty: HistoryEntry[] = [];
  for (let index = tab.forward.length - 1; index >= 0; index--) {
    const entry = tab.forward[index]!;
    if (
      state.sessions[entry.documentId]?.dirty &&
      !retainedDocumentIds.has(entry.documentId)
    ) {
      retainedDirty.push(copyEntryWithView(entry));
      retainedDocumentIds.add(entry.documentId);
    }
  }
  // Keep the page just left as the immediate Back destination, after retained dirty pages.
  return [...tab.back, ...retainedDirty, previous];
}

function moveBack(tab: Tab, currentView?: ViewState): Tab {
  const destination = tab.back.at(-1);
  if (!destination) return tab;

  return {
    ...tab,
    current: copyEntryWithView(destination),
    back: tab.back.slice(0, -1),
    forward: [...tab.forward, copyEntryWithView(tab.current, currentView)],
  };
}

function moveForward(tab: Tab, currentView?: ViewState): Tab {
  const destination = tab.forward.at(-1);
  if (!destination) return tab;

  return {
    ...tab,
    current: copyEntryWithView(destination),
    back: [...tab.back, copyEntryWithView(tab.current, currentView)],
    forward: tab.forward.slice(0, -1),
  };
}

function relocateEntry(
  entry: HistoryEntry,
  fromDocumentId: string,
  toDocumentId: string,
  toPath: string,
): HistoryEntry {
  if (entry.documentId !== fromDocumentId) return entry;
  return { ...entry, documentId: toDocumentId, path: toPath };
}

function relocateTab(
  tab: Tab,
  fromDocumentId: string,
  toDocumentId: string,
  toPath: string,
): Tab {
  return {
    ...tab,
    current: relocateEntry(tab.current, fromDocumentId, toDocumentId, toPath),
    back: tab.back.map((entry) =>
      relocateEntry(entry, fromDocumentId, toDocumentId, toPath),
    ),
    forward: tab.forward.map((entry) =>
      relocateEntry(entry, fromDocumentId, toDocumentId, toPath),
    ),
  };
}

function discardDocumentsFromTab(
  tab: Tab,
  discardedDocumentIds: ReadonlySet<string>,
): Tab | null {
  const back = tab.back.filter((entry) => !discardedDocumentIds.has(entry.documentId));
  const forward = tab.forward.filter(
    (entry) => !discardedDocumentIds.has(entry.documentId),
  );

  if (!discardedDocumentIds.has(tab.current.documentId)) {
    return { ...tab, back, forward };
  }

  const previous = back.at(-1);
  if (previous) {
    return {
      ...tab,
      current: copyEntryWithView(previous),
      back: back.slice(0, -1),
      forward,
    };
  }

  const next = forward.at(-1);
  if (next) {
    return {
      ...tab,
      current: copyEntryWithView(next),
      back: [],
      forward: forward.slice(0, -1),
    };
  }

  return null;
}

type StateMutationAction = Exclude<
  AppStateAction,
  { type: "navigation/go-back" | "navigation/go-forward" }
>;

function reduceAppState(state: AppState, action: StateMutationAction): AppState {
  switch (action.type) {
    case "tab/open-current": {
      const tab = state.tabs[action.tabId];
      if (!tab) return state;

      return {
        ...state,
        sessions: sessionsWithDocument(state, action.document),
        tabs: {
          ...state.tabs,
          [action.tabId]: {
            ...tab,
            current: entryFor(action.document, action.targetView),
            back: historyBeforeNavigation(
              state,
              tab,
              documentIdFromPath(action.document.path),
              action.previousView,
            ),
            forward: [],
          },
        },
      };
    }

    case "tab/open-new": {
      if (state.tabs[action.tabId]) return state;
      const groupId = action.groupId ?? state.activeEditorGroupId;
      const group = state.editorGroups.find((candidate) => candidate.id === groupId);
      if (!group) return state;

      const sessions = sessionsWithDocument(state, action.document);
      const tabs = { ...state.tabs };
      if (action.preview) {
        for (const tabId of group.tabIds) {
          const previous = tabs[tabId];
          if (previous?.preview) tabs[tabId] = { ...previous, preview: false };
        }
      }
      const tab: Tab = {
        id: action.tabId,
        preview: Boolean(
          action.preview && !sessions[documentIdFromPath(action.document.path)]?.dirty,
        ),
        current: entryFor(action.document, action.view),
        back: [],
        forward: [],
      };

      return withEditorGroups(
        {
          ...state,
          sessions,
          tabs: { ...tabs, [action.tabId]: tab },
        },
        state.editorGroups.map((candidate) =>
          candidate.id === groupId
            ? {
                ...candidate,
                tabIds: [...candidate.tabIds, action.tabId],
                activeTabId:
                  action.active || candidate.activeTabId === null
                    ? action.tabId
                    : candidate.activeTabId,
              }
            : candidate,
        ),
        action.active && action.focus !== false ? groupId : state.activeEditorGroupId,
      );
    }

    case "tab/open-preview": {
      const groupId = action.groupId ?? state.activeEditorGroupId;
      const group = state.editorGroups.find((candidate) => candidate.id === groupId);
      if (!group) return state;
      const existing = group.tabIds
        .map((id) => state.tabs[id])
        .find(
          (tab) => tab?.current.documentId === documentIdFromPath(action.document.path),
        );
      if (existing) {
        return withEditorGroups(
          {
            ...state,
            tabs:
              action.permanent && existing.preview
                ? { ...state.tabs, [existing.id]: { ...existing, preview: false } }
                : state.tabs,
          },
          state.editorGroups.map((candidate) =>
            candidate.id === groupId
              ? { ...candidate, activeTabId: existing.id }
              : candidate,
          ),
          action.focus !== false ? groupId : state.activeEditorGroupId,
        );
      }

      const previousPreview = group.tabIds
        .map((id) => state.tabs[id])
        .find((tab) => tab?.preview);
      const replace =
        previousPreview !== undefined && !tabHasDirtyDocuments(state, previousPreview);
      const nextTabId = replace ? previousPreview.id : action.tabId;
      if (!replace && state.tabs[nextTabId]) return state;
      const sessions = sessionsWithDocument(state, action.document);
      const tab: Tab = {
        id: nextTabId,
        preview:
          !action.permanent && !sessions[documentIdFromPath(action.document.path)]?.dirty,
        current: entryFor(action.document),
        back: replace
          ? historyBeforeNavigation(
              state,
              previousPreview,
              documentIdFromPath(action.document.path),
            )
          : [],
        forward: [],
      };
      const tabs = { ...state.tabs };
      if (previousPreview && !replace) {
        tabs[previousPreview.id] = { ...previousPreview, preview: false };
      }
      tabs[nextTabId] = tab;
      return withEditorGroups(
        { ...state, sessions, tabs },
        state.editorGroups.map((candidate) =>
          candidate.id === groupId
            ? {
                ...candidate,
                tabIds: replace ? candidate.tabIds : [...candidate.tabIds, nextTabId],
                activeTabId: nextTabId,
              }
            : candidate,
        ),
        action.focus !== false ? groupId : state.activeEditorGroupId,
      );
    }

    case "tab/keep-open": {
      const tab = state.tabs[action.tabId];
      if (!tab?.preview) return state;
      return { ...state, tabs: { ...state.tabs, [tab.id]: { ...tab, preview: false } } };
    }

    case "tab/go-back": {
      const tab = state.tabs[action.tabId];
      if (!tab || tab.back.length === 0) return state;
      return {
        ...state,
        tabs: { ...state.tabs, [action.tabId]: moveBack(tab, action.currentView) },
      };
    }

    case "tab/go-forward": {
      const tab = state.tabs[action.tabId];
      if (!tab || tab.forward.length === 0) return state;
      return {
        ...state,
        tabs: { ...state.tabs, [action.tabId]: moveForward(tab, action.currentView) },
      };
    }

    case "tab/update-view": {
      const tab = state.tabs[action.tabId];
      if (!tab) return state;
      return {
        ...state,
        tabs: {
          ...state.tabs,
          [action.tabId]: {
            ...tab,
            current: copyEntryWithView(tab.current, action.view),
          },
        },
      };
    }

    case "tab/navigate-view": {
      const tab = state.tabs[action.tabId];
      const group = state.editorGroups.find((item) => item.tabIds.includes(action.tabId));
      if (!tab || !group) return state;
      const changed = !sameView(tab.current.view, action.view);
      if (!changed && state.activeTabId === tab.id) return state;
      return withEditorGroups(
        {
          ...state,
          tabs: changed
            ? {
                ...state.tabs,
                [tab.id]: {
                  ...tab,
                  current: copyEntryWithView(tab.current, action.view),
                  back: historyBeforeNavigation(state, tab, tab.current.documentId),
                  forward: [],
                },
              }
            : state.tabs,
        },
        state.editorGroups.map((item) =>
          item.id === group.id ? { ...item, activeTabId: tab.id } : item,
        ),
        group.id,
      );
    }

    case "tab/activate": {
      if (!state.tabs[action.tabId] || state.activeTabId === action.tabId) return state;
      const group = state.editorGroups.find((candidate) =>
        candidate.tabIds.includes(action.tabId),
      );
      if (!group) return state;
      return withEditorGroups(
        state,
        state.editorGroups.map((candidate) =>
          candidate.id === group.id
            ? { ...candidate, activeTabId: action.tabId }
            : candidate,
        ),
        group.id,
      );
    }

    case "editor-group/activate": {
      if (
        state.activeEditorGroupId === action.groupId ||
        !state.editorGroups.some((group) => group.id === action.groupId)
      )
        return state;
      return withEditorGroups(state, state.editorGroups, action.groupId);
    }

    case "session/restore": {
      // Startup is best-effort. Never replace a page opened/edited while I/O ran.
      return state.tabOrder.length || state.navigation.visits.length ? state : action.state;
    }

    case "editor-group/open-right": {
      const sourceIndex = state.editorGroups.findIndex(
        (group) => group.id === action.sourceGroupId,
      );
      if (sourceIndex < 0) return state;
      const existing =
        state.editorGroups[sourceIndex + 1] ??
        (state.editorGroups.length > 1 ? state.editorGroups.at(-1) : undefined);
      if (!existing && state.editorGroups.some((group) => group.id === action.newGroupId))
        return state;
      const targetId = existing?.id ?? action.newGroupId;
      const groups = existing
        ? state.editorGroups
        : [
            ...state.editorGroups,
            {
              id: targetId,
              tabIds: [],
              activeTabId: null,
            },
          ];
      // A link in the rightmost Markdown preview must not replace its own source.
      const sourceTabId = state.editorGroups[sourceIndex]?.activeTabId;
      const sourceTab = sourceTabId ? state.tabs[sourceTabId] : undefined;
      const tabs =
        targetId === action.sourceGroupId &&
        sourceTab?.preview &&
        sourceTab.current.path !== action.document.path
          ? { ...state.tabs, [sourceTab.id]: { ...sourceTab, preview: false } }
          : state.tabs;
      return reduceAppState(
        { ...state, tabs, editorGroups: groups },
        {
          type: "tab/open-preview",
          tabId: action.tabId,
          document: action.document,
          groupId: targetId,
          permanent: false,
          focus: action.focus,
        },
      );
    }

    case "tab/move-right": {
      const sourceIndex = state.editorGroups.findIndex((group) =>
        group.tabIds.includes(action.tabId),
      );
      if (sourceIndex < 0 || !state.tabs[action.tabId]) return state;
      const source = state.editorGroups[sourceIndex]!;
      const neighbor = state.editorGroups[sourceIndex + 1];
      if (neighbor)
        return reduceAppState(state, {
          type: "tab/move-to-group",
          tabId: action.tabId,
          targetGroupId: neighbor.id,
        });
      if (state.editorGroups.some((group) => group.id === action.newGroupId)) return state;
      const groups = state.editorGroups.map((group) =>
        group.id === source.id ? { ...group, keepEmpty: group.tabIds.length === 1 } : group,
      );
      groups.splice(sourceIndex + 1, 0, {
        id: action.newGroupId,
        tabIds: [],
        activeTabId: null,
      });
      return reduceAppState(
        { ...state, editorGroups: groups },
        {
          type: "tab/move-to-group",
          tabId: action.tabId,
          targetGroupId: action.newGroupId,
        },
      );
    }

    case "tab/split-right": {
      const tab = state.tabs[action.tabId];
      const sourceIndex = state.editorGroups.findIndex((group) =>
        group.tabIds.includes(action.tabId),
      );
      if (
        !tab ||
        sourceIndex === -1 ||
        state.tabs[action.newTabId] ||
        state.editorGroups.some((group) => group.id === action.newGroupId)
      )
        return state;
      const duplicate: Tab = {
        id: action.newTabId,
        preview: false,
        current: copyEntryWithView(tab.current),
        back: tab.back.map((entry) => copyEntryWithView(entry)),
        forward: tab.forward.map((entry) => copyEntryWithView(entry)),
      };
      const groups = [...state.editorGroups];
      groups.splice(sourceIndex + 1, 0, {
        id: action.newGroupId,
        tabIds: [action.newTabId],
        activeTabId: action.newTabId,
      });
      return withEditorGroups(
        {
          ...state,
          tabs: {
            ...state.tabs,
            [tab.id]: tab.preview ? { ...tab, preview: false } : tab,
            [action.newTabId]: duplicate,
          },
        },
        groups,
        action.newGroupId,
      );
    }

    case "tab/move-to-group": {
      const source = state.editorGroups.find((group) =>
        group.tabIds.includes(action.tabId),
      );
      const target = state.editorGroups.find((group) => group.id === action.targetGroupId);
      if (
        !state.tabs[action.tabId] ||
        !source ||
        !target ||
        (action.beforeTabId !== undefined && !target.tabIds.includes(action.beforeTabId))
      )
        return state;
      if (action.beforeTabId === action.tabId) {
        return appStateReducer(state, { type: "tab/keep-open", tabId: action.tabId });
      }
      const targetTabIds = target.tabIds.filter((id) => id !== action.tabId);
      const targetIndex =
        action.beforeTabId === undefined
          ? targetTabIds.length
          : targetTabIds.indexOf(action.beforeTabId);
      targetTabIds.splice(targetIndex, 0, action.tabId);
      const groups = state.editorGroups.map((group) => {
        if (group.id === target.id) {
          return { ...group, tabIds: targetTabIds, activeTabId: action.tabId };
        }
        return group.id === source.id
          ? groupWithTabs(
              group,
              group.tabIds.filter((id) => id !== action.tabId),
            )
          : group;
      });
      return withEditorGroups(
        {
          ...state,
          tabs: state.tabs[action.tabId]!.preview
            ? {
                ...state.tabs,
                [action.tabId]: { ...state.tabs[action.tabId]!, preview: false },
              }
            : state.tabs,
        },
        groups,
        target.id,
      );
    }

    case "tab/close": {
      if (!state.tabs[action.tabId]) return state;

      const tabs = { ...state.tabs };
      delete tabs[action.tabId];
      const referencedDocumentIds = new Set(
        Object.values(tabs).flatMap((tab) =>
          [tab.current, ...tab.back, ...tab.forward].map((entry) => entry.documentId),
        ),
      );
      // Closing the last reference discards unsaved text, not the clean document cache.
      const sessions = { ...state.sessions };
      for (const [documentId, session] of Object.entries(sessions)) {
        if (session.dirty && !referencedDocumentIds.has(documentId)) {
          delete sessions[documentId];
        }
      }
      return withEditorGroups({ ...state, tabs, sessions });
    }

    case "document/discard": {
      if (action.documentIds.length === 0) return state;
      const discardedDocumentIds = new Set(action.documentIds);
      const sessions = { ...state.sessions };
      for (const documentId of discardedDocumentIds) delete sessions[documentId];

      const tabs: AppState["tabs"] = {};
      for (const [tabId, tab] of Object.entries(state.tabs)) {
        const nextTab = discardDocumentsFromTab(tab, discardedDocumentIds);
        if (nextTab) tabs[tabId] = nextTab;
      }
      return withEditorGroups({ ...state, sessions, tabs });
    }

    case "document/edit": {
      const session = state.sessions[action.documentId];
      if (!session || session.text === action.text) return state;
      const previewsToKeep = Object.values(state.tabs).filter(
        (tab) => tab.preview && tabReferencesDocument(tab, action.documentId),
      );
      const tabs = previewsToKeep.length > 0 ? { ...state.tabs } : state.tabs;
      for (const tab of previewsToKeep) tabs[tab.id] = { ...tab, preview: false };
      return {
        ...state,
        tabs,
        sessions: {
          ...state.sessions,
          [action.documentId]: { ...session, text: action.text, dirty: true },
        },
      };
    }

    case "document/external-change": {
      const session = state.sessions[action.documentId];
      if (!session || !documentIsReferenced(state, action.documentId)) return state;
      if (
        session.externalChange?.status === action.change?.status &&
        session.externalChange?.revision === action.change?.revision
      )
        return state;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.documentId]: { ...session, externalChange: action.change },
        },
      };
    }

    case "document/reload": {
      const session = state.sessions[action.documentId];
      if (
        !session ||
        !documentIsReferenced(state, action.documentId) ||
        session.id !== action.documentId ||
        session.path !== action.document.path ||
        documentIdFromPath(action.document.path) !== action.documentId ||
        session.text !== action.expectedText ||
        session.diskRevision !== action.expectedRevision ||
        (session.dirty && !action.allowDirty)
      )
        return state;
      const nextSession: DocumentSession = {
        ...session,
        text: action.document.text,
        diskMtimeMs: action.document.diskMtimeMs,
        diskRevision: action.document.diskRevision,
        externalChange: undefined,
        dirty: false,
        mode: action.document.mode,
        kind: action.document.kind ?? session.kind,
        language: action.document.language ?? session.language,
      };
      const next = {
        ...state,
        sessions: { ...state.sessions, [action.documentId]: nextSession },
      };
      return nextSession.mode === "sourceOnly" || nextSession.kind === "text"
        ? withSourceViews(next, action.documentId)
        : next;
    }

    case "document/mark-saved": {
      const session = state.sessions[action.documentId];
      if (!session) return state;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.documentId]: {
            ...session,
            diskMtimeMs: action.diskMtimeMs,
            diskRevision: action.diskRevision,
            externalChange: undefined,
            dirty: session.text !== action.savedText,
          },
        },
      };
    }

    case "document/relocate": {
      const session = state.sessions[action.documentId];
      if (!session) return state;

      const nextDocumentId = documentIdFromPath(action.document.path);
      if (
        nextDocumentId !== action.documentId &&
        documentIsReferenced(state, nextDocumentId)
      ) {
        return state;
      }

      const sessions = { ...state.sessions };
      delete sessions[action.documentId];
      sessions[nextDocumentId] = {
        ...session,
        id: nextDocumentId,
        path: action.document.path,
        diskMtimeMs: action.document.diskMtimeMs,
        diskRevision: action.document.diskRevision,
        externalChange: undefined,
        mode: action.document.mode,
        kind: action.document.kind ?? session.kind,
        language: action.document.language ?? session.language,
        dirty: session.text !== action.savedText,
      };

      return {
        ...state,
        sessions,
        tabs: Object.fromEntries(
          Object.entries(state.tabs).map(([tabId, tab]) => [
            tabId,
            relocateTab(tab, action.documentId, nextDocumentId, action.document.path),
          ]),
        ),
      };
    }
  }
}

function navigateWindow(
  state: AppState,
  direction: "back" | "forward",
  currentView?: ViewState,
): AppState {
  const index = findNavigationIndex(state, direction);
  if (index < 0) return state;
  const navigation = refreshNavigationView(state, currentView);
  const destination = navigation.visits[index]!;
  const group = state.editorGroups.find((item) => item.tabIds.includes(destination.tabId));
  const destinationTab = state.tabs[destination.tabId];
  if (!group || !destinationTab) return state;

  const tabs = { ...state.tabs };
  const leavingTab = state.activeTabId ? tabs[state.activeTabId] : undefined;
  if (leavingTab && currentView) {
    tabs[leavingTab.id] = {
      ...leavingTab,
      current: copyEntryWithView(leavingTab.current, currentView),
    };
  }
  tabs[destination.tabId] = restoreTabVisit(
    tabs[destination.tabId]!,
    destination.entry,
    direction,
  );
  return withEditorGroups(
    { ...state, tabs, navigation: { ...navigation, index } },
    state.editorGroups.map((item) =>
      item.id === group.id ? { ...item, activeTabId: destination.tabId } : item,
    ),
    group.id,
  );
}

export function appStateReducer(state: AppState, action: AppStateAction): AppState {
  if (action.type === "navigation/go-back" || action.type === "navigation/go-forward") {
    return navigateWindow(
      state,
      action.type === "navigation/go-back" ? "back" : "forward",
      action.currentView,
    );
  }
  const next = reduceAppState(state, action);
  if (next === state) return state;

  switch (action.type) {
    case "tab/open-new":
      return next.activeTabId === action.tabId ? recordNavigationVisit(state, next) : next;
    case "tab/open-preview":
      return next.activeEditorGroupId === (action.groupId ?? state.activeEditorGroupId)
        ? recordNavigationVisit(state, next)
        : next;
    case "tab/open-current":
      return next.activeTabId === action.tabId
        ? recordNavigationVisit(state, next, action.previousView)
        : next;
    case "tab/go-back":
    case "tab/go-forward":
      return next.activeTabId === action.tabId
        ? recordNavigationVisit(state, next, action.currentView)
        : next;
    case "tab/navigate-view":
    case "tab/activate":
    case "editor-group/activate":
    case "tab/split-right":
    case "tab/move-to-group":
    case "tab/move-right":
    case "editor-group/open-right":
      return recordNavigationVisit(state, next);
    case "tab/update-view":
      return { ...next, navigation: refreshNavigationView(next) };
    case "tab/close":
    case "document/discard":
      return reconcileNavigation(next);
    case "document/relocate":
      return {
        ...next,
        navigation: {
          ...next.navigation,
          visits: next.navigation.visits.map((visit) => ({
            ...visit,
            entry: relocateEntry(
              visit.entry,
              action.documentId,
              documentIdFromPath(action.document.path),
              action.document.path,
            ),
          })),
        },
      };
    case "tab/keep-open":
    case "document/edit":
    case "document/mark-saved":
    case "document/external-change":
    case "document/reload":
    case "session/restore":
      return next;
  }
}
