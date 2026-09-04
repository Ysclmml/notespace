import type { MobileComputerDiscovery } from "./lanDiscovery";
import { MobileTransportError, type MobileTransport } from "./transport";
import type {
  MobileComputer,
  MobileConnectionState,
  MobileDirectory,
  MobileDirectoryEntry,
  MobileDocument,
  MobileFavorite,
  MobilePairingRequest,
  MobileSearchRequest,
  MobileSearchResult,
  MobileWorkspace,
} from "./types";

const API_PROTOCOL_VERSION = 1;
const API_PREFIX = "/api/v1";
export const DEFAULT_LAN_PORT = 49_920;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_SAVED_COMPUTERS = 30;
const MAX_SEARCH_QUERY_CHARACTERS = 512;
const MAX_FILE_FILTER_CHARACTERS = 256;
const SAVED_COMPUTERS_KEY = "notespace.mobile.debug-http.computers.v1";
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9._~-]{1,256}$/;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface StoredComputer {
  readonly id?: string;
  readonly name: string;
  readonly address: string;
  readonly lastConnectedAt?: string;
}

interface DiscoveredComputerSnapshot {
  readonly computer: MobileComputer;
  readonly candidates: readonly NormalizedDebugHttpAddress[];
}

interface StatusResponse {
  readonly protocolVersion: number;
  readonly serviceName: string;
  readonly activeRequestCount: number;
}

interface SearchMatchResponse {
  readonly workspaceId: string;
  readonly documentId: string;
  readonly relativePath: string;
  readonly line: number;
  readonly column: number;
  readonly matchLength: number;
  readonly snippet: string;
}

interface SearchResponse {
  readonly matches: readonly SearchMatchResponse[];
  readonly searchedFiles: number;
  readonly skippedFiles: number;
  readonly scannedEntries: number;
  readonly unavailableWorkspaces: readonly string[];
  readonly truncated: boolean;
}

export interface NormalizedDebugHttpAddress {
  readonly address: string;
  readonly baseUrl: string;
}

export interface DebugHttpMobileTransportOptions {
  readonly fetch?: FetchImplementation;
  readonly storage?: Storage | null;
  readonly discovery?: MobileComputerDiscovery;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

class InvalidServerResponseError extends Error {
  constructor() {
    super("invalid server response");
    this.name = "InvalidServerResponseError";
  }
}

function invalidResponse(): never {
  throw new InvalidServerResponseError();
}

function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function hasUnsafeCharacters(value: string, allowLineBreaks = false): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 127) return true;
    if (code < 32 && !(allowLineBreaks && (code === 9 || code === 10 || code === 13))) {
      return true;
    }
  }
  return false;
}

function parsePortOrDefault(authority: string): number | null {
  const match = authority.startsWith("[")
    ? /^\[[0-9A-Fa-f:.]+\](?::([0-9]{1,5}))?$/.exec(authority)
    : /^[^:]+(?::([0-9]{1,5}))?$/.exec(authority);
  if (!match) return null;
  if (match[1] === undefined) return DEFAULT_LAN_PORT;
  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

function validHostname(hostname: string): boolean {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const value = hostname.slice(1, -1);
    return value.includes(":") && /^[0-9A-Fa-f:.]+$/.test(value);
  }
  if (hostname.length > 253 || !/^[A-Za-z0-9.-]+$/.test(hostname)) return false;
  return hostname
    .split(".")
    .every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        !label.startsWith("-") &&
        !label.endsWith("-"),
    );
}

/**
 * Accepts an HTTP host with an optional port, defaulting to the shared LAN port.
 * Paths, credentials, query strings, fragments and TLS-looking input are rejected
 * so a pasted value cannot redirect the client to a different API surface.
 */
