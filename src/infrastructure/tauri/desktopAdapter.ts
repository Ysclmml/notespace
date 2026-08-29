import { invoke } from "@tauri-apps/api/core";

export interface WorkspaceSelection {
  readonly path: string;
  readonly name: string;
}

export type WorkspaceNodeKind = "directory" | "markdown";

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
  readonly preflight: DocumentPreflight;
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
}

export interface SavedClipboardImage {
  readonly path: string;
  readonly markdownUri: string;
  readonly width: number;
  readonly height: number;
}

export interface DesktopAdapter {
  readonly kind: "tauri" | "demo";
  pickWorkspace(): Promise<WorkspaceSelection | null>;
  listWorkspace(rootPath: string): Promise<readonly WorkspaceNode[]>;
  openDocument(path: string): Promise<OpenDocumentResult>;
  saveDocument(path: string, content: string): Promise<SaveDocumentResult>;
  saveClipboardImage(documentPath: string): Promise<SavedClipboardImage>;
}

export class TauriDesktopAdapter implements DesktopAdapter {
  readonly kind = "tauri" as const;

  pickWorkspace() {
    return invoke<WorkspaceSelection | null>("pick_workspace");
  }

  listWorkspace(rootPath: string) {
    return invoke<WorkspaceNode[]>("list_workspace", { rootPath });
  }

  openDocument(path: string) {
    return invoke<OpenDocumentResult>("open_document", { path });
  }

  saveDocument(path: string, content: string) {
    return invoke<SaveDocumentResult>("save_document", { path, content });
  }

  saveClipboardImage(documentPath: string) {
    return invoke<SavedClipboardImage>("save_clipboard_image", { documentPath });
  }
}

const demoDocuments = new Map<string, string>([
  [
    "demo://paper-and-ink/00-阅读导航.md",
    `# Markdown Workspace：阅读导航

> 像 Typora 一样写作，像浏览器一样穿行于本地文档。

## 今天的阅读顺序

1. 先读 [产品设计](01-产品设计.md)，了解单画布编辑和 Paper & Ink 风格。
2. 再读 [浏览器式导航](02-浏览器式导航.md)，体验 Tab、前进和后退。
3. 最后查看下面的 Mermaid 图，后续可进入沉浸查看器。

## 文档地图

- [产品设计](01-产品设计.md)
- [浏览器式导航](02-浏览器式导航.md)

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

Markdown 源码是唯一真相。光标所在区域显示语法，其他区域保持阅读感。

| 能力 | 第一版 |
| --- | --- |
| 截图粘贴 | 写入 assets 后插相对链接 |
| 大文件 | 普通多行 source-only |
| Base64 误粘贴 | 进入编辑器前阻止 |

[返回阅读导航](00-阅读导航.md)
`,
  ],
  [
    "demo://paper-and-ink/02-浏览器式导航.md",
    `# 浏览器式导航

普通点击在当前 Tab 打开，后退会回到原来的阅读位置。修饰键点击可以打开新 Tab。

## 状态分离

- DocumentSession：共享正文和 dirty 状态。
- Tab：一次独立浏览会话。
- HistoryEntry：文档、锚点、滚动和选择。

[返回阅读导航](00-阅读导航.md)
`,
  ],
]);

const demoTree: readonly WorkspaceNode[] = [
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
        path: "demo://paper-and-ink/02-浏览器式导航.md",
        relativePath: "guide/02-浏览器式导航.md",
      },
    ],
  },
];

export class DemoDesktopAdapter implements DesktopAdapter {
  readonly kind = "demo" as const;

  async pickWorkspace(): Promise<WorkspaceSelection> {
    return { path: "demo://paper-and-ink", name: "Paper & Ink 示例" };
  }

  async listWorkspace(rootPath: string): Promise<readonly WorkspaceNode[]> {
    void rootPath;
    return demoTree;
  }

  async openDocument(path: string): Promise<OpenDocumentResult> {
    const content = demoDocuments.get(path);
    if (content === undefined) throw new Error("示例文档不存在");
    return {
      status: "editable",
      path,
      content,
      mode: "normal",
      preflight: {
        sizeBytes: new TextEncoder().encode(content).byteLength,
        longestLineBytes: Math.max(...content.split("\n").map((line) => line.length)),
        containsDataImageBase64: false,
      },
    };
  }

  async saveDocument(path: string, content: string): Promise<SaveDocumentResult> {
    demoDocuments.set(path, content);
    return { path, bytesWritten: new TextEncoder().encode(content).byteLength };
  }

  async saveClipboardImage(documentPath: string): Promise<SavedClipboardImage> {
    void documentPath;
    throw new Error("浏览器演示模式不能写入系统剪贴板图片，请启动桌面应用。");
  }
}

export function isTauriRuntime(scope: unknown = globalThis): boolean {
  return typeof scope === "object" && scope !== null && "__TAURI_INTERNALS__" in scope;
}

export function createDesktopAdapter(): DesktopAdapter {
  return isTauriRuntime() ? new TauriDesktopAdapter() : new DemoDesktopAdapter();
}
