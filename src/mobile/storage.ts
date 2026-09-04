import type { MobileLocalState, MobileReadPosition, MobileRecentDocument } from "./types";

const STORAGE_KEY = "notespace.mobile.reader.v2";
const MAX_RECENT_DOCUMENTS = 30;

const EMPTY_STATE: MobileLocalState = {
  recentDocuments: [],
  positions: {},
};

export interface MobileLocalStore {
  load(): MobileLocalState;
  save(state: MobileLocalState): void;
}

function validPosition(value: unknown): value is MobileReadPosition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MobileReadPosition>;
  return (
    typeof candidate.scrollTop === "number" &&
    Number.isFinite(candidate.scrollTop) &&
    candidate.scrollTop >= 0 &&
    typeof candidate.progress === "number" &&
    Number.isFinite(candidate.progress) &&
    candidate.progress >= 0 &&
    candidate.progress <= 1 &&
    typeof candidate.updatedAt === "string"
  );
}

export function mobileDocumentStorageKey(computerId: string, documentId: string) {
  return `${encodeURIComponent(computerId)}:${encodeURIComponent(documentId)}`;
}

export function normalizeMobileLocalState(value: unknown): MobileLocalState {
  if (!value || typeof value !== "object") return EMPTY_STATE;
  const candidate = value as Partial<MobileLocalState>;
  const recentDocuments: MobileRecentDocument[] = [];
  if (Array.isArray(candidate.recentDocuments)) {
    for (const item of candidate.recentDocuments) {
      if (!item || typeof item !== "object") continue;
      const recent = item as Partial<MobileRecentDocument>;
      if (
        typeof recent.computerId !== "string" ||
        recent.computerId.length === 0 ||
        recent.computerId.length > 256 ||
        typeof recent.documentId !== "string" ||
        recent.documentId.length === 0 ||
        recent.documentId.length > 256 ||
        typeof recent.title !== "string" ||
        typeof recent.relativePath !== "string" ||
        typeof recent.workspaceName !== "string" ||
        !validPosition(recent.position) ||
        recentDocuments.some(
          ({ computerId, documentId }) =>
            computerId === recent.computerId && documentId === recent.documentId,
        )
      ) {
        continue;
      }
      recentDocuments.push({
        computerId: recent.computerId,
        documentId: recent.documentId,
        title: recent.title.slice(0, 300),
        relativePath: recent.relativePath.slice(0, 2_000),
        workspaceName: recent.workspaceName.slice(0, 300),
        position: recent.position,
      });
      if (recentDocuments.length >= MAX_RECENT_DOCUMENTS) break;
    }
  }

  const persistedPositions =
    candidate.positions && typeof candidate.positions === "object"
      ? candidate.positions
      : {};
  const positions = Object.fromEntries(
    recentDocuments.map((recent) => {
      const key = mobileDocumentStorageKey(recent.computerId, recent.documentId);
      const persisted = persistedPositions[key];
      return [key, validPosition(persisted) ? persisted : recent.position];
    }),
  );

  return { positions, recentDocuments };
}

export function updateRecentDocument(
  state: MobileLocalState,
  recent: MobileRecentDocument,
): MobileLocalState {
  const recentKey = mobileDocumentStorageKey(recent.computerId, recent.documentId);
  const recentDocuments = [
    recent,
    ...state.recentDocuments.filter(
      ({ computerId, documentId }) =>
        mobileDocumentStorageKey(computerId, documentId) !== recentKey,
    ),
  ].slice(0, MAX_RECENT_DOCUMENTS);
  const positions = Object.fromEntries(
    recentDocuments.map((item) => [
      mobileDocumentStorageKey(item.computerId, item.documentId),
      item.position,
    ]),
  );
  return {
    positions,
    recentDocuments,
  };
}

export function createBrowserMobileStore(
  storage: Storage | null = globalThis.localStorage,
): MobileLocalStore {
  return {
    load() {
      if (!storage) return EMPTY_STATE;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        return raw ? normalizeMobileLocalState(JSON.parse(raw) as unknown) : EMPTY_STATE;
      } catch {
        return EMPTY_STATE;
      }
    },
    save(state) {
      if (!storage) return;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(normalizeMobileLocalState(state)));
      } catch {
        // Reading remains available when platform storage is unavailable or full.
      }
    },
  };
}

export function createMemoryMobileStore(initial?: MobileLocalState): MobileLocalStore {
  let value = normalizeMobileLocalState(initial ?? EMPTY_STATE);
  return {
    load: () => value,
    save(state) {
      value = normalizeMobileLocalState(state);
    },
  };
}