export function normalizeDebugHttpBaseUrl(input: string): NormalizedDebugHttpAddress {
  const raw = input.trim();
  if (
    !raw ||
    raw.length > 2_048 ||
    [...raw].some((character) => character.charCodeAt(0) <= 32) ||
    hasUnsafeCharacters(raw) ||
    (raw.includes("://") && !raw.startsWith("http://"))
  ) {
    throw new MobileTransportError(
      "pairing-failed",
      "请输入有效的电脑地址，例如 192.168.1.20",
    );
  }

  const value = raw.startsWith("http://") ? raw : `http://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new MobileTransportError(
      "pairing-failed",
      "请输入有效的电脑地址，例如 192.168.1.20",
    );
  }

  const authority = value.slice("http://".length).split(/[/?#]/, 1)[0] ?? "";
  const suffix = value.slice("http://".length + authority.length);
  const port = parsePortOrDefault(authority);
  if (
    parsed.protocol !== "http:" ||
    parsed.username ||
    parsed.password ||
    !validHostname(parsed.hostname) ||
    port === null ||
    (suffix !== "" && suffix !== "/") ||
    parsed.search ||
    parsed.hash
  ) {
    throw new MobileTransportError(
      "pairing-failed",
      "请输入有效的电脑地址，例如 192.168.1.20",
    );
  }

  const host = parsed.hostname.toLowerCase();
  const address = `${host}:${port}`;
  return {
    address,
    baseUrl: `http://${address}${API_PREFIX}`,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse();
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, maximum: number, allowLineBreaks = false): string {
  if (typeof value !== "string" || value.length > maximum) invalidResponse();
  if (hasUnsafeCharacters(value, allowLineBreaks)) invalidResponse();
  return value;
}

function displayName(value: unknown, maximum = 300): string {
  const name = boundedString(value, maximum).trim();
  if (!name) invalidResponse();
  return name;
}

function opaqueId(value: unknown): string {
  if (typeof value !== "string" || !OPAQUE_ID_PATTERN.test(value) || value === "..") {
    invalidResponse();
  }
  return value;
}

function nonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 0) {
    invalidResponse();
  }
  return value;
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") invalidResponse();
  return value;
}

function safeRelativePath(value: unknown): string {
  const path = boundedString(value, 4_096);
  const segments = path.split("/");
  if (
    !path ||
    path.startsWith("/") ||
    path === "~" ||
    path.startsWith("~/") ||
    path.includes("\\") ||
    /^[A-Za-z]:/.test(path) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    invalidResponse();
  }
  return path;
}

function safeDetail(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const detail = boundedString(value, 500).trim();
  if (
    detail.startsWith("/") ||
    detail === "~" ||
    detail.startsWith("~/") ||
    detail.includes("\\") ||
    /^[A-Za-z]:[\\/]/.test(detail)
  ) {
    invalidResponse();
  }
  return detail || undefined;
}

function normalizeStatus(value: unknown): StatusResponse {
  const record = asRecord(value);
  const protocolVersion = nonNegativeInteger(record.protocolVersion);
  if (protocolVersion !== API_PROTOCOL_VERSION) invalidResponse();
  return {
    protocolVersion,
    serviceName: displayName(record.serviceName),
    activeRequestCount: nonNegativeInteger(record.activeRequestCount),
  };
}

function normalizeWorkspaces(value: unknown): readonly MobileWorkspace[] {
  if (!Array.isArray(value) || value.length > 100) invalidResponse();
  return value.map((item) => {
    const record = asRecord(item);
    const syncKey = record.syncKey === undefined ? undefined : opaqueId(record.syncKey);
    return {
      id: opaqueId(record.id),
      name: displayName(record.name),
      ...(syncKey ? { syncKey } : {}),
    };
  });
}

function normalizeDirectory(value: unknown): MobileDirectory {
  const record = asRecord(value);
  if (!Array.isArray(record.breadcrumbs) || record.breadcrumbs.length > 256) {
    invalidResponse();
  }
  if (!Array.isArray(record.entries) || record.entries.length > 20_000) {
    invalidResponse();
  }
  nonNegativeInteger(record.scannedEntries);
  booleanValue(record.truncated);

  const breadcrumbs = record.breadcrumbs.map((item) => {
    const breadcrumb = asRecord(item);
    return {
      id: breadcrumb.id === null ? null : opaqueId(breadcrumb.id),
      name: displayName(breadcrumb.name),
    };
  });
  const entries: MobileDirectoryEntry[] = record.entries.map((item) => {
    const entry = asRecord(item);
    if (entry.kind !== "directory" && entry.kind !== "document") invalidResponse();
    return {
      id: opaqueId(entry.id),
      name: displayName(entry.name),
      kind: entry.kind,
      detail: safeDetail(entry.detail),
    };
  });

  return {
    workspaceId: opaqueId(record.workspaceId),
    directoryId: record.directoryId === null ? null : opaqueId(record.directoryId),
    name: displayName(record.name),
    breadcrumbs,
    entries,
  };
}

