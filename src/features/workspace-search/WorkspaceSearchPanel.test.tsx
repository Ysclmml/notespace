import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkspaceSearchPanel,
  type WorkspaceSearchPanelProps,
} from "./WorkspaceSearchPanel";
import type { WorkspaceSearchResponse } from "./types";
import { loadSearchHistory, SEARCH_HISTORY_STORAGE_KEY } from "./searchHistory";

const match = {
  path: "/example/notes/guide.md",
  relativePath: "notes/guide.md",
  rootPath: "/example",
  line: 23,
  column: 4,
  matchLength: 8,
  snippet: "A matching paragraph",
};

const result: WorkspaceSearchResponse = {
  matches: [match],
  searchedFiles: 3,
  skippedFiles: 0,
  unavailableRoots: [],
  truncated: false,
};

function mount(overrides: Partial<WorkspaceSearchPanelProps> = {}) {
  const props: WorkspaceSearchPanelProps = {
    locale: "en-US",
    workspaces: [{ path: "/example", showHidden: false }],
    search: vi.fn().mockResolvedValue(result),
    onOpen: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(<WorkspaceSearchPanel {...props} />), props };
}

function enterQuery(query = "matching") {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: query } });
}

async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
  });
}

beforeEach(() => localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY));
afterEach(() => localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY));

