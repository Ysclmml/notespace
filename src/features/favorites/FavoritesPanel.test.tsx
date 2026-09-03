import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DocumentInspection } from "../../infrastructure/tauri/desktopAdapter";
import { FavoritesPanel, type FavoritesPanelProps } from "./FavoritesPanel";

const guide = "/workspace/docs/guide.md";
const other = "/archive/reference/guide.md";
const unavailable = "/archive/missing.md";
const props: FavoritesPanelProps = {
  paths: [guide],
  locale: "zh-CN",
  onOpen: () => undefined,
  onRemove: () => undefined,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("FavoritesPanel", () => {
  it("renders a compact named group with count, duplicate-name parent hints and full-path tooltips", () => {
    render(<FavoritesPanel {...props} activePath={guide} paths={[guide, other]} />);
    const region = screen.getByRole("region", { name: "收藏" });
    const heading = within(region).getByRole("button", { name: "折叠收藏" });
    expect(heading).toHaveAttribute("aria-expanded", "true");
    expect(within(heading).getByText("2")).toBeInTheDocument();
    const rows = within(region).getAllByRole("button", { name: "guide.md" });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("title", guide);
    expect(rows[0]).toHaveAttribute("aria-current", "page");
    expect(rows[1]).toHaveAttribute("title", other);
    expect(within(region).getByText("docs")).toBeInTheDocument();
    expect(within(region).getByText("reference")).toBeInTheDocument();
    expect(within(region).queryByText(guide)).not.toBeInTheDocument();

    fireEvent.click(heading);
    expect(screen.getByRole("button", { name: "展开收藏" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开收藏" }));
    expect(screen.getAllByRole("button", { name: "guide.md" })).toHaveLength(2);
  });

  it("gives unique filenames the full row width and adds parent hints only for duplicates", () => {
    const path = "/workspace/product/01-产品设计.md";
    const duplicate = "/archive/design/01-产品设计.md";
    const view = (paths: readonly string[]) => <FavoritesPanel {...props} paths={paths} />;
    const { container, rerender } = render(view([path]));
    const row = screen.getByRole("button", { name: "01-产品设计.md" });
    expect(row).toHaveAttribute("title", path);
    expect(row).toHaveTextContent("01-产品设计.md");
    expect(container.querySelector(".favorites-panel__hint")).not.toBeInTheDocument();
    rerender(view([path, duplicate]));
    expect(screen.getByText("product")).toBeInTheDocument();
    expect(screen.getByText("design")).toBeInTheDocument();
    expect(container.querySelectorAll(".favorites-panel__hint")).toHaveLength(2);
    rerender(view([path]));
    expect(container.querySelector(".favorites-panel__hint")).not.toBeInTheDocument();
  });

  it("keeps an unobtrusive empty group and localizes its actions", () => {
    render(<FavoritesPanel {...props} locale="en-US" onHide={vi.fn()} paths={[]} />);
    expect(screen.getByRole("button", { name: "Collapse favorites" })).toHaveAttribute(
      "title",
      "Right-click or Control-click to open the Favorites menu",
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "Collapse favorites" }));
    expect(screen.getByRole("menu", { name: "Favorites actions" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Close Favorites" })).toBeVisible();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("No favorite files yet")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("opens the heading menu on right-click or Control-click and hides only from its action", () => {
    const onHide = vi.fn();
    const parentContext = vi.fn();
    render(
      <div onContextMenu={parentContext}>
        <FavoritesPanel {...props} onHide={onHide} />
      </div>,
    );
    const heading = screen.getByRole("button", { name: "折叠收藏" });
    expect(heading).toHaveAttribute("title", "右键或按住 Control 点击可打开收藏菜单");

    expect(fireEvent.contextMenu(heading, { clientX: 42, clientY: 48 })).toBe(false);
    expect(onHide).not.toHaveBeenCalled();
    expect(parentContext).not.toHaveBeenCalled();
    const menu = screen.getByRole("menu", { name: "收藏操作" });
    expect(menu).toBeVisible();
    expect(menu).toHaveStyle({ left: "42px", top: "48px" });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "收藏操作" })).not.toBeInTheDocument();
    expect(heading).toHaveFocus();
    expect(onHide).not.toHaveBeenCalled();

    fireEvent.click(heading, { clientX: 52, clientY: 58, ctrlKey: true });
    expect(onHide).not.toHaveBeenCalled();
    expect(heading).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "关闭收藏" }));
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu", { name: "收藏操作" })).not.toBeInTheDocument();

    fireEvent.click(heading);
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "展开收藏" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "展开收藏" }));

    const file = screen.getByRole("button", { name: "guide.md" });
    fireEvent.contextMenu(file);
    fireEvent.click(file, { ctrlKey: true });
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu", { name: "收藏操作" })).not.toBeInTheDocument();
    expect(parentContext).not.toHaveBeenCalled();
  });

  it("opens or removes only the chosen path with focusable controls and no enclosing tree menu", async () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    const onContextMenu = vi.fn();
    render(
      <div onContextMenu={onContextMenu}>
        <FavoritesPanel {...props} onOpen={onOpen} onRemove={onRemove} />
      </div>,
    );
    const file = screen.getByRole("button", { name: "guide.md" });
    file.focus();
    expect(file).toHaveFocus();
    fireEvent.contextMenu(file);
    fireEvent.click(file, { ctrlKey: true });
    expect(onContextMenu).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(file);
    await waitFor(() => expect(onOpen).toHaveBeenCalledExactlyOnceWith(guide));
    const remove = screen.getByRole("button", { name: "取消收藏 guide.md" });
    remove.focus();
    expect(remove).toHaveFocus();
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(guide);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("normalizes Windows paths for the active row without changing stored path spelling", () => {
    render(
      <FavoritesPanel
        {...props}
        activePath="c:/notes/GUIDE.md"
        paths={["C:\\Notes\\guide.md"]}
      />,
    );
    expect(screen.getByRole("button", { name: "guide.md" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "guide.md" })).toHaveAttribute(
      "title",
      "C:\\Notes\\guide.md",
    );
    expect(screen.queryByText("Notes")).not.toBeInTheDocument();
  });

  it("keeps missing and unreadable favorites, then retries the existing path and clears restored status", async () => {
    const inspectPaths = vi
      .fn()
      .mockResolvedValueOnce([
        { path: guide, status: "unreadable" },
        { path: unavailable, status: "missing" },
      ])
      .mockResolvedValue([
        { path: guide, status: "present" },
        { path: unavailable, status: "present" },
      ]);
    const openResult = deferred<void>();
    const onOpen = vi.fn(() => openResult.promise);
    const onRemove = vi.fn();
    render(
      <FavoritesPanel
        {...props}
        paths={[guide, unavailable]}
        inspectPaths={inspectPaths}
        onOpen={onOpen}
        onRemove={onRemove}
      />,
    );
    expect(await screen.findByText("文件不存在")).toBeInTheDocument();
    expect(screen.getByText("无法读取")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "missing.md" })).toHaveAttribute(
      "aria-description",
      `文件不存在 · ${unavailable}`,
    );
    expect(onRemove).not.toHaveBeenCalled();
    const retry = screen.getByRole("button", { name: "重试打开 missing.md" });
    retry.focus();
    expect(retry).toHaveFocus();
    fireEvent.click(retry);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(unavailable);
    expect(retry).toBeDisabled();
    expect(inspectPaths).toHaveBeenCalledTimes(1);
    await act(async () => openResult.resolve());
    await waitFor(() => expect(inspectPaths).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("文件不存在")).not.toBeInTheDocument();
    expect(screen.queryByText("无法读取")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("checks metadata only while the group is visible, on expand and window focus", async () => {
    const inspectPaths = vi.fn(async (paths: readonly string[]) =>
      paths.map((path) => ({ path, status: "present" as const })),
    );
    const view = (visible = true) => (
      <FavoritesPanel {...props} inspectPaths={inspectPaths} visible={visible} />
    );
    const { rerender } = render(view());
    await waitFor(() => expect(inspectPaths).toHaveBeenCalledTimes(1));
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(inspectPaths).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "折叠收藏" }));
    fireEvent(window, new Event("focus"));
    expect(inspectPaths).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "展开收藏" }));
    await waitFor(() => expect(inspectPaths).toHaveBeenCalledTimes(3));
    rerender(view(false));
    fireEvent(window, new Event("focus"));
    expect(inspectPaths).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("region", { name: "收藏" })).not.toBeInTheDocument();
    rerender(view());
    await waitFor(() => expect(inspectPaths).toHaveBeenCalledTimes(4));
  });

  it("ignores late metadata after removal/re-add, collapse and unmount; focus bursts do not fan out", async () => {
    const oldResult = deferred<readonly DocumentInspection[]>();
    const newResult = deferred<readonly DocumentInspection[]>();
    const inspectPaths = vi
      .fn()
      .mockReturnValueOnce(oldResult.promise)
      .mockReturnValueOnce(newResult.promise);
    const view = (paths: readonly string[]) => (
      <FavoritesPanel {...props} paths={paths} inspectPaths={inspectPaths} />
    );
    const { rerender, unmount } = render(view([guide]));
    fireEvent(window, new Event("focus"));
    fireEvent(window, new Event("focus"));
    expect(inspectPaths).toHaveBeenCalledTimes(1);
    rerender(view([]));
    rerender(view([guide]));
    await act(async () => newResult.resolve([{ path: guide, status: "present" }]));
    await act(async () => oldResult.resolve([{ path: guide, status: "missing" }]));
    expect(screen.queryByText("文件不存在")).not.toBeInTheDocument();
    const collapsedResult = deferred<readonly DocumentInspection[]>();
    inspectPaths.mockReturnValueOnce(collapsedResult.promise);
    fireEvent(window, new Event("focus"));
    fireEvent.click(screen.getByRole("button", { name: "折叠收藏" }));
    await act(async () => collapsedResult.resolve([{ path: guide, status: "missing" }]));
    expect(screen.queryByText("文件不存在")).not.toBeInTheDocument();
    unmount();
    fireEvent(window, new Event("focus"));
    expect(inspectPaths).toHaveBeenCalledTimes(3);
  });

  it("retains favorites after inspection errors and retries failed open without an unhandled rejection", async () => {
    const inspectPaths = vi
      .fn()
      .mockRejectedValueOnce(new Error("not available"))
      .mockResolvedValue([{ path: guide, status: "unreadable" }]);
    const onRemove = vi.fn();
    const onOpen = vi.fn(async () => {
      throw new Error("no access");
    });
    render(
      <FavoritesPanel
        {...props}
        inspectPaths={inspectPaths}
        onOpen={onOpen}
        onRemove={onRemove}
      />,
    );
    expect(await screen.findByText("暂不可用")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试打开 guide.md" }));
    expect(await screen.findByText("无法读取")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "guide.md" })).toBeInTheDocument();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("bounds visible rows and metadata requests to the existing 100-path limit", async () => {
    const paths = Array.from({ length: 110 }, (_, index) => `/notes/${index}.md`);
    const inspectPaths = vi.fn(async (requested: readonly string[]) =>
      requested.map((path) => ({ path, status: "present" as const })),
    );
    render(<FavoritesPanel {...props} paths={paths} inspectPaths={inspectPaths} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(100);
    await waitFor(() =>
      expect(inspectPaths).toHaveBeenCalledExactlyOnceWith(paths.slice(0, 100)),
    );
  });
});
