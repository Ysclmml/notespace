import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import { DemoDesktopAdapter, isTauriRuntime, TauriDesktopAdapter } from "./desktopAdapter";

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
});

describe("desktop adapter environment", () => {
  it("uses a small explicit Tauri marker check", () => {
    expect(isTauriRuntime({})).toBe(false);
    expect(isTauriRuntime({ __TAURI_INTERNALS__: {} })).toBe(true);
  });
});

describe("browser demo adapter", () => {
  it("opens only HTTP(S) in a separate browser page without an opener", async () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    try {
      const adapter = new DemoDesktopAdapter();
      await adapter.openExternalUrl("HTTPS://EXAMPLE.TEST/guide?q=hello#section");
      await adapter.openExternalUrl("http://localhost:8080/docs");
      for (const url of [
        "javascript:alert(1)",
        "file:///tmp/test.md",
        "https://",
        "https://example.test/\npath",
      ]) {
        await expect(adapter.openExternalUrl(url)).rejects.toThrow();
      }
      expect(open.mock.calls).toEqual([
        ["https://example.test/guide?q=hello#section", "_blank", "noopener,noreferrer"],
        ["http://localhost:8080/docs", "_blank", "noopener,noreferrer"],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("supports the same workspace/open/save shape without touching disk", async () => {
    const adapter = new DemoDesktopAdapter();
    const workspace = await adapter.pickWorkspace();
    const nodes = await adapter.listWorkspace(workspace.path);
    const firstNode = nodes[0];
    if (!firstNode) throw new Error("expected a demo document");
    const document = await adapter.openDocument(firstNode.path);

    expect(document.status).toBe("editable");
    if (document.status !== "editable") throw new Error("expected editable demo");

    await adapter.saveDocument(document.path, `${document.content}\n已编辑`);
    const reopened = await adapter.openDocument(document.path);
    expect(reopened.status === "editable" && reopened.content.endsWith("已编辑")).toBe(
      true,
    );

    const pickedFile = await adapter.pickDocument();
    expect(pickedFile.name).toBe("example.py");
    const savedAs = await adapter.saveDocumentAs("notes.txt", "plain text", []);
    const reopenedText = await adapter.openDocument(savedAs.path);
    expect(reopenedText).toMatchObject({
      status: "editable",
      documentKind: "text",
      content: "plain text",
    });
  });

  it("does not overwrite another open demo session during Save As", async () => {
    const adapter = new DemoDesktopAdapter();

    await expect(
      adapter.saveDocumentAs("example.py", "replacement", [
        "demo://paper-and-ink/example.py",
      ]),
    ).rejects.toThrow("already open");
    const reopened = await adapter.openDocument("demo://paper-and-ink/example.py");
    expect(reopened.status === "editable" && reopened.content).toContain("workspace_name");
  });

  it("lists new empty folders and creates files below existing and new nested folders", async () => {
    const adapter = new DemoDesktopAdapter();
    const root = "demo://paper-and-ink";

    await adapter.createWorkspaceFolder(root, root, "笔记 目录");
    await adapter.createWorkspaceFolder(root, `${root}/guide`, "新目录");
    await adapter.createWorkspaceFolder(root, `${root}/guide/新目录`, "child");
    const created = await adapter.createWorkspaceTextFile(
      root,
      `${root}/guide/新目录`,
      "notes.md",
    );
    const nodes = await adapter.listWorkspace(root);

    expect(nodes.find((node) => node.name === "笔记 目录")).toMatchObject({
      kind: "directory",
      relativePath: "笔记 目录",
      children: [],
    });
    const nested = nodes
      .find((node) => node.name === "guide")
      ?.children?.find((node) => node.name === "新目录");
    expect(nested?.children).toEqual([
      {
        kind: "directory",
        name: "child",
        path: `${root}/guide/新目录/child`,
        relativePath: "guide/新目录/child",
        children: [],
      },
      {
        kind: "markdown",
        name: "notes.md",
        path: `${root}/guide/新目录/notes.md`,
        relativePath: "guide/新目录/notes.md",
      },
    ]);
    expect(created).toMatchObject({
      status: "editable",
      path: `${root}/guide/新目录/notes.md`,
      content: "",
    });
    expect(
      (await new DemoDesktopAdapter().listWorkspace(root)).some(
        (node) => node.name === "笔记 目录",
      ),
    ).toBe(false);
  });

  it("rejects conflicting, invalid and missing folder targets without changing the demo tree", async () => {
    const adapter = new DemoDesktopAdapter();
    const root = "demo://paper-and-ink";
    const before = await adapter.listWorkspace(root);
    for (const name of [
      "",
      " ",
      ".",
      "..",
      "../escape",
      "one/two",
      "one\\two",
      "bad\0name",
    ]) {
      await expect(adapter.createWorkspaceFolder(root, root, name)).rejects.toThrow();
    }
    await expect(adapter.createWorkspaceFolder(root, root, "example.py")).rejects.toThrow(
      "已经存在",
    );
    await expect(adapter.createWorkspaceFolder(root, root, "guide")).rejects.toThrow(
      "已经存在",
    );
    await expect(
      adapter.createWorkspaceFolder(root, `${root}/missing`, "child"),
    ).rejects.toThrow();
    await expect(
      adapter.createWorkspaceFolder(root, `${root}/example.py`, "child"),
    ).rejects.toThrow();
    await expect(
      adapter.createWorkspaceFolder(root, "demo://outside", "child"),
    ).rejects.toThrow();
    expect(await adapter.listWorkspace(root)).toEqual(before);
  });

  it("recursively hides dot files and dot folders by default without removing them", async () => {
    const adapter = new DemoDesktopAdapter();
    const root = "demo://paper-and-ink";
    await adapter.createWorkspaceTextFile(root, root, ".env");
    await adapter.createWorkspaceFolder(root, `${root}/guide`, ".drafts");
    await adapter.createWorkspaceTextFile(root, `${root}/guide`, ".notes.md");
    await adapter.createWorkspaceTextFile(root, `${root}/guide/.drafts`, "nested.md");

    const hidden = await adapter.listWorkspace(root);
    expect(hidden.some((node) => node.name === ".env")).toBe(false);
    expect(
      hidden
        .find((node) => node.name === "guide")
        ?.children?.some((node) => node.name.startsWith(".")),
    ).toBe(false);

    const visible = await adapter.listWorkspace(root, true);
    expect(visible.find((node) => node.name === ".env")).toBeDefined();
    const guide = visible.find((node) => node.name === "guide");
    expect(guide?.children?.find((node) => node.name === ".notes.md")).toBeDefined();
    expect(
      guide?.children?.find((node) => node.name === ".drafts")?.children?.[0]?.name,
    ).toBe("nested.md");
    expect(await adapter.listWorkspace(root, false)).toEqual(hidden);
  });
});

describe("Tauri desktop adapter", () => {
  it("inspects disk metadata without opening bodies and forwards watch replacements", async () => {
    const adapter = new TauriDesktopAdapter();
    const inspection = [
      { path: "/workspace/a.md", status: "present", revision: "v1-disk" },
      { path: "/outside/b.py", status: "missing" },
      { path: "/outside/c.txt", status: "unreadable" },
    ];
    invokeMock.mockResolvedValueOnce(inspection).mockResolvedValue(undefined);
    expect(await adapter.inspectDocuments(inspection.map(({ path }) => path))).toEqual(
      inspection,
    );
    await adapter.watchFileSystem(["/workspace"], ["/outside/b.py"]);
    await adapter.watchFileSystem([], []);
    expect(invokeMock.mock.calls).toEqual([
      ["inspect_documents", { paths: inspection.map(({ path }) => path) }],
      [
        "watch_filesystem",
        { workspaceRoots: ["/workspace"], documentPaths: ["/outside/b.py"] },
      ],
      ["watch_filesystem", { workspaceRoots: [], documentPaths: [] }],
    ]);
  });

  it("forwards filesystem event paths and preserves listener cleanup", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    const listener = vi.fn();
    const adapter = new TauriDesktopAdapter();
    const cleanup = await adapter.listenFileSystemChanges(listener);
    expect(listenMock).toHaveBeenCalledWith("filesystem-changed", expect.any(Function));
    const callback = listenMock.mock.calls[0]?.[1] as (event: {
      payload: { paths: string[] };
    }) => void;
    callback({ payload: { paths: ["/workspace/a.md", "/outside/b.py"] } });
    expect(listener).toHaveBeenCalledWith({ paths: ["/workspace/a.md", "/outside/b.py"] });
    cleanup();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("passes the save baseline and returns only the native written revision", async () => {
    const adapter = new TauriDesktopAdapter();
    const saved = { path: "/workspace/a.md", bytesWritten: 4, diskRevision: "v1-written" };
    invokeMock
      .mockResolvedValueOnce(saved)
      .mockRejectedValueOnce({ code: "externalChange", message: "changed" });
    expect(await adapter.saveDocument(saved.path, "body", "v1-read")).toEqual(saved);
    await expect(
      adapter.saveDocument(saved.path, "stale", "v1-read"),
    ).rejects.toMatchObject({ code: "externalChange" });
    expect(invokeMock).toHaveBeenNthCalledWith(1, "save_document", {
      path: saved.path,
      content: "body",
      expectedRevision: "v1-read",
    });
    invokeMock.mockResolvedValueOnce(saved);
    await adapter.saveDocument(saved.path, "body");
    expect(invokeMock).toHaveBeenLastCalledWith("save_document", {
      path: saved.path,
      content: "body",
    });
  });

  it("forwards an explicit per-workspace hidden-entry flag, defaulting it off", async () => {
    invokeMock.mockResolvedValue([]);
    const adapter = new TauriDesktopAdapter();
    await adapter.listWorkspace("/workspace");
    await adapter.listWorkspace("/workspace", true);
    await adapter.listWorkspace("/another", false);
    expect(invokeMock.mock.calls).toEqual([
      ["list_workspace", { rootPath: "/workspace", showHidden: false }],
      ["list_workspace", { rootPath: "/workspace", showHidden: true }],
      ["list_workspace", { rootPath: "/another", showHidden: false }],
    ]);
  });

  it("forwards external URLs exactly and propagates browser launcher failures", async () => {
    invokeMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce({
      code: "externalOpenFailed",
      message: "No browser handler",
    });
    const adapter = new TauriDesktopAdapter();
    const url = "https://example.test/path?q=a%20b&lang=zh#section";

    await adapter.openExternalUrl(url);
    await expect(adapter.openExternalUrl("http://localhost:8080/docs")).rejects.toEqual({
      code: "externalOpenFailed",
      message: "No browser handler",
    });

    expect(invokeMock.mock.calls).toEqual([
      ["open_external_url", { url }],
      ["open_external_url", { url: "http://localhost:8080/docs" }],
    ]);
  });

  it("forwards folder creation arguments without adding a file suffix", async () => {
    invokeMock.mockResolvedValue(undefined);
    const adapter = new TauriDesktopAdapter();

    await adapter.createWorkspaceFolder("/workspace", "/workspace/guide", "新目录");

    expect(invokeMock).toHaveBeenCalledWith("create_workspace_folder", {
      workspaceRoot: "/workspace",
      directoryPath: "/workspace/guide",
      folderName: "新目录",
    });
  });

  it("forwards file manager reveal, trash, and workspace file creation arguments", async () => {
    const created = {
      status: "editable" as const,
      path: "/workspace/guide/notes.md",
      content: "",
      mode: "normal" as const,
      documentKind: "markdown" as const,
      language: "markdown",
      preflight: {
        sizeBytes: 0,
        longestLineBytes: 0,
        containsDataImageBase64: false,
      },
    };
    invokeMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(created);
    const adapter = new TauriDesktopAdapter();

    await adapter.revealInFileManager("/workspace/guide/notes.md");
    await adapter.moveWorkspaceEntryToTrash("/workspace", "/workspace/guide/old-notes.md");
    const result = await adapter.createWorkspaceTextFile(
      "/workspace",
      "/workspace/guide",
      "notes.md",
    );

    expect(invokeMock.mock.calls).toEqual([
      ["reveal_in_file_manager", { path: "/workspace/guide/notes.md" }],
      [
        "move_workspace_entry_to_trash",
        {
          workspaceRoot: "/workspace",
          path: "/workspace/guide/old-notes.md",
        },
      ],
      [
        "create_workspace_text_file",
        {
          workspaceRoot: "/workspace",
          directoryPath: "/workspace/guide",
          fileName: "notes.md",
        },
      ],
    ]);
    expect(result).toEqual(created);
  });

  it("passes excluded open paths to Save As without changing their order", async () => {
    invokeMock.mockResolvedValue({ path: "/workspace/new.md", bytesWritten: 5 });
    const adapter = new TauriDesktopAdapter();

    await adapter.saveDocumentAs("new.md", "hello", [
      "/workspace/first.md",
      "/workspace/second.py",
    ]);

    expect(invokeMock).toHaveBeenCalledWith("save_document_as", {
      suggestedFileName: "new.md",
      content: "hello",
      excludedPaths: ["/workspace/first.md", "/workspace/second.py"],
    });
  });

  it("forwards custom file and lifecycle menu actions to the application listener", async () => {
    listenMock.mockResolvedValue(() => undefined);
    const adapter = new TauriDesktopAdapter();
    const listener = vi.fn();

    await adapter.listenNativeMenuAction(listener);
    const nativeListener = listenMock.mock.calls[0]?.[1] as
      ((event: { payload: { id: string } }) => void) | undefined;
    if (!nativeListener) throw new Error("expected a native menu listener");

    nativeListener({ payload: { id: "file.reveal" } });
    nativeListener({ payload: { id: "edit.find" } });
    nativeListener({ payload: { id: "window.close" } });
    nativeListener({ payload: { id: "app.quit" } });

    expect(listener.mock.calls).toEqual([
      ["file.reveal"],
      ["edit.find"],
      ["window.close"],
      ["app.quit"],
    ]);
  });
});
