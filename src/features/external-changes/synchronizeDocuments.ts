import {
  markDocumentExternalChange,
  reloadDocument,
  type AppState,
  type AppStateAction,
  type DocumentSession,
} from "../../app/state";
import type { DesktopAdapter } from "../../infrastructure/tauri/desktopAdapter";

// Match the native command's bounded metadata batch, without limiting open tabs.
const INSPECTION_BATCH_SIZE = 1024;

function tabReferencesDocument(tab: AppState["tabs"][string], id: string): boolean {
  return [tab.current, ...tab.back, ...tab.forward].some(
    (entry) => entry.documentId === id,
  );
}

/** Bind pending I/O to its original references, never a later same-path reopen. */
export function captureDocumentOwnership(
  state: AppState,
  id: string,
): (state: AppState) => boolean {
  const owners = Object.values(state.tabs)
    .filter((tab) => tabReferencesDocument(tab, id))
    .map((tab) => tab.id);
  return (latest) =>
    owners.some(
      (tabId) => latest.tabs[tabId] && tabReferencesDocument(latest.tabs[tabId]!, id),
    );
}

export function referencedFilePaths(state: AppState): string[] {
  return [
    ...new Set(
      Object.values(state.tabs).flatMap((tab) =>
        [tab.current, ...tab.back, ...tab.forward].map((entry) => entry.documentId),
      ),
    ),
  ].flatMap((id) => {
    const session = state.sessions[id];
    return session && !session.path.includes("://") ? [session.path] : [];
  });
}

/** Metadata is cheap; bodies are read only when a clean document actually changed. */
export async function synchronizeDocuments({
  adapter,
  getState,
  commit,
  isSaving,
  onNotice,
}: {
  adapter: DesktopAdapter;
  getState: () => AppState;
  commit: (action: AppStateAction) => void;
  isSaving: (id: string) => boolean;
  onNotice: (session: DocumentSession, kind: "reloaded" | "conflict") => void;
}): Promise<void> {
  if (!adapter.inspectDocuments) return;
  const state = getState();
  const paths = referencedFilePaths(state).filter((path) => !isSaving(path));
  if (!paths.length) return;
  const snapshots = new Map(paths.map((path) => [path, state.sessions[path]!]));
  const owners = new Map<string, string[]>();
  for (const tab of Object.values(state.tabs)) {
    for (const id of new Set(
      [tab.current, ...tab.back, ...tab.forward].map((entry) => entry.documentId),
    )) {
      const tabIds = owners.get(id) ?? [];
      tabIds.push(tab.id);
      owners.set(id, tabIds);
    }
  }
  const entries = [];
  for (let offset = 0; offset < paths.length; offset += INSPECTION_BATCH_SIZE) {
    entries.push(
      ...(await adapter.inspectDocuments(
        paths.slice(offset, offset + INSPECTION_BATCH_SIZE),
      )),
    );
  }
  for (const entry of entries) {
    const before = snapshots.get(entry.path);
    if (!before) continue;
    const originalOwners = owners.get(before.id) ?? [];
    const current = () => {
      const latest = getState();
      const session = latest.sessions[before.id];
      return session &&
        originalOwners.some(
          (tabId) =>
            latest.tabs[tabId] && tabReferencesDocument(latest.tabs[tabId]!, before.id),
        ) &&
        session.path === before.path &&
        session.diskRevision === before.diskRevision &&
        !isSaving(before.id)
        ? session
        : undefined;
    };
    const session = current();
    if (!session) continue;
    const mark = (status: "modified" | "missing" | "unreadable" | "blocked") => {
      const latest = current();
      if (!latest) return;
      if (
        latest.externalChange?.status === status &&
        latest.externalChange.revision === entry.revision
      )
        return;
      commit(markDocumentExternalChange(before.id, { status, revision: entry.revision }));
      onNotice(latest, "conflict");
    };
    if (entry.status !== "present") {
      mark(entry.status);
      continue;
    }
    if (entry.revision === session.diskRevision && session.diskRevision !== undefined) {
      if (session.externalChange) commit(markDocumentExternalChange(session.id, undefined));
      continue;
    }
    if (session.dirty) {
      mark("modified");
      continue;
    }
    // Do not repeatedly preflight an unchanged blocked/unreadable file.
    if (
      session.externalChange &&
      session.externalChange.revision === entry.revision &&
      (session.externalChange.status === "blocked" ||
        session.externalChange.status === "unreadable")
    )
      continue;
    try {
      const result = await adapter.openDocument(session.path);
      const latest = current();
      if (!latest) continue;
      if (latest.dirty || latest.text !== session.text) {
        mark("modified");
        continue;
      }
      if (result.status === "blocked") {
        mark("blocked");
        continue;
      }
      commit(
        reloadDocument(
          session.id,
          {
            path: result.path,
            text: result.content,
            diskMtimeMs: 0,
            diskRevision: result.diskRevision,
            mode: result.mode,
            kind: result.documentKind,
            language: result.language,
          },
          session.text,
          session.diskRevision,
        ),
      );
      onNotice(latest, "reloaded");
    } catch {
      mark("unreadable");
    }
  }
}
