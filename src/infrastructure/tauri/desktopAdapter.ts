import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  WorkspaceSearch,
  WorkspaceSearchMatch,
} from "../../features/workspace-search/types";

export interface WorkspaceSelection {
  readonly path: string;
  readonly name: string;
}

export interface DocumentSelection {
  readonly path: string;
  readonly name: string;
}

export type NativeMenuActionId =
  | "file.new"
  | "file.open"
  | "workspace.open"
  | "file.save"
  | "file.saveAs"
  | "file.exportHtml"
  | "file.reveal"
  | "edit.find"
  | "edit.findWorkspace"
  | "app.settings"
  | "app.quit"
  | "view.toggleSource"
  | "view.toggleSidebar"
  | "window.close"
  | "help.open";

export type WorkspaceNodeKind = "directory" | "markdown" | "text";
export type DocumentKind = "markdown" | "text";

export interface WorkspaceNode {
  readonly name: string;
  readonly path: string;
  readonly relativePath: string;
  readonly kind: WorkspaceNodeKind;
  readonly children?: readonly WorkspaceNode[];
}

export interface DocumentPreflight {
  readonly sizeBytes: number;
  readonly longestLineBytes: number;
  readonly containsDataImageBase64: boolean;
}

export interface EditableDocumentResult {
  readonly status: "editable";
  readonly path: string;
  readonly content: string;
  readonly mode: "normal" | "sourceOnly";
  readonly documentKind: DocumentKind;
  readonly language: string;
  readonly preflight: DocumentPreflight;
  readonly diskRevision?: string;
}

export interface BlockedDocumentResult {
  readonly status: "blocked";
  readonly path: string;
  readonly reason: "invalidUtf8" | "lineTooLong" | "largeDataUri";
  readonly preflight: DocumentPreflight;
}

export type OpenDocumentResult = EditableDocumentResult | BlockedDocumentResult;

export interface SaveDocumentResult {
  readonly path: string;
  readonly bytesWritten: number;
  readonly diskRevision?: string;
}

export interface DocumentInspection {
  readonly path: string;
  readonly status: "present" | "missing" | "unreadable";
  readonly revision?: string;
}

export interface FileSystemChanges {
  readonly paths: readonly string[];
}

export interface SavedClipboardImage {
  readonly path: string;
  readonly markdownUri: string;
  readonly width: number;
  readonly height: number;
}

export interface LocalFilePreview {
  readonly path: string;
  readonly language: string;
  readonly targetLine?: number;
  readonly startLine: number;
  readonly content: string;
}

export interface DesktopAdapter {
  readonly kind: "tauri" | "demo";
  pickWorkspace(): Promise<WorkspaceSelection | null>;
  pickDocument(): Promise<DocumentSelection | null>;
  listWorkspace(rootPath: string, showHidden?: boolean): Promise<readonly WorkspaceNode[]>;
  searchWorkspaces?: WorkspaceSearch;
  exportHtml?(
    suggestedFileName: string,
    html: string,
    excludedPaths: readonly string[],
  ): Promise<{ readonly path: string; readonly bytesWritten: number } | null>;
  openDocument(path: string): Promise<OpenDocumentResult>;
  inspectDocuments?(paths: readonly string[]): Promise<readonly DocumentInspection[]>;
  watchFileSystem?(
    workspaceRoots: readonly string[],
    documentPaths: readonly string[],
  ): Promise<void>;
  listenFileSystemChanges?(
    listener: (changes: FileSystemChanges) => void,
  ): Promise<() => void>;
  openExternalUrl?(url: string): Promise<void>;
  revealInFileManager(path: string): Promise<void>;
  moveWorkspaceEntryToTrash(workspaceRoot: string, path: string): Promise<void>;
  createWorkspaceTextFile(
    workspaceRoot: string,
    directoryPath: string,
    fileName: string,
  ): Promise<OpenDocumentResult>;
  createWorkspaceFolder?(
    workspaceRoot: string,
    directoryPath: string,
    folderName: string,
  ): Promise<void>;
  previewLocalFile(reference: string, documentPath: string): Promise<LocalFilePreview>;
  saveDocument(
    path: string,
    content: string,
    expectedRevision?: string,
  ): Promise<SaveDocumentResult>;
  saveDocumentAs(
    suggestedFileName: string,
    content: string,
    excludedPaths: readonly string[],
  ): Promise<SaveDocumentResult | null>;
  pickImageDirectory?(locale: "zh-CN" | "en-US"): Promise<string | null>;
  hasClipboardImage?(): Promise<boolean>;
  saveClipboardImage(
    documentPath: string,
    directoryPath?: string,
  ): Promise<SavedClipboardImage>;
  setNativeMenuLocale?(locale: "zh-CN" | "en-US"): Promise<void>;
  listenNativeMenuAction?(
    listener: (actionId: NativeMenuActionId) => void,
  ): Promise<() => void>;
}