function normalizeDocument(value: unknown): MobileDocument {
  const record = asRecord(value);
  nonNegativeInteger(record.sizeBytes);
  return {
    id: opaqueId(record.id),
    workspaceId: opaqueId(record.workspaceId),
    workspaceName: displayName(record.workspaceName),
    title: displayName(record.title),
    relativePath: safeRelativePath(record.relativePath),
    markdown: boundedString(record.markdown, MAX_RESPONSE_BYTES, true),
  };
}

function normalizeSearchResponse(value: unknown): SearchResponse {
  const record = asRecord(value);
  if (!Array.isArray(record.matches) || record.matches.length > 1_000) {
    invalidResponse();
  }
  if (
    !Array.isArray(record.unavailableWorkspaces) ||
    record.unavailableWorkspaces.length > 10_000
  ) {
    invalidResponse();
  }
  const unavailableWorkspaces = record.unavailableWorkspaces.map(opaqueId);
  const matches = record.matches.map((item) => {
    const match = asRecord(item);
    return {
      workspaceId: opaqueId(match.workspaceId),
      documentId: opaqueId(match.documentId),
      relativePath: safeRelativePath(match.relativePath),
      line: nonNegativeInteger(match.line),
      column: nonNegativeInteger(match.column),
      matchLength: nonNegativeInteger(match.matchLength),
      snippet: boundedString(match.snippet, 4_096, true),
    };
  });
  return {
    matches,
    searchedFiles: nonNegativeInteger(record.searchedFiles),
    skippedFiles: nonNegativeInteger(record.skippedFiles),
    scannedEntries: nonNegativeInteger(record.scannedEntries),
    unavailableWorkspaces,
    truncated: booleanValue(record.truncated),
  };
}

function normalizeFavorites(value: unknown): readonly MobileFavorite[] {
  if (!Array.isArray(value) || value.length > 10_000) invalidResponse();
  return value.map((item) => {
    const record = asRecord(item);
    return {
      id: opaqueId(record.id),
      documentId: opaqueId(record.documentId),
      title: displayName(record.title),
      relativePath: safeRelativePath(record.relativePath),
      workspaceName: displayName(record.workspaceName),
      available: booleanValue(record.available),
    };
  });
}

function documentTitle(relativePath: string): string {
  const filename = relativePath.split("/").at(-1) ?? relativePath;
  return filename.replace(/\.(?:md|markdown)$/i, "") || filename;
}

function endpointId(value: string, missingMessage: string): string {
  try {
    return encodeURIComponent(opaqueId(value));
  } catch {
    throw new MobileTransportError("not-found", missingMessage);
  }
}

async function readBoundedText(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) invalidResponse();
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      invalidResponse();
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

function computerId(address: string): string {
  return `debug-http:${address}`;
}

function storedComputerId(value: unknown, address: string): string | null {
  if (value === undefined) return computerId(address);
  if (value === computerId(address)) return value;
  return typeof value === "string" && /^debug-service:[a-f0-9]{16}$/.test(value)
    ? computerId(address)
    : null;
}

function normalizeAdvertisedApiBaseUrl(input: string): NormalizedDebugHttpAddress {
  if (!input.endsWith(API_PREFIX)) {
    throw new MobileTransportError("pairing-failed", "发现的电脑地址无效");
  }
  return normalizeDebugHttpBaseUrl(input.slice(0, -API_PREFIX.length));
}

