import type { MobileTransport } from "./transport";
import type {
  MobileComputer,
  MobileDirectory,
  MobileDocument,
  MobileSearchRequest,
  MobileSearchResult,
  MobileWorkspace,
} from "./types";

const DATABASE_NAME = "notespace-mobile-offline-v1";
const DATABASE_VERSION = 1;
const WORKSPACE_STORE = "workspaces";
const SNAPSHOT_SCHEMA_VERSION = 1;
const DEFAULT_MAX_DIRECTORIES = 5_000;
const DEFAULT_MAX_DOCUMENTS = 5_000;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const DOCUMENT_BATCH_SIZE = 4;
const MAX_OFFLINE_SEARCH_RESULTS = 200;

export interface MobileOfflineWorkspaceSnapshot {
  readonly schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  readonly key: string;
  readonly computer: MobileComputer;
  readonly workspace: MobileWorkspace;
  readonly directories: readonly MobileDirectory[];
  readonly documents: readonly MobileDocument[];
  readonly syncedAt: string;
  readonly totalBytes: number;
}

export interface MobileOfflineWorkspaceProgress {
  readonly directories: number;
  readonly documents: number;
  readonly totalBytes: number;
}

export interface MobileOfflineWorkspaceLimits {
  readonly maxDirectories?: number;
  readonly maxDocuments?: number;
  readonly maxBytes?: number;
}

export interface MobileOfflineWorkspaceStore {
  list(computerId?: string): Promise<readonly MobileOfflineWorkspaceSnapshot[]>;
  put(snapshot: MobileOfflineWorkspaceSnapshot): Promise<void>;
  remove(key: string): Promise<void>;
}

function workspaceIdentity(workspace: MobileWorkspace) {
  return workspace.syncKey ? `sync:${workspace.syncKey}` : `name:${workspace.name}`;
}

export function mobileOfflineWorkspaceKey(computerId: string, workspace: MobileWorkspace) {
  return `${encodeURIComponent(computerId)}:${encodeURIComponent(workspaceIdentity(workspace))}`;
}

export function findOfflineWorkspace(
  snapshots: readonly MobileOfflineWorkspaceSnapshot[],
  workspace: MobileWorkspace,
) {
  return snapshots.find(
    (snapshot) => workspaceIdentity(snapshot.workspace) === workspaceIdentity(workspace),
  );
}

export function findOfflineDirectory(
  snapshots: readonly MobileOfflineWorkspaceSnapshot[],
  workspaceId: string,
  directoryId?: string | null,
) {
  const requestedDirectoryId = directoryId ?? null;
  return snapshots
    .find((snapshot) => snapshot.workspace.id === workspaceId)
    ?.directories.find((directory) => directory.directoryId === requestedDirectoryId);
}

export function findOfflineDocument(
  snapshots: readonly MobileOfflineWorkspaceSnapshot[],
  documentId: string,
) {
  return snapshots
    .flatMap((snapshot) => snapshot.documents)
    .find((document) => document.id === documentId);
}

export function findOfflineDocumentByPath(
  snapshots: readonly MobileOfflineWorkspaceSnapshot[],
  workspaceName: string,
  relativePath: string,
  workspaceSyncKey?: string,
) {
  const candidates = snapshots.filter((snapshot) =>
    workspaceSyncKey
      ? snapshot.workspace.syncKey === workspaceSyncKey
      : snapshot.workspace.name === workspaceName,
  );
  if (candidates.length !== 1) return undefined;
  return candidates[0]?.documents.find(
    (document) => document.relativePath === relativePath,
  );
}

function offlineLimitError(message: string) {
  return new Error(`${message}，已保留手机上上一版离线内容`);
}

function markdownBytes(markdown: string) {
  return new TextEncoder().encode(markdown).byteLength;
}

