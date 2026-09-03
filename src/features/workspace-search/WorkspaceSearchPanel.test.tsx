import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  WorkspaceSearchPanel,
  type WorkspaceSearchPanelProps,
} from "./WorkspaceSearchPanel";
import type { WorkspaceSearchResponse } from "./types";

const match = {
  path: "/example/notes/guide.md",
  relativePath: "notes/guide.md",
  rootPath: "/example",
  line: 23,
  column: 4,
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

describe("WorkspaceSearchPanel", () => {
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
    fireEvent.click(screen.getByRole("checkbox", { name: "Match case" }));
    await submit();
    expect(props.search).toHaveBeenCalledWith(props.workspaces, "MATCH", true);
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
    expect(screen.getByRole("button", { name: "Search" })).toBeEnabled();
  });

  it("does not expose results after root or hidden-file settings change", async () => {
    const { props, rerender } = mount();
    enterQuery();
    await submit();
    expect(screen.getByText("A matching paragraph")).toBeVisible();
    rerender(
      <WorkspaceSearchPanel
        {...props}
        workspaces={[{ path: "/example", showHidden: true }]}
      />,
    );
    expect(screen.queryByText("A matching paragraph")).not.toBeInTheDocument();
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

  it("shows retryable search failures and no-match outcomes", async () => {
    const search = vi
      .fn()
      .mockRejectedValueOnce(new Error("native failure"))
      .mockResolvedValueOnce({ ...result, matches: [] });
    mount({ search });
    enterQuery();
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to finish the search");
    await submit();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("No matching contents found.")).toBeVisible();
  });

  it("renders Chinese labels and closes on Escape while preserving IME input", async () => {
    const { props } = mount({ locale: "zh-CN" });
    expect(screen.getByRole("search", { name: "工作区全文搜索" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "区分大小写" })).toBeVisible();
    enterQuery("中文");
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape", isComposing: true });
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    });
    expect(props.search).toHaveBeenCalledWith(props.workspaces, "中文", false);
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