function normalizeStoredComputer(value: unknown): MobileComputer | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<StoredComputer>;
  if (typeof candidate.address !== "string" || typeof candidate.name !== "string") {
    return null;
  }
  try {
    const normalized = normalizeDebugHttpBaseUrl(candidate.address);
    const id = storedComputerId(candidate.id, normalized.address);
    const name = candidate.name.trim();
    if (!id || !name || name.length > 300 || hasUnsafeCharacters(name)) return null;
    const lastConnectedAt = candidate.lastConnectedAt;
    if (
      lastConnectedAt !== undefined &&
      (typeof lastConnectedAt !== "string" || !Number.isFinite(Date.parse(lastConnectedAt)))
    ) {
      return null;
    }
    return {
      id,
      name,
      address: normalized.address,
      lastConnectedAt,
    };
  } catch {
    return null;
  }
}

export class DebugHttpMobileTransport implements MobileTransport {
  readonly securityMode = "insecure-debug-http" as const;

  private state: MobileConnectionState = { kind: "disconnected" };
  private readonly connectionListeners = new Set<(state: MobileConnectionState) => void>();
  private readonly fetchImplementation: FetchImplementation;
  private readonly storage: Storage | null;
  private readonly discovery?: MobileComputerDiscovery;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly knownComputers = new Map<string, MobileComputer>();
  private readonly connectionCandidates = new Map<
    string,
    readonly NormalizedDebugHttpAddress[]
  >();
  private readonly activeControllers = new Set<AbortController>();
  private readonly workspaceNames = new Map<string, string>();
  private connectedBaseUrl: string | undefined;
  private connectionAttempt = 0;

  constructor({
    fetch: fetchImplementation = globalThis.fetch.bind(globalThis),
    storage = safeLocalStorage(),
    discovery,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = () => new Date(),
  }: DebugHttpMobileTransportOptions = {}) {
    this.fetchImplementation = fetchImplementation;
    this.storage = storage;
    this.discovery = discovery;
    this.timeoutMs = Math.min(60_000, Math.max(250, Math.round(timeoutMs)));
    this.now = now;
    for (const computer of this.readStoredComputers()) {
      this.knownComputers.set(computer.id, computer);
    }
  }

  getConnectionState(): MobileConnectionState {
    return this.state;
  }