export async function downloadOfflineWorkspace({
  transport,
  computer,
  workspace,
  now = () => new Date(),
  limits = {},
  onProgress,
}: {
  readonly transport: MobileTransport;
  readonly computer: MobileComputer;
  readonly workspace: MobileWorkspace;
  readonly now?: () => Date;
  readonly limits?: MobileOfflineWorkspaceLimits;
  readonly onProgress?: (progress: MobileOfflineWorkspaceProgress) => void;
}): Promise<MobileOfflineWorkspaceSnapshot> {
  const maxDirectories = limits.maxDirectories ?? DEFAULT_MAX_DIRECTORIES;
  const maxDocuments = limits.maxDocuments ?? DEFAULT_MAX_DOCUMENTS;
  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES;
  const directories: MobileDirectory[] = [];
  const documents: MobileDocument[] = [];
  const directoryQueue: Array<string | null> = [null];
  const visitedDirectories = new Set<string>();
  const documentIds: string[] = [];
  const seenDocuments = new Set<string>();
  let totalBytes = 0;

  while (directoryQueue.length > 0) {
    const directoryId = directoryQueue.shift() ?? null;
    const visitKey = directoryId ?? "root";
    if (visitedDirectories.has(visitKey)) continue;
    if (visitedDirectories.size >= maxDirectories) {
      throw offlineLimitError(`工作区目录超过 ${maxDirectories} 个`);
    }
    visitedDirectories.add(visitKey);
    const directory = await transport.listDirectory(workspace.id, directoryId);
    if (directory.workspaceId !== workspace.id) {
      throw new Error("电脑返回了不属于当前工作区的目录");
    }
    if (directory.truncated) {
      throw offlineLimitError(
        "电脑未能完整读取工作区目录，请检查文件访问权限或目录大小后重试",
      );
    }
    directories.push(directory);
    for (const entry of directory.entries) {
      if (entry.kind === "directory") {
        directoryQueue.push(entry.id);
      } else if (!seenDocuments.has(entry.id)) {
        if (documentIds.length >= maxDocuments) {
          throw offlineLimitError(`工作区文档超过 ${maxDocuments} 篇`);
        }
        seenDocuments.add(entry.id);
        documentIds.push(entry.id);
      }
    }
    onProgress?.({
      directories: directories.length,
      documents: documents.length,
      totalBytes,
    });
  }

  for (let index = 0; index < documentIds.length; index += DOCUMENT_BATCH_SIZE) {
    const batch = documentIds.slice(index, index + DOCUMENT_BATCH_SIZE);
    const downloaded = await Promise.all(
      batch.map((documentId) => transport.readDocument(documentId)),
    );
    for (const document of downloaded) {
      if (document.workspaceId !== workspace.id) {
        throw new Error("电脑返回了不属于当前工作区的文档");
      }
      totalBytes += markdownBytes(document.markdown);
      if (totalBytes > maxBytes) {
        throw offlineLimitError(`工作区正文超过 ${Math.floor(maxBytes / 1024 / 1024)} MiB`);
      }
      documents.push(document);
    }
    onProgress?.({
      directories: directories.length,
      documents: documents.length,
      totalBytes,
    });
  }

  const syncedAt = now().toISOString();
  const snapshotWorkspace: MobileWorkspace = {
    ...workspace,
    documentCount: documents.length,
  };
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    key: mobileOfflineWorkspaceKey(computer.id, workspace),
    computer,
    workspace: snapshotWorkspace,
    directories,
    documents,
    syncedAt,
    totalBytes,
  };
}

function searchPattern(request: MobileSearchRequest) {
  if (request.useRegex) {
    return new RegExp(request.query, request.caseSensitive ? "g" : "gi");
  }
  const escaped = request.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, request.caseSensitive ? "g" : "gi");
}

function filePattern(fileFilter: string | null | undefined) {
  return fileFilter ? new RegExp(fileFilter, "i") : null;
}

