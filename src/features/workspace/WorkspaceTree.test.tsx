import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppSettingsProvider } from "../../app/settings";
import type { WorkspaceNode } from "../../infrastructure/tauri/desktopAdapter";
import {
  WorkspaceTree,
  type WorkspaceTreeActionLabels,
  type WorkspaceTreeProps,
} from "./WorkspaceTree";
import { normalizeWorkspaceFileName } from "./workspaceFileName";

const nodes: readonly WorkspaceNode[] = [
  {
    kind: "directory",
    name: "docs",
    path: "/workspace/docs",
    relativePath: "docs",
    children: [
      {
        kind: "markdown",
        name: "guide.md",
        path: "/workspace/docs/guide.md",
        relativePath: "docs/guide.md",
      },
    ],
  },
];

const nestedNodes: readonly WorkspaceNode[] = [
  {
    kind: "directory",
    name: "docs",
    path: "/workspace/docs",
    relativePath: "docs",
    children: [
      ...(nodes[0]?.children ?? []),
      {
        kind: "directory",
        name: "projects",
        path: "/workspace/docs/projects",
        relativePath: "docs/projects",
        children: [
          {
            kind: "directory",
            name: "specs",
            path: "/workspace/docs/projects/specs",
            relativePath: "docs/projects/specs",
            children: [
              {
                kind: "text",
                name: "worker.py",
                path: "/workspace/docs/projects/specs/worker.py",
                relativePath: "docs/projects/specs/worker.py",
              },
            ],
          },
        ],
      },
      {
        kind: "directory",
        name: "reference",
        path: "/workspace/docs/reference",
        relativePath: "docs/reference",
        children: [],
      },
    ],
  },
];

const guidePath = "/workspace/docs/guide.md";
const nestedPath = "/workspace/docs/projects/specs/worker.py";

function selectionTree(activePath?: string, treeNodes = nestedNodes) {
  return (
    <AppSettingsProvider initialSettings={{ locale: "zh-CN" }} storage={null}>
      <WorkspaceTree
        activePath={activePath}
        nodes={treeNodes}
        onOpen={() => undefined}
        rootName="Workspace"
        rootPath="/workspace"
      />
    </AppSettingsProvider>
  );
}

const actionLabels: WorkspaceTreeActionLabels = {
  collapseWorkspace: "折叠工作区",
  expandWorkspace: "展开工作区",
  closeWorkspace: "关闭工作区",
  copyPath: "复制路径",
  deleteItem: "删除",
};

function renderTree(
  onCreateFile = vi.fn(async () => undefined),
  onReveal = vi.fn(async () => undefined),
  locale: "zh-CN" | "en-US" = "zh-CN",
  overrides: Partial<WorkspaceTreeProps> = {},
) {
  const onOpen = overrides.onOpen ?? vi.fn();
  return {
    onCreateFile,
    onOpen,
    onReveal,
    ...render(
      <AppSettingsProvider initialSettings={{ locale }} storage={null}>
        <WorkspaceTree
          nodes={nodes}
          onCreateFile={onCreateFile}
          onOpen={onOpen}
          onReveal={onReveal}
          rootPath="/workspace"
          {...overrides}
        />
      </AppSettingsProvider>,
    ),
  };
}