  subscribeConnection(listener: (state: MobileConnectionState) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  subscribeComputers(listener: () => void): () => void {
    return this.discovery?.subscribe?.(listener) ?? (() => undefined);
  }

  async listSavedComputers(): Promise<readonly MobileComputer[]> {
    const discovered = await this.readDiscoveredComputers();
    const stored = this.readStoredComputers();
    const merged = new Map(stored.map((computer) => [computer.id, computer]));
    this.connectionCandidates.clear();
    for (const { computer, candidates } of discovered) {
      const existing =
        merged.get(computer.id) ??
        candidates
          .map(({ address }) => stored.find((item) => item.address === address))
          .find((item) => item !== undefined);
      const id = existing?.id ?? computer.id;
      merged.set(id, {
        ...computer,
        id,
        address: existing?.address ?? computer.address,
        lastConnectedAt: existing?.lastConnectedAt,
      });
      this.connectionCandidates.set(id, candidates);
    }
    this.knownComputers.clear();
    for (const computer of merged.values()) this.knownComputers.set(computer.id, computer);
    return [...merged.values()].sort((left, right) => {
      const timeDifference =
        Date.parse(right.lastConnectedAt ?? "") - Date.parse(left.lastConnectedAt ?? "");
      return Number.isFinite(timeDifference) && timeDifference !== 0
        ? timeDifference
        : left.name.localeCompare(right.name);
    });
  }

  async pair(request: MobilePairingRequest): Promise<MobileComputer> {
    const candidates = [request.address, ...(request.addressCandidates ?? [])];
    const normalizedCandidates: NormalizedDebugHttpAddress[] = [];
    for (const candidate of candidates) {
      try {
        const normalized = normalizeDebugHttpBaseUrl(candidate);
        if (!normalizedCandidates.some(({ baseUrl }) => baseUrl === normalized.baseUrl)) {
          normalizedCandidates.push(normalized);
        }
      } catch {
        // Try the remaining address candidates without reflecting input in an error.
      }
    }
    if (normalizedCandidates.length === 0) {
      throw new MobileTransportError(
        "pairing-failed",
        "请输入有效的电脑地址，例如 192.168.1.20",
      );
    }

    for (const normalized of normalizedCandidates) {
      try {
        const status = await this.status(normalized.baseUrl);
        const computer: MobileComputer = {
          id: computerId(normalized.address),
          name: status.serviceName,
          address: normalized.address,
        };
        this.knownComputers.set(computer.id, computer);
        this.persistKnownComputer(computer);
        return computer;
      } catch {
        // A multi-address desktop may only be reachable through a later candidate.
      }
    }
    throw new MobileTransportError(
      "pairing-failed",
      "无法连接这台电脑，请确认地址、端口和局域网连接",
    );
  }

  async connect(id: string): Promise<void> {
    let computer = this.knownComputers.get(id);
    if (!computer) {
      await this.listSavedComputers();
      computer = this.knownComputers.get(id);
    }
    if (!computer) throw new MobileTransportError("not-found", "没有找到这台电脑");

    const attempt = this.connectionAttempt + 1;
    this.connectionAttempt = attempt;
    this.abortActiveRequests();
    this.connectedBaseUrl = undefined;
    this.setConnectionState({ kind: "connecting", computer });
    const primary = normalizeDebugHttpBaseUrl(computer.address);
    const candidates = [
      primary,
      ...(this.connectionCandidates.get(computer.id) ?? []),
    ].filter(
      (candidate, index, all) =>
        all.findIndex(({ baseUrl }) => baseUrl === candidate.baseUrl) === index,
    );
    for (const candidate of candidates) {
      try {
        const status = await this.status(candidate.baseUrl);
        if (attempt !== this.connectionAttempt) return;
        const connectedId = computerId(candidate.address);
        const connectedComputer: MobileComputer = {
          ...computer,
          id: connectedId,
          name: status.serviceName,
          address: candidate.address,
          lastConnectedAt: this.now().toISOString(),
        };
        this.connectedBaseUrl = candidate.baseUrl;
        if (connectedId !== computer.id) {
          this.knownComputers.delete(computer.id);
          const discoveredCandidates = this.connectionCandidates.get(computer.id);
          this.connectionCandidates.delete(computer.id);
          if (discoveredCandidates) {
            this.connectionCandidates.set(connectedId, discoveredCandidates);
          }
        }
        this.knownComputers.set(connectedComputer.id, connectedComputer);
        this.persistKnownComputer(connectedComputer);
        this.setConnectionState({ kind: "connected", computer: connectedComputer });
        return;
      } catch {
        if (attempt !== this.connectionAttempt) return;
      }
    }
    this.setConnectionState({
      kind: "disconnected",
      computer,
      message: "电脑暂时无法连接",
    });
    throw new MobileTransportError("unavailable", "电脑暂时无法连接");
  }

  async disconnect(): Promise<void> {
    this.connectionAttempt += 1;
    const computer = this.state.computer;
    this.connectedBaseUrl = undefined;
    this.workspaceNames.clear();
    this.abortActiveRequests();
    this.setConnectionState({ kind: "disconnected", computer });
  }

  async listWorkspaces(): Promise<readonly MobileWorkspace[]> {
    const workspaces = await this.connectedRequest("/workspaces", normalizeWorkspaces);
    this.workspaceNames.clear();
    for (const workspace of workspaces) {
      this.workspaceNames.set(workspace.id, workspace.name);
    }
    return workspaces;
  }

  async listDirectory(
    workspaceId: string,
    directoryId?: string | null,
  ): Promise<MobileDirectory> {
    const workspace = endpointId(workspaceId, "工作区不存在或已停止共享");
    const directory = directoryId
      ? `/${endpointId(directoryId, "目录不存在或已停止共享")}`
      : "/root";
    return this.connectedRequest(
      `/workspaces/${workspace}/directories${directory}`,
      normalizeDirectory,
      "目录不存在或已停止共享",
    );
  }

  async readDocument(documentId: string): Promise<MobileDocument> {
    const document = endpointId(documentId, "文档不存在或已停止共享");
    return this.connectedRequest(
      `/documents/${document}`,
      normalizeDocument,
      "文档不存在或已停止共享",
    );
  }

  async search(request: MobileSearchRequest): Promise<readonly MobileSearchResult[]> {
    const query = request.query.trim();
    if (!query) return [];
    if (
      query.length > MAX_SEARCH_QUERY_CHARACTERS ||
      (request.fileFilter?.length ?? 0) > MAX_FILE_FILTER_CHARACTERS
    ) {
      throw new MobileTransportError("unavailable", "搜索条件过长，请缩短后重试");
    }
    const workspaceIds = request.workspaceId
      ? [endpointId(request.workspaceId, "工作区不存在或已停止共享")]
      : undefined;
    const response = await this.connectedRequest(
      "/search",
      normalizeSearchResponse,
      "搜索范围不存在或已停止共享",
      {
        method: "POST",
        body: JSON.stringify({
          workspaceIds,
          query,
          caseSensitive: request.caseSensitive ?? false,
          useRegex: request.useRegex ?? false,
          fileFilter: request.fileFilter ?? null,
        }),
      },
    );
    return response.matches.map((match, index) => ({
      id: `${match.documentId}:${match.line}:${match.column}:${index}`,
      documentId: match.documentId,
      title: documentTitle(match.relativePath),
      relativePath: match.relativePath,
      workspaceName: this.workspaceNames.get(match.workspaceId) ?? "共享工作区",
      snippet: match.snippet,
    }));
  }

  async listFavorites(): Promise<readonly MobileFavorite[]> {
    return this.connectedRequest("/favorites", normalizeFavorites);
  }

  private async readDiscoveredComputers(): Promise<readonly DiscoveredComputerSnapshot[]> {
    if (!this.discovery) return [];
    try {
      const discovered = await this.discovery.list();
      const computers: DiscoveredComputerSnapshot[] = [];
      for (const item of discovered) {
        try {
          const host = item.host.includes(":")
            ? `[${item.host.replace(/^\[|\]$/g, "")}]`
            : item.host;
          const normalized = normalizeDebugHttpBaseUrl(`${host}:${item.port}`);
          const advertised = normalizeAdvertisedApiBaseUrl(item.baseUrl);
          if (advertised.baseUrl !== normalized.baseUrl) continue;
          const candidates = [item.baseUrl, ...item.candidateBaseUrls]
            .map(normalizeAdvertisedApiBaseUrl)
            .filter(
              (candidate, index, all) =>
                all.findIndex(({ baseUrl }) => baseUrl === candidate.baseUrl) === index,
            );
          computers.push({
            computer: {
              id: computerId(normalized.address),
              name: displayName(item.name),
              address: normalized.address,
            },
            candidates,
          });
        } catch {
          // Ignore malformed native discovery records; manual connection remains usable.
        }
      }
      return computers;
    } catch {
      return [];
    }
  }

  private readStoredComputers(): readonly MobileComputer[] {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(SAVED_COMPUTERS_KEY);
      if (!raw) return [];
      const value = JSON.parse(raw) as unknown;
      if (!Array.isArray(value) || value.length > MAX_SAVED_COMPUTERS) return [];
      const computers: MobileComputer[] = [];
      for (const item of value) {
        const computer = normalizeStoredComputer(item);
        if (computer && !computers.some(({ id }) => id === computer.id)) {
          computers.push(computer);
        }
      }
      return computers;
    } catch {
      return [];
    }
  }