export class TauriDesktopAdapter implements DesktopAdapter {
  readonly kind = "tauri" as const;

  searchWorkspaces: WorkspaceSearch = (workspaces, query, caseSensitive) =>
    invoke("search_workspaces", { workspaces, query, caseSensitive });

  exportHtml(suggestedFileName: string, html: string, excludedPaths: readonly string[]) {
    return invoke<{ path: string; bytesWritten: number } | null>("export_html", {
      suggestedFileName,
      html,
      excludedPaths,
    });
  }

  pickWorkspace() {
    return invoke<WorkspaceSelection | null>("pick_workspace");
  }

  pickDocument() {
    return invoke<DocumentSelection | null>("pick_document");
  }

  listWorkspace(rootPath: string, showHidden = false) {
    return invoke<WorkspaceNode[]>("list_workspace", { rootPath, showHidden });
  }

  openDocument(path: string) {
    return invoke<OpenDocumentResult>("open_document", { path });
  }

  inspectDocuments(paths: readonly string[]) {
    return invoke<DocumentInspection[]>("inspect_documents", { paths });
  }

  watchFileSystem(workspaceRoots: readonly string[], documentPaths: readonly string[]) {
    return invoke<void>("watch_filesystem", { workspaceRoots, documentPaths });
  }

  listenFileSystemChanges(listener: (changes: FileSystemChanges) => void) {
    return listen<FileSystemChanges>("filesystem-changed", (event) =>
      listener(event.payload),
    );
  }

  openExternalUrl(url: string) {
    return invoke<void>("open_external_url", { url });
  }

  revealInFileManager(path: string) {
    return invoke<void>("reveal_in_file_manager", { path });
  }

  moveWorkspaceEntryToTrash(workspaceRoot: string, path: string) {
    return invoke<void>("move_workspace_entry_to_trash", { workspaceRoot, path });
  }

  createWorkspaceTextFile(workspaceRoot: string, directoryPath: string, fileName: string) {
    return invoke<OpenDocumentResult>("create_workspace_text_file", {
      workspaceRoot,
      directoryPath,
      fileName,
    });
  }

  createWorkspaceFolder(workspaceRoot: string, directoryPath: string, folderName: string) {
    return invoke<void>("create_workspace_folder", {
      workspaceRoot,
      directoryPath,
      folderName,
    });
  }

  previewLocalFile(reference: string, documentPath: string) {
    return invoke<LocalFilePreview>("preview_local_file", { reference, documentPath });
  }

  saveDocument(path: string, content: string, expectedRevision?: string) {
    return invoke<SaveDocumentResult>("save_document", {
      path,
      content,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    });
  }

  saveDocumentAs(
    suggestedFileName: string,
    content: string,
    excludedPaths: readonly string[],
  ) {
    return invoke<SaveDocumentResult | null>("save_document_as", {
      suggestedFileName,
      content,
      excludedPaths,
    });
  }

  pickImageDirectory(locale: "zh-CN" | "en-US") {
    return invoke<string | null>("pick_image_directory", { locale });
  }

  hasClipboardImage() {
    return invoke<boolean>("clipboard_has_image");
  }

  saveClipboardImage(documentPath: string, directoryPath?: string) {
    return invoke<SavedClipboardImage>("save_clipboard_image", {
      documentPath,
      ...(directoryPath === undefined ? {} : { directoryPath }),
    });
  }

  setNativeMenuLocale(locale: "zh-CN" | "en-US") {
    return invoke<void>("set_native_menu_locale", { locale });
  }