export function searchOfflineWorkspaces(
  snapshots: readonly MobileOfflineWorkspaceSnapshot[],
  request: MobileSearchRequest,
): readonly MobileSearchResult[] {
  const query = request.query.trim();
  if (!query) return [];
  const contentPattern = searchPattern({ ...request, query });
  const pathPattern = filePattern(request.fileFilter);
  const results: MobileSearchResult[] = [];
  const selectedSnapshots = request.workspaceId
    ? snapshots.filter((snapshot) => snapshot.workspace.id === request.workspaceId)
    : snapshots;

  for (const snapshot of selectedSnapshots) {
    for (const document of snapshot.documents) {
      if (pathPattern && !pathPattern.test(document.relativePath)) continue;
      const lines = document.markdown.split(/\r?\n/);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        if (line === undefined) continue;
        contentPattern.lastIndex = 0;
        if (!contentPattern.test(line)) continue;
        results.push({
          id: `offline:${document.id}:${lineIndex + 1}`,
          documentId: document.id,
          title: document.title,
          relativePath: document.relativePath,
          workspaceName: document.workspaceName,
          snippet: line.trim().slice(0, 240),
        });
        if (results.length >= MAX_OFFLINE_SEARCH_RESULTS) return results;
      }
    }
  }
  return results;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function normalizeSnapshot(value: unknown): MobileOfflineWorkspaceSnapshot | null {
  if (!isObject(value) || value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return null;
  const { computer, workspace } = value;
  if (
    typeof value.key !== "string" ||
    typeof value.syncedAt !== "string" ||
    typeof value.totalBytes !== "number" ||
    !Number.isFinite(value.totalBytes) ||
    value.totalBytes < 0 ||
    !isObject(computer) ||
    typeof computer.id !== "string" ||
    typeof computer.name !== "string" ||
    typeof computer.address !== "string" ||
    !isObject(workspace) ||
    typeof workspace.id !== "string" ||
    typeof workspace.name !== "string" ||
    !Array.isArray(value.directories) ||
    !Array.isArray(value.documents)
  ) {
    return null;
  }
  return value as unknown as MobileOfflineWorkspaceSnapshot;
}

export function createMemoryMobileOfflineStore(
  initial: readonly MobileOfflineWorkspaceSnapshot[] = [],
): MobileOfflineWorkspaceStore {
  const snapshots = new Map(
    initial
      .map(normalizeSnapshot)
      .filter((snapshot): snapshot is MobileOfflineWorkspaceSnapshot => snapshot !== null)
      .map((snapshot) => [snapshot.key, snapshot]),
  );
  return {
    async list(computerId) {
      return [...snapshots.values()]
        .filter((snapshot) => !computerId || snapshot.computer.id === computerId)
        .sort((left, right) => left.workspace.name.localeCompare(right.workspace.name));
    },
    async put(snapshot) {
      snapshots.set(snapshot.key, snapshot);
    },
    async remove(key) {
      snapshots.delete(key);
    },
  };
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("无法读写离线内容")),
      { once: true },
    );
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("离线内容写入被中止")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("无法写入离线内容")),
      { once: true },
    );
  });
}

function openOfflineDatabase(factory: IDBFactory) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(WORKSPACE_STORE)) {
        database.createObjectStore(WORKSPACE_STORE, { keyPath: "key" });
      }
    });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("无法打开离线存储")),
      { once: true },
    );
  });
}

export function createBrowserMobileOfflineStore(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): MobileOfflineWorkspaceStore {
  if (!factory) return createMemoryMobileOfflineStore();
  let databasePromise: Promise<IDBDatabase> | undefined;
  const database = () => (databasePromise ??= openOfflineDatabase(factory));
  return {
    async list(computerId) {
      const db = await database();
      const transaction = db.transaction(WORKSPACE_STORE, "readonly");
      const values = await requestResult(
        transaction.objectStore(WORKSPACE_STORE).getAll() as IDBRequest<unknown[]>,
      );
      return values
        .map(normalizeSnapshot)
        .filter(
          (snapshot): snapshot is MobileOfflineWorkspaceSnapshot =>
            snapshot !== null && (!computerId || snapshot.computer.id === computerId),
        )
        .sort((left, right) => left.workspace.name.localeCompare(right.workspace.name));
    },
    async put(snapshot) {
      const db = await database();
      const transaction = db.transaction(WORKSPACE_STORE, "readwrite");
      transaction.objectStore(WORKSPACE_STORE).put(snapshot);
      await transactionDone(transaction);
    },
    async remove(key) {
      const db = await database();
      const transaction = db.transaction(WORKSPACE_STORE, "readwrite");
      transaction.objectStore(WORKSPACE_STORE).delete(key);
      await transactionDone(transaction);
    },
  };
}