describe("WorkspaceTree", () => {
  afterEach(() => vi.restoreAllMocks());

  it("offers add/remove favorite only for files without opening or removing the file", () => {
    const onToggleFavorite = vi.fn();
    const onOpen = vi.fn();
    const view = (favoritePaths: readonly string[] = []) => (
      <AppSettingsProvider initialSettings={{ locale: "zh-CN" }} storage={null}>
        <WorkspaceTree
          nodes={nodes}
          rootPath="/workspace"
          rootName="Workspace"
          onOpen={onOpen}
          favoritePaths={favoritePaths}
          onToggleFavorite={onToggleFavorite}
        />
      </AppSettingsProvider>
    );
    const { container, rerender } = render(view());
    const file = screen.getByRole("button", { name: "guide.md" });
    fireEvent.contextMenu(file);
    fireEvent.click(screen.getByRole("menuitem", { name: "添加到收藏" }));
    expect(onToggleFavorite).toHaveBeenCalledExactlyOnceWith(guidePath);
    expect(onOpen).not.toHaveBeenCalled();
    rerender(view([guidePath]));
    fireEvent.contextMenu(file);
    expect(screen.queryByRole("menuitem", { name: "添加到收藏" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "取消收藏" }));
    expect(onToggleFavorite).toHaveBeenCalledTimes(2);
    expect(onToggleFavorite).toHaveBeenLastCalledWith(guidePath);

    for (const target of [
      screen.getByRole("button", { name: "docs" }),
      screen.getByRole("button", { name: "折叠工作区 · Workspace" }),
      container.querySelector(".workspace-tree-shell")!,
    ]) {
      fireEvent.contextMenu(target);
      expect(
        screen.queryByRole("menuitem", { name: "添加到收藏" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "取消收藏" })).not.toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
    }
  });

  it("offers a localized favorite action for code files and omits it when not wired", () => {
    const onToggleFavorite = vi.fn();
    const code: WorkspaceNode = {
      kind: "text",
      name: "worker.py",
      path: "C:\\Notes\\worker.py",
      relativePath: "worker.py",
    };
    const view = (enabled: boolean) => (
      <AppSettingsProvider initialSettings={{ locale: "en-US" }} storage={null}>
        <WorkspaceTree
          nodes={[code]}
          rootPath="C:\\Notes"
          onOpen={vi.fn()}
          favoritePaths={["c:/notes/WORKER.py"]}
          onToggleFavorite={enabled ? onToggleFavorite : undefined}
        />
      </AppSettingsProvider>
    );
    const { rerender } = render(view(true));
    fireEvent.contextMenu(screen.getByRole("button", { name: "worker.py" }));
    const action = screen.getByRole("menuitem", { name: "Remove favorite" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "End" });
    expect(action).toHaveFocus();
    fireEvent.click(action);
    expect(onToggleFavorite).toHaveBeenCalledExactlyOnceWith(code.path);
    rerender(view(false));
    fireEvent.contextMenu(screen.getByRole("button", { name: "worker.py" }));
    expect(screen.queryByRole("menuitem", { name: /favorite/i })).not.toBeInTheDocument();
  });

  it("filters hidden entries recursively and reveals their active document when enabled", () => {
    const hiddenPath = "/workspace/docs/.drafts/draft.md";
    const hiddenNodes: readonly WorkspaceNode[] = [
      {
        kind: "markdown",
        name: ".root.md",
        path: "/workspace/.root.md",
        relativePath: ".root.md",
      },
      {
        ...nodes[0]!,
        children: [
          ...nodes[0]!.children!,
          {
            kind: "markdown",
            name: ".notes.md",
            path: "/workspace/docs/.notes.md",
            relativePath: "docs/.notes.md",
          },
          {
            kind: "directory",
            name: ".drafts",
            path: "/workspace/docs/.drafts",
            relativePath: "docs/.drafts",
            children: [
              {
                kind: "markdown",
                name: "draft.md",
                path: hiddenPath,
                relativePath: "docs/.drafts/draft.md",
              },
            ],
          },
        ],
      },
    ];
    const view = (showHidden?: boolean) => (
      <AppSettingsProvider initialSettings={{ locale: "zh-CN" }} storage={null}>
        <WorkspaceTree
          activePath={hiddenPath}
          nodes={hiddenNodes}
          onOpen={vi.fn()}
          rootName="Workspace"
          rootPath="/workspace"
          showHidden={showHidden}
        />
      </AppSettingsProvider>
    );
    const { rerender } = render(view());
    expect(screen.getByRole("button", { name: "guide.md" })).toBeVisible();
    for (const name of [".root.md", ".notes.md", ".drafts", "draft.md"])
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();

    rerender(view(true));
    for (const name of [".root.md", ".notes.md", ".drafts"])
      expect(screen.getByRole("button", { name })).toBeVisible();
    expect(screen.getByRole("button", { name: "draft.md" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(screen.getByRole("button", { name: ".drafts" }));
    rerender(view(false));
    expect(screen.queryByRole("button", { name: ".drafts" })).not.toBeInTheDocument();
    rerender(view(true));
    expect(screen.getByRole("button", { name: "draft.md" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("offers the checked hidden-entry preference only for the workspace root and blank area", () => {
    const onShowHiddenChange = vi.fn();
    const view = (showHidden: boolean) => (
      <AppSettingsProvider initialSettings={{ locale: "zh-CN" }} storage={null}>
        <WorkspaceTree
          nodes={nodes}
          onOpen={vi.fn()}
          onShowHiddenChange={onShowHiddenChange}
          rootName="Workspace"
          rootPath="/workspace"
          showHidden={showHidden}
        />
      </AppSettingsProvider>
    );
    const { container, rerender } = render(view(false));
    const root = screen.getByRole("button", { name: "折叠工作区 · Workspace" });
    expect(root.querySelector(".workspace-tree__workspace-icon")).toBeInTheDocument();
    expect(within(root).getByText("工作区")).toBeInTheDocument();
    expect(root).toHaveAttribute("aria-expanded", "true");
    fireEvent.contextMenu(root);
    const checkbox = screen.getByRole("menuitemcheckbox", { name: "显示隐藏文件和文件夹" });
    expect(checkbox).toHaveAttribute("aria-checked", "false");
    fireEvent.click(checkbox);
    expect(onShowHiddenChange).toHaveBeenLastCalledWith("/workspace", true);

    rerender(view(true));
    fireEvent.contextMenu(container.querySelector(".workspace-tree")!);
    const checked = screen.getByRole("menuitemcheckbox", { name: "显示隐藏文件和文件夹" });
    expect(checked).toHaveAttribute("aria-checked", "true");
    expect(checked.querySelector(".workspace-tree__menu-check")).toHaveTextContent("✓");
    fireEvent.click(checked);
    expect(onShowHiddenChange).toHaveBeenLastCalledWith("/workspace", false);

    fireEvent.contextMenu(screen.getByRole("button", { name: "docs" }));
    expect(screen.queryByRole("menuitemcheckbox")).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(root);
    expect(screen.getByRole("button", { name: "展开工作区 · Workspace" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it.each([
    ["zh-CN", "图片保存位置…", "折叠工作区"],
    ["en-US", "Image Save Location…", "Collapse Workspace"],
  ] as const)(
    "opens localized image settings for the exact root or its blank area in %s",
    (locale, label, collapseLabel) => {
      const onImageSettings = vi.fn();
      const onOpen = vi.fn();
      const onActivateWorkspace = vi.fn();
      const { container } = render(
        <AppSettingsProvider initialSettings={{ locale }} storage={null}>
          <WorkspaceTree
            nodes={nodes}
            onActivateWorkspace={onActivateWorkspace}
            onImageSettings={onImageSettings}
            onOpen={onOpen}
            rootName="First"
            rootPath="/workspace"
          />
          <WorkspaceTree
            nodes={[]}
            onActivateWorkspace={onActivateWorkspace}
            onImageSettings={onImageSettings}
            onOpen={onOpen}
            rootName="Second"
            rootPath="/second"
          />
        </AppSettingsProvider>,
      );
      fireEvent.contextMenu(
        screen.getByRole("button", { name: `${collapseLabel} · First` }),
        { clientX: 24, clientY: 40 },
      );
      expect(onImageSettings).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("menuitem", { name: label }));
      expect(onImageSettings).toHaveBeenLastCalledWith("/workspace");
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();

      const secondBlankArea = container.querySelectorAll(".workspace-tree")[1]!;
      fireEvent.contextMenu(secondBlankArea, { clientX: 24, clientY: 140 });
      fireEvent.click(screen.getByRole("menuitem", { name: label }));
      expect(onImageSettings).toHaveBeenLastCalledWith("/second");
      expect(onImageSettings).toHaveBeenCalledTimes(2);
      expect(onOpen).not.toHaveBeenCalled();
      expect(onActivateWorkspace).not.toHaveBeenCalled();
    },
  );

  it("never offers workspace image settings for a child file or folder", () => {
    const onImageSettings = vi.fn();
    const { onOpen } = renderTree(undefined, undefined, "zh-CN", {
      onImageSettings,
      rootName: "Workspace",
    });
    for (const name of ["docs", "guide.md"]) {
      fireEvent.contextMenu(screen.getByRole("button", { name }), {
        clientX: 24,
        clientY: 80,
      });
      expect(
        screen.queryByRole("menuitem", { name: "图片保存位置…" }),
      ).not.toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
    }
    expect(onImageSettings).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("omits the image setting entry when no handler exists and supports root blank-area requests", () => {
    const { container, rerender } = renderTree();
    fireEvent.contextMenu(container.querySelector(".workspace-tree-shell")!, {
      clientX: 24,
      clientY: 140,
    });
    expect(
      screen.queryByRole("menuitem", { name: "图片保存位置…" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    const onImageSettings = vi.fn();
    rerender(
      <AppSettingsProvider initialSettings={{ locale: "zh-CN" }} storage={null}>
        <WorkspaceTree
          contextMenuRequest={{ x: 24, y: 300, id: 1 }}
          nodes={nodes}
          onImageSettings={onImageSettings}
          onOpen={vi.fn()}
          rootPath="/workspace"
        />
      </AppSettingsProvider>,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "图片保存位置…" }));
    expect(onImageSettings).toHaveBeenCalledExactlyOnceWith("/workspace");
  });

  it("defaults extensionless names to Markdown and preserves explicit suffixes", () => {
    expect(normalizeWorkspaceFileName("notes")).toBe("notes.md");
    expect(normalizeWorkspaceFileName("worker.py")).toBe("worker.py");
    expect(normalizeWorkspaceFileName(".env")).toBe(".env");
  });

  it("emits a permanent open on a file double-click without opening a second tab", () => {
    const onOpenPermanent = vi.fn();
    const onOpenInNewTab = vi.fn();
    const { onOpen } = renderTree(undefined, undefined, "zh-CN", {
      onOpenPermanent,
      onOpenInNewTab,
    });
    const file = screen.getByRole("button", { name: "guide.md" });
    fireEvent.click(file);
    fireEvent.click(file, { detail: 2 });
    fireEvent.doubleClick(file);
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpenPermanent).toHaveBeenCalledExactlyOnceWith(guidePath);
    expect(onOpenInNewTab).not.toHaveBeenCalled();
    fireEvent.doubleClick(file, { ctrlKey: true });
    fireEvent.doubleClick(file, { button: 2 });
    expect(onOpenPermanent).toHaveBeenCalledTimes(1);
  });

  it("reveals the active file through collapsed roots and ancestors on navigation", () => {
    const { rerender } = render(selectionTree(guidePath));
    expect(screen.getByRole("button", { name: "guide.md" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(screen.getByRole("button", { name: "docs" }));
    fireEvent.click(screen.getByRole("button", { name: "折叠工作区 · Workspace" }));

    rerender(selectionTree(nestedPath));

    expect(screen.getByRole("button", { name: "折叠工作区 · Workspace" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    for (const name of ["docs", "projects", "specs"])
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "worker.py" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "guide.md" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("button", { name: "reference" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("preserves manual folder and root folds through same-path updates and tree refreshes", () => {
    const { rerender } = render(selectionTree(nestedPath));
    fireEvent.click(screen.getByRole("button", { name: "specs" }));
    rerender(selectionTree(nestedPath, structuredClone(nestedNodes)));
    expect(screen.queryByRole("button", { name: "worker.py" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "折叠工作区 · Workspace" }));
    rerender(selectionTree(nestedPath, structuredClone(nestedNodes)));
    expect(screen.getByRole("button", { name: "展开工作区 · Workspace" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "展开工作区 · Workspace" }));
    expect(screen.getByRole("button", { name: "specs" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("button", { name: "worker.py" })).not.toBeInTheDocument();

    rerender(selectionTree(guidePath));
    rerender(selectionTree(nestedPath));
    expect(screen.getByRole("button", { name: "worker.py" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("reveals a pending active file once its tree arrives but ignores nonmember paths", () => {
    const { container, rerender } = render(selectionTree(nestedPath, []));
    fireEvent.click(screen.getByRole("button", { name: "折叠工作区 · Workspace" }));
    rerender(selectionTree(nestedPath));
    expect(screen.getByRole("button", { name: "worker.py" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.click(screen.getByRole("button", { name: "折叠工作区 · Workspace" }));
    for (const path of ["/standalone/worker.py", "/workspace/missing.md", undefined]) {
      rerender(selectionTree(path));
      expect(
        screen.getByRole("button", { name: "展开工作区 · Workspace" }),
      ).toHaveAttribute("aria-expanded", "false");
      expect(container.querySelector('[aria-current="page"]')).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "展开工作区 · Workspace" }));
    expect(container.querySelector('[aria-current="page"]')).not.toBeInTheDocument();
  });

  it("keeps another workspace's manual folds when an active document changes roots", () => {
    const twoRoots = (activePath: string) => (
      <AppSettingsProvider initialSettings={{ locale: "zh-CN" }} storage={null}>
        <WorkspaceTree
          activePath={activePath}
          nodes={nestedNodes}
          onOpen={() => undefined}
          rootName="Workspace"
          rootPath="/workspace"
        />
        <WorkspaceTree
          activePath={activePath}
          nodes={[
            {
              kind: "markdown",
              name: "other.md",
              path: "/other/other.md",
              relativePath: "other.md",
            },
          ]}
          onOpen={() => undefined}
          rootName="Other"
          rootPath="/other"
        />
      </AppSettingsProvider>
    );
    const { rerender } = render(twoRoots(guidePath));
    fireEvent.click(screen.getByRole("button", { name: "docs" }));
    fireEvent.click(screen.getByRole("button", { name: "折叠工作区 · Workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "折叠工作区 · Other" }));

    rerender(twoRoots("/other/other.md"));

    expect(screen.getByRole("button", { name: "other.md" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "展开工作区 · Workspace" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "展开工作区 · Workspace" }));
    expect(screen.getByRole("button", { name: "docs" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("only scrolls the sidebar by the distance needed to reveal a newly active row", () => {
    let rowTop = 450;
    const bounds = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains("sidebar__body")) return new DOMRect(0, 100, 250, 300);
      if (this.getAttribute("aria-current") === "page")
        return new DOMRect(0, rowTop, 240, 30);
      return bounds.call(this);
    });
    const view = (activePath?: string, treeNodes = nestedNodes) => (
      <div data-testid="outer-scroll">
        <textarea aria-label="Editor" />
        <div className="sidebar__body">{selectionTree(activePath, treeNodes)}</div>
      </div>
    );
    const { container, rerender } = render(view());
    const scroller = container.querySelector(".sidebar__body") as HTMLElement;
    const outer = screen.getByTestId("outer-scroll");
    Object.defineProperty(scroller, "clientHeight", { value: 300 });
    scroller.scrollTop = 200;
    outer.scrollTop = 75;
    screen.getByRole("textbox", { name: "Editor" }).focus();

    rerender(view(guidePath));
    expect(scroller.scrollTop).toBe(280);

    rowTop = 160;
    rerender(view(nestedPath));
    expect(scroller.scrollTop).toBe(280);

    rowTop = 50;
    rerender(view(guidePath));
    expect(scroller.scrollTop).toBe(230);

    rowTop = 800;
    rerender(view(guidePath, structuredClone(nestedNodes)));
    expect(scroller.scrollTop).toBe(230);
    expect(outer.scrollTop).toBe(75);
    expect(screen.getByRole("textbox", { name: "Editor" })).toHaveFocus();
  });

  it("creates files at the root and exposes localized reveal actions", async () => {
    const { onCreateFile, onReveal, container } = renderTree();
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建文件" })).not.toBeInTheDocument();
    fireEvent.contextMenu(container.querySelector(".workspace-tree-shell") as HTMLElement, {
      clientX: 24,
      clientY: 40,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "新建文件" }));
    const input = screen.getByRole("textbox", { name: "文件名" });
    fireEvent.change(input, { target: { value: "readme" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(onCreateFile).toHaveBeenCalledWith("/workspace", "readme.md"),
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /guide\.md/ }), {
      clientX: 24,
      clientY: 40,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "在文件管理器中显示" }));
    expect(onReveal).toHaveBeenCalledWith("/workspace/docs/guide.md");
  });

  it("creates inside a folder from its context menu", async () => {
    const { onCreateFile } = renderTree();
    fireEvent.contextMenu(screen.getByRole("button", { name: "docs" }), {
      clientX: 24,
      clientY: 40,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "新建文件" }));
    const input = screen.getByRole("textbox", { name: "文件名" });
    fireEvent.change(input, { target: { value: "script.ts" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(onCreateFile).toHaveBeenCalledWith("/workspace/docs", "script.ts"),
    );
  });

  it("localizes root, folder, and file actions in English", () => {
    renderTree(undefined, undefined, "en-US", {
      onCreateFolder: vi.fn(async () => undefined),
      onCopyPath: vi.fn(),
      onOpenInNewTab: vi.fn(),
      onQuickOpen: vi.fn(),
    });

    expect(screen.getByRole("list", { name: "Workspace Files" })).toBeVisible();
    fireEvent.contextMenu(screen.getByRole("button", { name: /guide\.md/ }), {
      clientX: 24,
      clientY: 40,
    });
    for (const name of [
      "Open",
      "Open in New Tab",
      "New File",
      "New Folder",
      "Find File…",
      "Copy Path",
      "Show in File Manager",
    ]) {
      expect(screen.getByRole("menuitem", { name })).toBeVisible();
    }
  });

  it("collapses each workspace root independently and activates it on click", () => {
    const onActivateWorkspace = vi.fn();
    renderTree(undefined, undefined, "zh-CN", {
      actionLabels,
      onActivateWorkspace,
      rootActive: true,
      rootName: "示例工作区",
    });

    expect(screen.getByRole("button", { name: /guide\.md/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "折叠工作区 · 示例工作区" }));

    expect(onActivateWorkspace).toHaveBeenCalledWith("/workspace");
    expect(screen.queryByRole("button", { name: /guide\.md/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开工作区 · 示例工作区" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "展开工作区 · 示例工作区" }));
    expect(screen.getByRole("button", { name: /guide\.md/ })).toBeVisible();
  });

  it("offers copy and close for a workspace root without offering delete", () => {
    const onCloseWorkspace = vi.fn();
    const onCopyPath = vi.fn();
    renderTree(undefined, undefined, "zh-CN", {
      actionLabels,
      onCloseWorkspace,
      onCopyPath,
      rootName: "示例工作区",
    });

    const root = screen.getByRole("button", { name: "折叠工作区 · 示例工作区" });
    fireEvent.contextMenu(root, { clientX: 24, clientY: 40 });
    expect(screen.queryByRole("menuitem", { name: "删除" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "复制路径" }));
    expect(onCopyPath).toHaveBeenCalledWith("/workspace");

    fireEvent.contextMenu(root, { clientX: 24, clientY: 40 });
    fireEvent.click(screen.getByRole("menuitem", { name: "关闭工作区" }));
    expect(onCloseWorkspace).toHaveBeenCalledWith("/workspace");
  });

  it("offers copy and delete for files and keeps secondary clicks from opening them", () => {
    const onCopyPath = vi.fn();
    const onDeleteRequested = vi.fn();
    const { onOpen } = renderTree(undefined, undefined, "zh-CN", {
      actionLabels,
      onCopyPath,
      onDeleteRequested,
    });
    const file = screen.getByRole("button", { name: /guide\.md/ });

    fireEvent.click(file, { button: 2 });
    fireEvent.click(file, { ctrlKey: true });
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.contextMenu(file, { clientX: 24, clientY: 40 });
    fireEvent.click(screen.getByRole("menuitem", { name: "复制路径" }));
    expect(onCopyPath).toHaveBeenCalledWith("/workspace/docs/guide.md");

    fireEvent.contextMenu(file, { clientX: 24, clientY: 40 });
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(onDeleteRequested).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "markdown",
        path: "/workspace/docs/guide.md",
      }),
    );
  });

  it("opens files in the current or a new tab only after choosing an action", () => {
    const onOpenInNewTab = vi.fn();
    const { onOpen } = renderTree(undefined, undefined, "zh-CN", { onOpenInNewTab });
    const file = screen.getByRole("button", { name: /guide\.md/ });
    fireEvent.contextMenu(file, { clientX: 30, clientY: 80 });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: "在新标签页中打开" }));
    expect(onOpenInNewTab).toHaveBeenCalledWith("/workspace/docs/guide.md");

    fireEvent.contextMenu(file, { clientX: 30, clientY: 80 });
    fireEvent.click(screen.getByRole("menuitem", { name: "打开" }));
    expect(onOpen).toHaveBeenCalledWith("/workspace/docs/guide.md");
  });

  it("creates siblings of a file in its actual parent, not the workspace root", async () => {
    const { onCreateFile } = renderTree();
    fireEvent.contextMenu(screen.getByRole("button", { name: /guide\.md/ }), {
      clientX: 30,
      clientY: 80,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "新建文件" }));
    const input = screen.getByRole("textbox", { name: "文件名" });
    fireEvent.change(input, { target: { value: "other.json" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(onCreateFile).toHaveBeenCalledWith("/workspace/docs", "other.json"),
    );
  });

  it("creates folders without adding a Markdown suffix and expands the parent", async () => {
    const onCreateFolder = vi.fn(async () => undefined);
    renderTree(undefined, undefined, "zh-CN", { onCreateFolder });
    const folder = screen.getByRole("button", { name: "docs" });
    fireEvent.click(folder);
    expect(folder).toHaveAttribute("aria-expanded", "false");
    fireEvent.contextMenu(folder, { clientX: 24, clientY: 40 });
    fireEvent.click(screen.getByRole("menuitem", { name: "新建文件夹" }));
    expect(folder).toHaveAttribute("aria-expanded", "true");
    const input = screen.getByRole("textbox", { name: "文件夹名称" });
    fireEvent.change(input, { target: { value: "  examples  " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(onCreateFolder).toHaveBeenCalledWith("/workspace/docs", "examples"),
    );
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    expect(folder).toHaveAttribute("aria-expanded", "true");
  });

  it("supports root create from an external blank-area request even when collapsed", async () => {
    const onCreateFolder = vi.fn(async () => undefined);
    const { rerender } = renderTree(undefined, undefined, "zh-CN", {
      rootName: "示例工作区",
      onCreateFolder,
    });
    fireEvent.click(screen.getByRole("button", { name: "折叠工作区 · 示例工作区" }));
    rerender(
      <AppSettingsProvider storage={null}>
        <WorkspaceTree
          contextMenuRequest={{ x: 30, y: 500, id: 1 }}
          nodes={nodes}
          onCreateFolder={onCreateFolder}
          onOpen={vi.fn()}
          rootName="示例工作区"
          rootPath="/workspace"
        />
      </AppSettingsProvider>,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "新建文件夹" }));
    const input = screen.getByRole("textbox", { name: "文件夹名称" });
    fireEvent.change(input, { target: { value: "notes" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(onCreateFolder).toHaveBeenCalledWith("/workspace", "notes"));
    expect(screen.getByRole("button", { name: "折叠工作区 · 示例工作区" })).toBeVisible();
  });

  it("acknowledges an external menu request once so the parent can discard it", () => {
    const onContextMenuRequestHandled = vi.fn();
    const request = { x: 30, y: 500, id: 42 };
    const { rerender } = renderTree(undefined, undefined, "zh-CN", {
      contextMenuRequest: request,
      onContextMenuRequestHandled,
    });
    expect(onContextMenuRequestHandled).toHaveBeenCalledExactlyOnceWith(42);
    expect(screen.getByRole("menu")).toBeVisible();
    rerender(
      <AppSettingsProvider storage={null}>
        <WorkspaceTree
          contextMenuRequest={request}
          nodes={nodes}
          onContextMenuRequestHandled={(id) => onContextMenuRequestHandled(id)}
          onOpen={vi.fn()}
          onReveal={vi.fn()}
          rootPath="/workspace"
        />
      </AppSettingsProvider>,
    );
    expect(onContextMenuRequestHandled).toHaveBeenCalledOnce();
  });

  it("keeps failed creation open for correction and can cancel without touching disk", async () => {
    const onCreateFolder = vi.fn(async () => {
      throw new Error("already exists");
    });
    renderTree(undefined, undefined, "zh-CN", { onCreateFolder });
    fireEvent.contextMenu(screen.getByRole("button", { name: "docs" }), {
      clientX: 24,
      clientY: 40,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "新建文件夹" }));
    const input = screen.getByRole("textbox", { name: "文件夹名称" });
    fireEvent.change(input, { target: { value: "existing" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(input).not.toBeDisabled());
    expect(input).toHaveValue("existing");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(onCreateFolder).toHaveBeenCalledTimes(1);
  });

  it("portals and clamps a measured menu to the viewport, with keyboard navigation", () => {
    const bounds = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("workspace-tree__context-menu")
        ? new DOMRect(0, 0, 240, 300)
        : bounds.call(this);
    });
    const { container } = renderTree(undefined, undefined, "zh-CN", {
      onOpenInNewTab: vi.fn(),
      onCreateFolder: vi.fn(async () => undefined),
      onCopyPath: vi.fn(),
    });
    const file = screen.getByRole("button", { name: /guide\.md/ });
    fireEvent.contextMenu(file, {
      clientX: window.innerWidth - 1,
      clientY: window.innerHeight - 1,
    });
    const menu = screen.getByRole("menu", { name: "文件操作" });
    expect(container).not.toContainElement(menu);
    expect(menu).toHaveStyle({
      left: `${window.innerWidth - 248}px`,
      top: `${window.innerHeight - 308}px`,
    });
    expect(menu).toHaveFocus();
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "打开" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    expect(screen.getByRole("menuitem", { name: "在文件管理器中显示" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "打开" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(file).toHaveFocus();
  });

  it("dismisses menus on outside pointer, scroll, and a different workspace context", () => {
    const { container } = renderTree();
    const file = screen.getByRole("button", { name: /guide\.md/ });
    fireEvent.contextMenu(file, { clientX: 30, clientY: 80 });
    fireEvent.pointerDown(container);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.contextMenu(file, { clientX: 30, clientY: 80 });
    fireEvent.scroll(container);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.contextMenu(file, { clientX: 30, clientY: 80 });
    fireEvent.contextMenu(document.body, { clientX: 60, clientY: 200 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("offers real folder collapse and filename search actions", () => {
    const onQuickOpen = vi.fn();
    renderTree(undefined, undefined, "zh-CN", { onQuickOpen });
    const folder = screen.getByRole("button", { name: "docs" });
    fireEvent.contextMenu(folder, { clientX: 24, clientY: 40 });
    fireEvent.click(screen.getByRole("menuitem", { name: "折叠文件夹" }));
    expect(folder).toHaveAttribute("aria-expanded", "false");
    fireEvent.contextMenu(folder, { clientX: 24, clientY: 40 });
    expect(screen.getByRole("menuitem", { name: "展开文件夹" })).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: "查找文件…" }));
    expect(onQuickOpen).toHaveBeenCalledOnce();
  });

  it("uses concise platform-specific file manager labels", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    renderTree(undefined, undefined, "zh-CN");
    fireEvent.contextMenu(screen.getByRole("button", { name: /guide\.md/ }), {
      clientX: 24,
      clientY: 40,
    });
    expect(screen.getByRole("menuitem", { name: "在 Finder 中显示" })).toBeVisible();
  });
});