describe("WorkspaceSearchPanel", () => {
  it("highlights matching snippets and file names without changing literal contents or navigation", async () => {
    const literalMatch = {
      ...match,
      relativePath: "matching.md",
      snippet: "<matching> 中文 MATCHING",
    };
    const { container, props } = mount({
      search: vi.fn().mockResolvedValue({ ...result, matches: [literalMatch] }),
    });
    enterQuery();
    await submit();
    expect(
      [...container.querySelectorAll("mark")].map((element) => element.textContent),
    ).toEqual(["matching", "matching", "MATCHING"]);
    expect(container.querySelector("matching")).toBeNull();
    const button = screen.getByTitle("matching.md:23:4");
    expect(button).toHaveTextContent("<matching> 中文 MATCHING");
    fireEvent.click(button);
    expect(props.onOpen).toHaveBeenCalledExactlyOnceWith(literalMatch);
  });
  it("searches only after explicit submission and opens a result without closing the panel", async () => {
    const { props } = mount();
    expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/excluding unsaved changes/)).toBeVisible();
    enterQuery();
    expect(props.search).not.toHaveBeenCalled();
    await submit();
    expect(props.search).toHaveBeenCalledExactlyOnceWith(
      props.workspaces,
      "matching",
      false,
      false,
      "",
    );
    expect(screen.getByText("1 matching lines · 3 files searched")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "23 A matching paragraph" }));
    expect(props.onOpen).toHaveBeenCalledExactlyOnceWith(match);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("search")).toBeVisible();
  });

  it("supports matching case and explicitly refreshes disk results", async () => {
    const { props } = mount();
    enterQuery("MATCH");
    fireEvent.click(screen.getByRole("switch", { name: "Match case" }));
    await submit();
    expect(props.search).toHaveBeenCalledWith(props.workspaces, "MATCH", true, false, "");
    await submit();
    expect(props.search).toHaveBeenCalledTimes(2);
  });

  it("does not search empty input or no-workspace scope", () => {
    const { props } = mount({ workspaces: [] });
    expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
    enterQuery();
    expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
    expect(screen.getByText(/Open a workspace/)).toBeVisible();
    expect(props.search).not.toHaveBeenCalled();
  });

  it("keeps requests serial and hides a late result for an edited query", async () => {
    let resolve!: (result: WorkspaceSearchResponse) => void;
    const { props } = mount({
      search: vi.fn(
        () =>
          new Promise<WorkspaceSearchResponse>((done) => {
            resolve = done;
          }),
      ),
    });
    enterQuery("first");
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("button", { name: "Searching…" })).toBeDisabled();
    enterQuery("second");
    expect(props.search).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(result);
    });
    expect(screen.queryByText("A matching paragraph")).not.toBeInTheDocument();
    enterQuery("first");
    expect(screen.queryByText("A matching paragraph")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeEnabled();
  });

  it("does not expose results after root or hidden-file settings change", async () => {
    const { props, rerender } = mount();
    enterQuery();
    await submit();
    expect(screen.getByTitle("notes/guide.md:23:4")).toHaveTextContent(
      "A matching paragraph",
    );
    rerender(
      <WorkspaceSearchPanel
        {...props}
        workspaces={[{ path: "/example", showHidden: true }]}
      />,
    );
    expect(screen.queryByTitle("notes/guide.md:23:4")).not.toBeInTheDocument();
    expect(props.search).toHaveBeenCalledTimes(1);
  });

  it("clearly reports bounds, skipped files and unreadable roots without claiming no matches", async () => {
    mount({
      search: vi.fn().mockResolvedValue({
        ...result,
        matches: [],
        truncated: true,
        skippedFiles: 2,
        unavailableRoots: ["/example/offline"],
      }),
    });
    enterQuery();
    await submit();
    expect(screen.getByText(/Results are incomplete/)).toBeVisible();
    expect(screen.getByText(/2 files skipped/)).toBeVisible();
    expect(screen.getByText("/example/offline")).toBeVisible();
    expect(screen.queryByText("No matching contents found.")).not.toBeInTheDocument();
  });

  it("passes regex and file-filter controls separately and highlights the native match length", async () => {
    const regexMatch = {
      ...match,
      snippet: "before item-2048 after",
      column: 8,
      matchLength: 9,
    };
    const { container, props } = mount({
      search: vi.fn().mockResolvedValue({ ...result, matches: [regexMatch] }),
    });
    enterQuery("item-\\d+");
    fireEvent.click(screen.getByRole("switch", { name: "Content regex" }));
    fireEvent.click(screen.getByRole("switch", { name: "Match case" }));
    fireEvent.change(screen.getByRole("textbox", { name: /File name or path filter/ }), {
      target: { value: "\\.(md|tsx)$" },
    });
    await submit();
    expect(props.search).toHaveBeenCalledExactlyOnceWith(
      props.workspaces,
      "item-\\d+",
      true,
      true,
      "\\.(md|tsx)$",
    );
    expect(container.querySelector("mark")).toHaveTextContent("item-2048");
    expect(screen.getByTitle("notes/guide.md:23:8")).toHaveTextContent(
      "before item-2048 after",
    );
  });

  it("restores a successful search with its context on the next mount and can clear history", async () => {
    const roots = [
      { path: "/example", showHidden: false },
      { path: "/code", showHidden: true },
    ];
    const first = mount({ workspaces: roots });
    enterQuery("TODO|FIXME");
    fireEvent.click(screen.getByRole("combobox", { name: "Search scope" }));
    fireEvent.click(screen.getByRole("option", { name: "/code" }));
    fireEvent.click(screen.getByRole("switch", { name: "Match case" }));
    fireEvent.click(screen.getByRole("switch", { name: "Content regex" }));
    fireEvent.change(screen.getByRole("textbox", { name: /File name or path filter/ }), {
      target: { value: "\\.(md|tsx)$" },
    });
    await submit();
    expect(loadSearchHistory()).toMatchObject([
      {
        query: "TODO|FIXME",
        scopePath: "/code",
        caseSensitive: true,
        useRegex: true,
        fileFilter: "\\.(md|tsx)$",
      },
    ]);
    first.unmount();

    const second = mount({ workspaces: roots });
    const recent = screen.getByRole("region", { name: "Recent searches" });
    expect(recent.querySelector("small")).toBeNull();
    expect(recent).not.toHaveTextContent("/code");
    expect(recent).not.toHaveTextContent("Content regex");
    fireEvent.click(
      screen.getByRole("button", {
        name: /Use recent search: TODO\|FIXME, \/code.*Match case.*Content regex/,
      }),
    );
    expect(screen.getByRole("searchbox")).toHaveValue("TODO|FIXME");
    expect(screen.getByRole("combobox", { name: "Search scope" })).toHaveTextContent(
      "/code",
    );
    expect(screen.getByRole("switch", { name: "Match case" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: "Content regex" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("textbox", { name: /File name or path filter/ })).toHaveValue(
      "\\.(md|tsx)$",
    );
    expect(second.props.search).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear recent searches" }));
    expect(screen.queryByRole("region", { name: "Recent searches" })).toBeNull();
    expect(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("searchbox")).toHaveValue("TODO|FIXME");
    expect(recent).not.toBeInTheDocument();
  });

  it("falls back to all open roots when a saved scope is no longer open", () => {
    localStorage.setItem(
      SEARCH_HISTORY_STORAGE_KEY,
      JSON.stringify([
        {
          query: "old workspace",
          scopePath: "/closed",
          caseSensitive: false,
          useRegex: false,
          fileFilter: "",
          lastUsedAt: 1,
        },
      ]),
    );
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: /Use recent search: old workspace/ }),
    );
    expect(screen.getByRole("searchbox")).toHaveValue("old workspace");
    expect(screen.getByRole("combobox", { name: "Search scope" })).toHaveTextContent(
      "All open workspaces (1)",
    );
  });

  it("shows specific regex errors, clears stale errors on edits, and keeps generic failures retryable", async () => {
    const search = vi
      .fn()
      .mockRejectedValueOnce({ code: "invalidSearchPattern" })
      .mockRejectedValueOnce({ code: "invalidFileFilter" })
      .mockRejectedValueOnce(new Error("native failure"))
      .mockResolvedValueOnce({ ...result, matches: [] });
    mount({ search });
    enterQuery("(");
    fireEvent.click(screen.getByRole("switch", { name: "Content regex" }));
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "content regular expression is invalid",
    );
    expect(loadSearchHistory()).toEqual([]);
    enterQuery("matching");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: /File name or path filter/ }), {
      target: { value: "[" },
    });
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "file name or path filter is invalid",
    );
    fireEvent.change(screen.getByRole("textbox", { name: /File name or path filter/ }), {
      target: { value: "" },
    });
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to finish the search");
    await submit();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("No matching contents found.")).toBeVisible();
  });

  it("renders Chinese labels and closes on Escape while preserving IME input", async () => {
    const { props } = mount({ locale: "zh-CN" });
    expect(screen.getByRole("search", { name: "工作区全文搜索" })).toBeVisible();
    expect(screen.getByRole("switch", { name: "区分大小写" })).toBeVisible();
    expect(screen.getByRole("switch", { name: "正文正则" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: /文件名或路径筛选/ })).toBeVisible();
    enterQuery("中文");
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape", isComposing: true });
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    });
    expect(props.search).toHaveBeenCalledWith(props.workspaces, "中文", false, false, "");
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("discards a request that finishes after the panel unmounts", async () => {
    let resolve!: (result: WorkspaceSearchResponse) => void;
    const { props, unmount } = mount({
      search: vi.fn(
        () =>
          new Promise<WorkspaceSearchResponse>((done) => {
            resolve = done;
          }),
      ),
    });
    enterQuery();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    unmount();
    await act(async () => {
      resolve(result);
    });
    expect(props.onOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
  });
});