  listenNativeMenuAction(listener: (actionId: NativeMenuActionId) => void) {
    return listen<{ id: string }>("native-menu-action", (event) => {
      listener(event.payload.id as NativeMenuActionId);
    });
  }
}

const demoDocuments = new Map<string, string>([
  [
    "demo://paper-and-ink/00-阅读导航.md",
    `# NoteSpace：阅读导航

> 像 Typora 一样写作，像浏览器一样穿行于本地文档。

## 今天的阅读顺序

1. 先读 [产品设计](01-产品设计.md)，了解单画布编辑和 Paper & Ink 风格。
2. 再读 [浏览器式导航](guide/02-浏览器式导航.md)，体验 Tab、前进和后退。
3. 最后查看下面的 Mermaid 图，后续可进入沉浸查看器。

## 文档地图

- [产品设计](01-产品设计.md)
- [浏览器式导航](guide/02-浏览器式导航.md)

本地代码示例：\`example.py:2\`

\`\`\`mermaid
flowchart LR
  A[工作区] --> B[Tab]
  B --> C[文档历史]
  C --> D[返回阅读位置]
\`\`\`
`,
  ],
  [
    "demo://paper-and-ink/01-产品设计.md",
    `# 产品设计

## 单画布编辑

Markdown 文件是持久化真相。默认直接在排版结果中编辑，标题、列表和表格不会因为光标经过就变回 Markdown 源码。需要精确处理语法时，使用顶部“源码”按钮明确切换。

| 能力 | 第一版 |
| --- | --- |
| 截图粘贴 | 写入 assets 后插相对链接 |
| 大文件 | 普通多行 source-only |
| Base64 误粘贴 | 进入编辑器前阻止 |

\`\`\`python
def save_markdown(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8")
\`\`\`

[返回阅读导航](00-阅读导航.md)
`,
  ],
  [
    "demo://paper-and-ink/guide/02-浏览器式导航.md",
    `# 浏览器式导航

普通点击在当前 Tab 打开，后退会回到原来的阅读位置。修饰键点击可以打开新 Tab。

## 状态分离

- DocumentSession：共享正文和 dirty 状态。
- Tab：一次独立浏览会话。
- HistoryEntry：文档、锚点、滚动和选择。

[返回阅读导航](00-阅读导航.md)
`,
  ],
  [
    "demo://paper-and-ink/example.py",
    `from pathlib import Path

def workspace_name(path: str) -> str:
    return Path(path).name
`,
  ],
]);

const demoTree: readonly WorkspaceNode[] = [
  {
    kind: "text",
    name: "example.py",
    path: "demo://paper-and-ink/example.py",
    relativePath: "example.py",
  },
  {
    kind: "markdown",
    name: "00-阅读导航.md",
    path: "demo://paper-and-ink/00-阅读导航.md",
    relativePath: "00-阅读导航.md",
  },
  {
    kind: "markdown",
    name: "01-产品设计.md",
    path: "demo://paper-and-ink/01-产品设计.md",
    relativePath: "01-产品设计.md",
  },
  {
    kind: "directory",
    name: "guide",
    path: "demo://paper-and-ink/guide",
    relativePath: "guide",
    children: [
      {
        kind: "markdown",
        name: "02-浏览器式导航.md",
        path: "demo://paper-and-ink/guide/02-浏览器式导航.md",
        relativePath: "guide/02-浏览器式导航.md",
      },
    ],
  },
];

export class DemoDesktopAdapter implements DesktopAdapter {
  readonly kind = "demo" as const;
  private readonly documents = new Map(demoDocuments);
  private tree: readonly WorkspaceNode[] = demoTree;

