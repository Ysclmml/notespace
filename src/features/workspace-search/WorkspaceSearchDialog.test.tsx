import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceSearchDialog,
  type WorkspaceSearchDialogProps,
} from "./WorkspaceSearchDialog";
import {
  createWorkspaceSearchViewState,
  type WorkspaceSearchResponse,
  type WorkspaceSearchViewState,
} from "./types";
import { SEARCH_HISTORY_STORAGE_KEY } from "./searchHistory";

const roots = [
  { path: "/notes", showHidden: false },
  { path: "/code", showHidden: true },
];
const match = {
  rootPath: "/notes",
  path: "/notes/topic.md",
  relativePath: "topic.md",
  line: 12,
  column: 1,
  matchLength: 7,
  snippet: "中文 keyword content",
  snippetMatchStart: 3,
  snippetMatchEnd: 10,
};
const response: WorkspaceSearchResponse = {
  matches: [match],
  searchedFiles: 3,
  skippedFiles: 0,
  truncated: false,
  unavailableRoots: [],
};

function mount(overrides: Partial<WorkspaceSearchDialogProps> = {}) {
  const props: WorkspaceSearchDialogProps = {
    locale: "en-US",
    workspaces: roots,
    search: vi.fn().mockResolvedValue(response),
    onOpen: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(<WorkspaceSearchDialog {...props} />), props };
}

async function search() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
  });
}

beforeEach(() => localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY));
afterEach(() => localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY));

describe("global workspace contents search dialog", () => {
  it("defaults to all currently open roots and only submits the selected root when narrowed", async () => {
    const { props } = mount();
    const dialog = screen.getByRole("dialog", { name: "Search Workspaces" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("searchbox")).toHaveFocus();
    expect(screen.getByText(/Markdown, code and text file contents on disk/)).toBeVisible();
    expect(
      screen.queryByText(/not your whole computer or closed recent workspaces/),
    ).toBeNull();
    expect(screen.queryByText(/find a file by name, use Quick Open/)).toBeNull();
    expect(screen.getByRole("combobox", { name: "Search scope" })).toHaveTextContent(
      "All open workspaces (2)",
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "keyword" } });
    await search();
    expect(props.search).toHaveBeenLastCalledWith(roots, "keyword", false, false, "");
    fireEvent.click(screen.getByRole("combobox", { name: "Search scope" }));
    fireEvent.click(screen.getByRole("option", { name: "/code" }));
    expect(screen.queryByTitle("topic.md:12:1")).not.toBeInTheDocument();
    await search();
    expect(props.search).toHaveBeenLastCalledWith([roots[1]], "keyword", false, false, "");
    fireEvent.click(screen.getByTitle("topic.md:12:1"));
    expect(props.onOpen).toHaveBeenCalledExactlyOnceWith(match);
  });

  it("keeps late results invisible after a scope change and never searches a closed root", async () => {
    let resolve!: (value: WorkspaceSearchResponse) => void;
    const { props, rerender } = mount({
      search: vi.fn(
        () =>
          new Promise<WorkspaceSearchResponse>((done) => {
            resolve = done;
          }),
      ),
    });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "keyword" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Search scope" }));
    fireEvent.click(screen.getByRole("option", { name: "/code" }));
    await act(async () => resolve(response));
    expect(screen.queryByTitle("topic.md:12:1")).not.toBeInTheDocument();
    rerender(<WorkspaceSearchDialog {...props} workspaces={[roots[0]!]} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("All open workspaces (1)");
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.queryByRole("option", { name: "/code" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("option", { name: /All open workspaces/ }), {
      key: "Escape",
    });
    expect(props.search).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(props.search).toHaveBeenLastCalledWith([roots[0]], "keyword", false, false, "");
    await act(async () => resolve(response));
  });

  it("operates the custom scope list with arrows, Escape and outside clicks", () => {
    const { props } = mount();
    const scope = screen.getByRole("combobox", { name: "Search scope" });
    expect(scope.querySelector("svg")).toBeInTheDocument();
    expect(scope).not.toHaveTextContent("▾");
    scope.focus();
    fireEvent.keyDown(scope, { key: "ArrowDown" });
    expect(screen.getByRole("listbox", { name: "Search scope" })).toBeVisible();
    expect(screen.getByRole("option", { name: /All open workspaces/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: "/notes" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "/code" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(scope).toHaveTextContent("/code");
    expect(scope).toHaveFocus();

    fireEvent.keyDown(scope, { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: "/notes" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(scope).toHaveFocus();
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(scope);
    expect(screen.getByRole("listbox")).toBeVisible();
    expect(screen.getByRole("option", { name: "/code" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.mouseDown(screen.getByRole("searchbox"));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(scope).toHaveTextContent("/code");
  });

  it("traps focus across current controls and results while Escape respects composition", async () => {
    const { props } = mount();
    const close = screen.getByRole("button", { name: "Close workspace search" });
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("textbox", { name: /File name or path filter/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "keyword" } });
    await search();
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(screen.getByTitle("topic.md:12:1")).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape", isComposing: true });
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("unmounts cleanly, then restores the last result, scroll and clicked row from memory", async () => {
    const searchWorkspaces = vi.fn().mockResolvedValue(response);
    function Harness() {
      const [open, setOpen] = useState(false);
      const [viewState, setViewState] = useState<WorkspaceSearchViewState>(
        createWorkspaceSearchViewState,
      );
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">
            Open search
          </button>
          {open && (
            <WorkspaceSearchDialog
              locale="en-US"
              workspaces={roots}
              search={searchWorkspaces}
              onOpen={() => setOpen(false)}
              onClose={() => setOpen(false)}
              onViewStateChange={setViewState}
              viewState={viewState}
            />
          )}
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open search" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("searchbox")).toHaveFocus();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "keyword" } });
    await search();
    const results = document.querySelector<HTMLElement>(".workspace-search__results")!;
    results.scrollTop = 137;
    fireEvent.scroll(results);
    fireEvent.click(screen.getByTitle("topic.md:12:1"));
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-search-dialog-layer")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("searchbox")).toHaveValue("keyword");
    expect(searchWorkspaces).toHaveBeenCalledOnce();
    expect(screen.getByTitle("topic.md:12:1")).toHaveAttribute("aria-current", "true");
    expect(
      document.querySelector<HTMLElement>(".workspace-search__results")!.scrollTop,
    ).toBe(137);
  });

  it("shows a useful empty-scope action in Chinese and closes on the backdrop", () => {
    const onOpenWorkspace = vi.fn();
    const { container, props } = mount({
      locale: "zh-CN",
      workspaces: [],
      onOpenWorkspace,
    });
    expect(screen.getByRole("dialog", { name: "工作区全文搜索" })).toBeVisible();
    expect(screen.getByRole("button", { name: "搜索" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "搜索范围" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "打开工作区…" }));
    expect(onOpenWorkspace).toHaveBeenCalledOnce();
    fireEvent.mouseDown(container.querySelector(".workspace-search-dialog-layer")!);
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