  private persistKnownComputer(computer: MobileComputer): void {
    if (!this.storage) return;
    try {
      const stored = this.readStoredComputers().filter(({ id }) => id !== computer.id);
      const next: StoredComputer[] = [computer, ...stored]
        .slice(0, MAX_SAVED_COMPUTERS)
        .map(({ id, name, address, lastConnectedAt }) => ({
          id,
          name,
          address,
          lastConnectedAt,
        }));
      this.storage.setItem(SAVED_COMPUTERS_KEY, JSON.stringify(next));
    } catch {
      // Storage failure must not prevent this session from browsing.
    }
  }

  private async status(baseUrl: string): Promise<StatusResponse> {
    return this.request(baseUrl, "/status", normalizeStatus);
  }

  private async connectedRequest<T>(
    path: string,
    normalize: (value: unknown) => T,
    notFoundMessage = "请求的内容不存在或已停止共享",
    init: RequestInit = {},
  ): Promise<T> {
    if (this.state.kind !== "connected" || !this.connectedBaseUrl) {
      throw new MobileTransportError("not-connected", "请先连接电脑");
    }
    return this.request(
      this.connectedBaseUrl,
      path,
      normalize,
      notFoundMessage,
      init,
      this.connectionAttempt,
    );
  }

  private async request<T>(
    baseUrl: string,
    path: string,
    normalize: (value: unknown) => T,
    notFoundMessage = "请求的内容不存在或已停止共享",
    init: RequestInit = {},
    connectedAttempt?: number,
  ): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    this.activeControllers.add(controller);
    try {
      const response = await this.fetchImplementation(`${baseUrl}${path}`, {
        ...init,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: {
          Accept: "application/json",
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...init.headers,
        },
        signal: controller.signal,
      });
      if (response.status === 404) {
        throw new MobileTransportError("not-found", notFoundMessage);
      }
      if (!response.ok) {
        throw new MobileTransportError("unavailable", "电脑没有完成请求，请稍后重试");
      }
      const text = await readBoundedText(response);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        invalidResponse();
      }
      const envelope = asRecord(parsed);
      if (
        envelope.protocolVersion !== API_PROTOCOL_VERSION ||
        !Object.prototype.hasOwnProperty.call(envelope, "data") ||
        Object.prototype.hasOwnProperty.call(envelope, "error")
      ) {
        invalidResponse();
      }
      return normalize(envelope.data);
    } catch (error) {
      if (error instanceof MobileTransportError) throw error;
      if (timedOut) {
        this.markDisconnectedIfCurrent(
          connectedAttempt,
          baseUrl,
          "连接超时，请确认电脑仍在局域网内",
        );
        throw new MobileTransportError("unavailable", "连接超时，请确认电脑仍在局域网内");
      }
      if (controller.signal.aborted || this.state.kind === "disconnected") {
        throw new MobileTransportError("not-connected", "连接已断开");
      }
      if (!(error instanceof InvalidServerResponseError)) {
        this.markDisconnectedIfCurrent(
          connectedAttempt,
          baseUrl,
          "无法连接电脑，请检查局域网和地址",
        );
      }
      throw new MobileTransportError(
        "unavailable",
        error instanceof InvalidServerResponseError
          ? "电脑返回了不兼容的数据，请更新 NoteSpace 后重试"
          : "无法连接电脑，请检查局域网和地址",
      );
    } finally {
      globalThis.clearTimeout(timeout);
      this.activeControllers.delete(controller);
    }
  }

  private abortActiveRequests(): void {
    for (const controller of this.activeControllers) controller.abort();
    this.activeControllers.clear();
  }

  private markDisconnectedIfCurrent(
    connectedAttempt: number | undefined,
    baseUrl: string,
    message: string,
  ): void {
    if (
      connectedAttempt === undefined ||
      connectedAttempt !== this.connectionAttempt ||
      this.state.kind !== "connected" ||
      this.connectedBaseUrl !== baseUrl
    ) {
      return;
    }
    const computer = this.state.computer;
    this.connectedBaseUrl = undefined;
    this.abortActiveRequests();
    this.setConnectionState({ kind: "disconnected", computer, message });
  }

  private setConnectionState(state: MobileConnectionState): void {
    this.state = state;
    for (const listener of this.connectionListeners) listener(state);
  }
}

export function createDebugHttpMobileTransport(
  options: DebugHttpMobileTransportOptions = {},
): DebugHttpMobileTransport {
  return new DebugHttpMobileTransport(options);
}