  searchWorkspaces: WorkspaceSearch = async (workspaces, query, caseSensitive) => {
    const matches: WorkspaceSearchMatch[] = [];
    let searchedFiles = 0;
    const seen = new Set<string>();
    if (!query.trim())
      return {
        matches,
        searchedFiles,
        skippedFiles: 0,
        unavailableRoots: [],
        truncated: false,
      };
    const needle = caseSensitive ? query : query.toLowerCase();
    for (const root of workspaces) {
      const visit = (nodes: readonly WorkspaceNode[]) => {
        for (const node of nodes) {
          if (node.children) visit(node.children);
          if (node.kind === "directory" || seen.has(node.path)) continue;
          seen.add(node.path);
          const text = this.documents.get(node.path);
          if (text === undefined) continue;
          searchedFiles++;
          for (const [line, snippet] of text.split("\n").entries()) {
            const column = (caseSensitive ? snippet : snippet.toLowerCase()).indexOf(
              needle,
            );
            if (column >= 0)
              matches.push({
                path: node.path,
                relativePath: node.relativePath,
                rootPath: root.path,
                line: line + 1,
                column: column + 1,
                snippet,
              });
          }
        }
      };
      visit(await this.listWorkspace(root.path, root.showHidden));
    }
    return {
      matches: matches.slice(0, 200),
      searchedFiles,
      skippedFiles: 0,
      unavailableRoots: [],
      truncated: matches.length > 200,
    };
  };

  async pickWorkspace(): Promise<WorkspaceSelection> {
    return { path: "demo://paper-and-ink", name: "Paper & Ink 示例" };
  }

  async pickDocument(): Promise<DocumentSelection> {
    return { path: "demo://paper-and-ink/example.py", name: "example.py" };
  }

  async listWorkspace(
    rootPath: string,
    showHidden = false,
  ): Promise<readonly WorkspaceNode[]> {
    void rootPath;
    if (showHidden) return this.tree;
    const visible = (nodes: readonly WorkspaceNode[]): readonly WorkspaceNode[] =>
      nodes
        .filter((node) => !node.name.startsWith("."))
        .map((node) =>
          node.kind === "directory"
            ? { ...node, children: visible(node.children ?? []) }
            : node,
        );
    return visible(this.tree);
  }

  async openDocument(path: string): Promise<OpenDocumentResult> {
    const content = this.documents.get(path);
    if (content === undefined) throw new Error("示例文档不存在");
    const isMarkdown = /\.(?:md|markdown)$/iu.test(path);
    return {
      status: "editable",
      path,
      content,
      mode: "normal",
      documentKind: isMarkdown ? "markdown" : "text",
      language: isMarkdown ? "markdown" : path.endsWith(".py") ? "python" : "text",
      preflight: {
        sizeBytes: new TextEncoder().encode(content).byteLength,
        longestLineBytes: Math.max(...content.split("\n").map((line) => line.length)),
        containsDataImageBase64: false,
      },
    };
  }

