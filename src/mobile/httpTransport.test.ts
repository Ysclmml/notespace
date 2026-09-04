import { afterEach, describe, expect, it, vi } from "vitest";

import { DebugHttpMobileTransport, normalizeDebugHttpBaseUrl } from "./httpTransport";
import { MobileTransportError } from "./transport";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ protocolVersion: 1, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function statusResponse() {
  return response({
    protocolVersion: 1,
    serviceName: "书房电脑",
    activeRequestCount: 0,
  });
}

async function pairAndConnect(transport: DebugHttpMobileTransport) {
  const computer = await transport.pair({
    address: "192.168.1.20:43127",
    pairingCode: "",
    certificateFingerprint: "",
  });
  await transport.connect(computer.id);
  return computer;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("normalizeDebugHttpBaseUrl", () => {
  it.each([
    ["NOTE.local", "note.local:49920", "http://note.local:49920/api/v1"],
    ["192.168.1.20", "192.168.1.20:49920", "http://192.168.1.20:49920/api/v1"],
    ["http://example.test/", "example.test:49920", "http://example.test:49920/api/v1"],
    ["[fd00::8]", "[fd00::8]:49920", "http://[fd00::8]:49920/api/v1"],
    ["NOTE.local:43127", "note.local:43127", "http://note.local:43127/api/v1"],
    [
      "http://192.168.1.20:43127/",
      "192.168.1.20:43127",
      "http://192.168.1.20:43127/api/v1",
    ],
    ["[::1]:8080", "[::1]:8080", "http://[::1]:8080/api/v1"],
    ["example.test:80", "example.test:80", "http://example.test:80/api/v1"],
  ])("normalizes %s", (input, address, baseUrl) => {
    expect(normalizeDebugHttpBaseUrl(input)).toEqual({ address, baseUrl });
  });

  it.each([
    "",
    "https://example.test:43127",
    "http://user@example.test:43127",
    "http://example.test:43127/api/v1",
    "http://example.test:43127/./",
    "http://example.test:43127?workspace=secret",
    "http://example.test:43127#secret",
    "example.test:70000",
    "bad host:43127",
    "2001:db8::1:43127",
  ])("rejects unsafe or ambiguous input %s", (input) => {
    expect(() => normalizeDebugHttpBaseUrl(input)).toThrow(MobileTransportError);
  });
});

describe("DebugHttpMobileTransport", () => {
  it("uses port 49920 when a manual computer address omits the port", async () => {
    const fetch = vi.fn(async () => statusResponse());
    const transport = new DebugHttpMobileTransport({ fetch, storage: memoryStorage() });

    const paired = await transport.pair({
      address: "NOTE.local",
      pairingCode: "",
      certificateFingerprint: "",
    });

    expect(paired).toMatchObject({
      id: "debug-http:note.local:49920",
      address: "note.local:49920",
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://note.local:49920/api/v1/status",
      expect.objectContaining({ credentials: "omit", redirect: "error" }),
    );
  });

  it("persists a verified manual computer and restores it without storing document paths", async () => {
    const storage = memoryStorage();
    const fetch = vi.fn(async () => statusResponse());
    const now = () => new Date("2026-09-04T10:00:00.000Z");
    const transport = new DebugHttpMobileTransport({ fetch, storage, now });

    const paired = await transport.pair({
      address: "http://NOTE.local:43127",
      pairingCode: "",
      certificateFingerprint: "",
    });
    expect(paired).toMatchObject({
      id: "debug-http:note.local:43127",
      name: "书房电脑",
      address: "note.local:43127",
    });
    await transport.connect(paired.id);

    expect(transport.getConnectionState()).toEqual({
      kind: "connected",
      computer: {
        ...paired,
        lastConnectedAt: "2026-09-04T10:00:00.000Z",
      },
    });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://note.local:43127/api/v1/status",
      expect.objectContaining({ credentials: "omit", redirect: "error" }),
    );
    const restored = new DebugHttpMobileTransport({ fetch, storage });
    expect(await restored.listSavedComputers()).toEqual([
      expect.objectContaining({
        id: paired.id,
        address: "note.local:43127",
        lastConnectedAt: "2026-09-04T10:00:00.000Z",
      }),
    ]);
    const storageKey = storage.key(0);
    expect(storageKey).not.toBeNull();
    expect(storage.getItem(storageKey!)).not.toContain("/Users/");
  });

  it("implements every versioned read-only endpoint and maps search metadata", async () => {
    const requests: { readonly url: string; readonly init?: RequestInit }[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/status")) return statusResponse();
      if (url.endsWith("/workspaces")) {
        return response([
          {
            id: "workspace-1",
            syncKey: "workspace_0123456789abcdef0123456789abcdef",
            name: "产品笔记",
          },
        ]);
      }
      if (url.endsWith("/workspaces/workspace-1/directories/root")) {
        return response({
          workspaceId: "workspace-1",
          directoryId: null,
          name: "产品笔记",
          breadcrumbs: [{ id: null, name: "产品笔记" }],
          entries: [
            { id: "folder-1", name: "设计", kind: "directory" },
            { id: "document-1", name: "说明.md", kind: "document" },
          ],
          scannedEntries: 2,
          truncated: false,
        });
      }
      if (url.endsWith("/workspaces/workspace-1/directories/folder-1")) {
        return response({
          workspaceId: "workspace-1",
          directoryId: "folder-1",
          name: "设计",
          breadcrumbs: [
            { id: null, name: "产品笔记" },
            { id: "folder-1", name: "设计" },
          ],
          entries: [],
          scannedEntries: 0,
          truncated: false,
        });
      }
      if (url.endsWith("/documents/document-1")) {
        return response({
          id: "document-1",
          workspaceId: "workspace-1",
          workspaceName: "产品笔记",
          title: "说明",
          relativePath: "设计/说明.md",
          markdown: "# 说明",
          sizeBytes: 8,
        });
      }
      if (url.endsWith("/search")) {
        return response({
          matches: [
            {
              workspaceId: "workspace-1",
              documentId: "document-1",
              relativePath: "设计/说明.md",
              line: 4,
              column: 2,
              matchLength: 3,
              snippet: "这里是匹配内容",
            },
          ],
          searchedFiles: 1,
          skippedFiles: 0,
          scannedEntries: 1,
          unavailableWorkspaces: [],
          truncated: false,
        });
      }
      if (url.endsWith("/favorites")) return response([]);
      return response({}, 404);
    });
    const transport = new DebugHttpMobileTransport({ fetch, storage: memoryStorage() });
    await pairAndConnect(transport);

    expect(await transport.listWorkspaces()).toEqual([
      {
        id: "workspace-1",
        syncKey: "workspace_0123456789abcdef0123456789abcdef",
        name: "产品笔记",
      },
    ]);
    expect(await transport.listDirectory("workspace-1", null)).toMatchObject({
      directoryId: null,
      entries: [{ kind: "directory" }, { kind: "document" }],
    });
    expect(await transport.listDirectory("workspace-1", "folder-1")).toMatchObject({
      directoryId: "folder-1",
      name: "设计",
    });
    expect(await transport.readDocument("document-1")).toMatchObject({
      relativePath: "设计/说明.md",
      markdown: "# 说明",
    });
    expect(
      await transport.search({
        query: " 匹配 ",
        workspaceId: "workspace-1",
        caseSensitive: true,
        useRegex: true,
        fileFilter: "\\.md$",
      }),
    ).toEqual([
      {
        id: "document-1:4:2:0",
        documentId: "document-1",
        title: "说明",
        relativePath: "设计/说明.md",
        workspaceName: "产品笔记",
        snippet: "这里是匹配内容",
      },
    ]);
    expect(await transport.listFavorites()).toEqual([]);

    const searchRequest = requests.find(({ url }) => url.endsWith("/search"));
    expect(searchRequest?.init?.method).toBe("POST");
    expect(JSON.parse(String(searchRequest?.init?.body))).toEqual({
      workspaceIds: ["workspace-1"],
      query: "匹配",
      caseSensitive: true,
      useRegex: true,
      fileFilter: "\\.md$",
    });
    expect(requests.map(({ url }) => url)).toEqual(
      expect.arrayContaining([
        "http://192.168.1.20:43127/api/v1/workspaces",
        "http://192.168.1.20:43127/api/v1/workspaces/workspace-1/directories/root",
        "http://192.168.1.20:43127/api/v1/workspaces/workspace-1/directories/folder-1",
        "http://192.168.1.20:43127/api/v1/documents/document-1",
        "http://192.168.1.20:43127/api/v1/search",
        "http://192.168.1.20:43127/api/v1/favorites",
      ]),
    );
  });

  it("rejects a malformed workspace sync key", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/status")) return statusResponse();
      return response([
        { id: "workspace-1", syncKey: "../private-workspace", name: "产品笔记" },
      ]);
    });
    const transport = new DebugHttpMobileTransport({ fetch, storage: memoryStorage() });
    await pairAndConnect(transport);

    await expect(transport.listWorkspaces()).rejects.toMatchObject({
      code: "unavailable",
      message: "电脑返回了不兼容的数据，请更新 NoteSpace 后重试",
    });
  });

  it("merges native discovery snapshots and emits discovery refresh events", async () => {
    let refresh: (() => void) | undefined;
    const discovery = {
      list: vi.fn(async () => [
        {
          id: "service-1",
          name: "自动发现的电脑",
          host: "192.168.1.50",
          port: 45555,
          baseUrl: "http://192.168.1.50:45555/api/v1",
          candidateBaseUrls: ["http://192.168.1.50:45555/api/v1"],
          lastSeenAt: 1,
        },
      ]),
      subscribe: vi.fn((listener: () => void) => {
        refresh = listener;
        return () => {
          refresh = undefined;
        };
      }),
    };
    const transport = new DebugHttpMobileTransport({
      fetch: vi.fn(async () => statusResponse()),
      storage: memoryStorage(),
      discovery,
    });
    const listener = vi.fn();
    const unsubscribe = transport.subscribeComputers(listener);

    expect(await transport.listSavedComputers()).toEqual([
      expect.objectContaining({
        id: "debug-http:192.168.1.50:45555",
        name: "自动发现的电脑",
        address: "192.168.1.50:45555",
      }),
    ]);
    refresh?.();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    expect(refresh).toBeUndefined();
  });

  it("tries every discovered address and persists the first reachable candidate", async () => {
    const storage = memoryStorage();
    const discovery = {
      list: async () => [
        {
          id: "stable-instance-id",
          name: "多网卡电脑",
          host: "10.0.0.8",
          port: 43127,
          baseUrl: "http://10.0.0.8:43127/api/v1",
          candidateBaseUrls: [
            "http://10.0.0.8:43127/api/v1",
            "http://192.168.1.80:43127/api/v1",
          ],
          lastSeenAt: 1,
        },
      ],
    };
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("http://10.0.0.8:")) {
        throw new TypeError("unreachable interface");
      }
      return statusResponse();
    });
    const transport = new DebugHttpMobileTransport({ fetch, storage, discovery });
    const [computer] = await transport.listSavedComputers();
    expect(computer).toBeDefined();

    await transport.connect(computer!.id);

    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
      "http://10.0.0.8:43127/api/v1/status",
      "http://192.168.1.80:43127/api/v1/status",
    ]);
    expect(transport.getConnectionState()).toMatchObject({
      kind: "connected",
      computer: {
        id: "debug-http:192.168.1.80:43127",
        address: "192.168.1.80:43127",
      },
    });

    const restored = new DebugHttpMobileTransport({ fetch, storage });
    expect(await restored.listSavedComputers()).toEqual([
      expect.objectContaining({
        id: "debug-http:192.168.1.80:43127",
        address: "192.168.1.80:43127",
      }),
    ]);
  });

  it("maps timeout and disconnect aborts without returning transport details", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/status")) return Promise.resolve(statusResponse());
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted at /Users/alice/private.md", "AbortError")),
        );
      });
    });
    const transport = new DebugHttpMobileTransport({
      fetch,
      storage: memoryStorage(),
      timeoutMs: 300,
    });
    const computer = await pairAndConnect(transport);

    const timedOut = transport.listWorkspaces().then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(301);
    expect(await timedOut).toMatchObject({
      code: "unavailable",
      message: "连接超时，请确认电脑仍在局域网内",
    });
    expect(transport.getConnectionState()).toMatchObject({
      kind: "disconnected",
      computer: { id: computer.id },
    });

    await transport.connect(computer.id);
    const aborted = transport.listWorkspaces().then(
      () => null,
      (error: unknown) => error,
    );
    await transport.disconnect();
    const abortedError = await aborted;
    expect(abortedError).toMatchObject({
      code: "not-connected",
      message: "连接已断开",
    });
    expect(String(abortedError)).not.toContain("/Users/alice/private.md");
  });

  it("marks only the current connection offline after a network failure", async () => {
    let workspacesFailure: Error | null = new TypeError("socket closed");
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/status")) return statusResponse();
      if (workspacesFailure) throw workspacesFailure;
      return new Response("service unavailable", { status: 503 });
    });
    const transport = new DebugHttpMobileTransport({ fetch, storage: memoryStorage() });
    const computer = await pairAndConnect(transport);

    await expect(transport.listWorkspaces()).rejects.toMatchObject({ code: "unavailable" });
    expect(transport.getConnectionState()).toMatchObject({
      kind: "disconnected",
      computer: { id: computer.id },
    });

    await transport.connect(computer.id);
    workspacesFailure = null;
    await expect(transport.listWorkspaces()).rejects.toMatchObject({ code: "unavailable" });
    expect(transport.getConnectionState().kind).toBe("connected");
  });

  it("does not let a stale failed request disconnect a newer connection", async () => {
    let rejectOldRequest: ((error: Error) => void) | undefined;
    const fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith("/status")) return Promise.resolve(statusResponse());
      return new Promise<Response>((_, reject) => {
        rejectOldRequest = reject;
      });
    });
    const transport = new DebugHttpMobileTransport({ fetch, storage: memoryStorage() });
    const computer = await pairAndConnect(transport);
    const oldRequest = transport.listWorkspaces().catch((error: unknown) => error);

    await transport.connect(computer.id);
    rejectOldRequest?.(new TypeError("old socket closed"));
    await oldRequest;

    expect(transport.getConnectionState()).toMatchObject({
      kind: "connected",
      computer: { id: computer.id },
    });
  });

  it("rejects absolute paths and never exposes a server error message", async () => {
    let mode: "path" | "server" = "path";
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/status")) return statusResponse();
      if (mode === "server") {
        return new Response(
          JSON.stringify({
            protocolVersion: 1,
            error: { code: "internal", message: "failed at /Users/alice/private.md" },
          }),
          { status: 500 },
        );
      }
      return response({
        id: "document-1",
        workspaceId: "workspace-1",
        workspaceName: "产品笔记",
        title: "私密路径",
        relativePath: "/Users/alice/private.md",
        markdown: "# 内容",
        sizeBytes: 8,
      });
    });
    const transport = new DebugHttpMobileTransport({ fetch, storage: memoryStorage() });
    await pairAndConnect(transport);

    const invalidPath = await transport
      .readDocument("document-1")
      .catch((error: unknown) => error);
    expect(invalidPath).toMatchObject({ code: "unavailable" });
    expect(String(invalidPath)).not.toContain("/Users/alice/private.md");

    mode = "server";
    const serverFailure = await transport
      .readDocument("document-1")
      .catch((error: unknown) => error);
    expect(serverFailure).toMatchObject({ code: "unavailable" });
    expect(String(serverFailure)).not.toContain("/Users/alice/private.md");
  });

  it("rejects an incompatible response envelope without exposing its payload", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/status")) return statusResponse();
      return new Response(
        JSON.stringify({
          protocolVersion: 2,
          data: { absolutePath: "/Users/alice/private.md" },
        }),
      );
    });
    const transport = new DebugHttpMobileTransport({ fetch, storage: memoryStorage() });
    await pairAndConnect(transport);

    const error = await transport.listWorkspaces().catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      code: "unavailable",
      message: "电脑返回了不兼容的数据，请更新 NoteSpace 后重试",
    });
    expect(String(error)).not.toContain("/Users/alice/private.md");
  });
});