  async openExternalUrl(url: string): Promise<void> {
    const parsed = new URL(url);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      !parsed.hostname ||
      [...url].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || (code >= 127 && code <= 159);
      })
    ) {
      throw new Error("Only HTTP and HTTPS browser links are supported");
    }
    window.open(parsed.href, "_blank", "noopener,noreferrer");
  }

  async revealInFileManager(path: string): Promise<void> {
    void path;
    throw new Error("浏览器演示模式不能打开系统文件管理器，请启动桌面应用。");
  }

  async moveWorkspaceEntryToTrash(workspaceRoot: string, path: string): Promise<void> {
    void workspaceRoot;
    void path;
    throw new Error("浏览器演示模式不能把文件移到系统废纸篓，请启动桌面应用。");
  }

  async createWorkspaceTextFile(
    workspaceRoot: string,
    directoryPath: string,
    fileName: string,
  ): Promise<OpenDocumentResult> {
    this.validateCreationDirectory(workspaceRoot, directoryPath);
    if (
      !fileName.trim() ||
      fileName === "." ||
      fileName === ".." ||
      /[/\\\0]/u.test(fileName)
    ) {
      throw new Error("文件名必须是单个非空名称");
    }

    const path = `${directoryPath}/${fileName}`;
    if (this.documents.has(path) || this.findNode(path)) {
      throw new Error("目标文件已经存在");
    }
    this.documents.set(path, "");
    this.appendNode(directoryPath, {
      kind: /\.(?:md|markdown)$/iu.test(fileName) ? "markdown" : "text",
      name: fileName,
      path,
      relativePath: path.slice(workspaceRoot.length + 1),
    });
    return this.openDocument(path);
  }

  async createWorkspaceFolder(
    workspaceRoot: string,
    directoryPath: string,
    folderName: string,
  ): Promise<void> {
    this.validateCreationDirectory(workspaceRoot, directoryPath);
    if (
      !folderName.trim() ||
      folderName === "." ||
      folderName === ".." ||
      /[/\\\0]/u.test(folderName)
    ) {
      throw new Error("文件夹名称必须是单个非空名称");
    }
    const path = `${directoryPath}/${folderName}`;
    if (this.documents.has(path) || this.findNode(path)) {
      throw new Error("同名文件或文件夹已经存在");
    }
    this.appendNode(directoryPath, {
      kind: "directory",
      name: folderName,
      path,
      relativePath: path.slice(workspaceRoot.length + 1),
      children: [],
    });
  }

  private findNode(path: string, nodes = this.tree): WorkspaceNode | undefined {
    for (const node of nodes) {
      if (node.path === path) return node;
      const child = node.children && this.findNode(path, node.children);
      if (child) return child;
    }
    return undefined;
  }

  private validateCreationDirectory(workspaceRoot: string, directoryPath: string) {
    if (workspaceRoot !== "demo://paper-and-ink") {
      throw new Error("示例工作区不存在");
    }
    if (
      directoryPath !== workspaceRoot &&
      this.findNode(directoryPath)?.kind !== "directory"
    ) {
      throw new Error("目标必须是示例工作区内已有的文件夹");
    }
  }

  private appendNode(directoryPath: string, entry: WorkspaceNode) {
    if (directoryPath === "demo://paper-and-ink") {
      this.tree = [...this.tree, entry];
      return;
    }
    const appendToDirectory = (nodes: readonly WorkspaceNode[]): readonly WorkspaceNode[] =>
      nodes.map((node) => {
        if (node.path === directoryPath) {
          return { ...node, children: [...(node.children ?? []), entry] };
        }
        return node.children
          ? { ...node, children: appendToDirectory(node.children) }
          : node;
      });
    this.tree = appendToDirectory(this.tree);
  }

  async saveDocument(path: string, content: string): Promise<SaveDocumentResult> {
    this.documents.set(path, content);
    return { path, bytesWritten: new TextEncoder().encode(content).byteLength };
  }

  async saveDocumentAs(
    suggestedFileName: string,
    content: string,
    excludedPaths: readonly string[],
  ): Promise<SaveDocumentResult> {
    const path = `demo://paper-and-ink/${suggestedFileName}`;
    if (excludedPaths.includes(path)) {
      throw new Error("target file is already open in another document session");
    }
    this.documents.set(path, content);
    return { path, bytesWritten: new TextEncoder().encode(content).byteLength };
  }

  async previewLocalFile(
    reference: string,
    documentPath: string,
  ): Promise<LocalFilePreview> {
    void documentPath;
    const targetLineText = /:(\d+)$/u.exec(reference)?.[1];
    const targetLine = targetLineText ? Number.parseInt(targetLineText, 10) : undefined;
    const normalizedReference = reference.replace(/^\.\//u, "").replace(/:\d+$/u, "");
    const candidate = [...this.documents.entries()].find(([path]) =>
      path.endsWith(normalizedReference),
    );
    if (!candidate) throw new Error("示例工作区中没有这个本地文件");
    const lines = candidate[1].split("\n");
    const startLine = targetLine ? Math.max(1, targetLine - 20) : 1;
    const endLine = targetLine ? targetLine + 20 : 80;
    return {
      path: candidate[0],
      language: candidate[0].endsWith(".py") ? "python" : "markdown",
      targetLine,
      startLine,
      content: lines.slice(startLine - 1, endLine).join("\n"),
    };
  }

  async pickImageDirectory(): Promise<string | null> {
    throw { code: "desktopOnly" };
  }

  async saveClipboardImage(
    documentPath: string,
    directoryPath?: string,
  ): Promise<SavedClipboardImage> {
    void documentPath;
    void directoryPath;
    throw { code: "desktopOnly" };
  }

  async setNativeMenuLocale(): Promise<void> {
    // Browser/demo mode has no operating-system menu.
  }

  async listenNativeMenuAction(): Promise<() => void> {
    return () => undefined;
  }
}

export function isTauriRuntime(scope: unknown = globalThis): boolean {
  return typeof scope === "object" && scope !== null && "__TAURI_INTERNALS__" in scope;
}

export function createDesktopAdapter(): DesktopAdapter {
  return isTauriRuntime() ? new TauriDesktopAdapter() : new DemoDesktopAdapter();
}
