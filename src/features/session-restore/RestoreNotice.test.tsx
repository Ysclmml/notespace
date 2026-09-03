import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RestoreNotice, type RestoreNoticeProps } from "./RestoreNotice";

afterEach(cleanup);

function props(overrides: Partial<RestoreNoticeProps> = {}): RestoreNoticeProps {
  return {
    locale: "zh-CN",
    entries: [
      { kind: "workspace", path: "/test-fixtures/offline-workspace" },
      { kind: "document", path: "/test-fixtures/moved-document.md" },
    ],
    onRetry: vi.fn(),
    onForget: vi.fn(),
    onChooseWorkspace: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
}

function expandDetails() {
  const summary = screen.getByText(/查看详情与处理|View details and actions/);
  fireEvent.click(summary);
  return summary.closest("details")!;
}

describe("RestoreNotice", () => {
  it("renders nothing when no locations failed", () => {
    const { container } = render(<RestoreNotice {...props({ entries: [] })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("deduplicates by kind and exact path without changing the input", () => {
    const entry = { kind: "workspace", path: "/test-fixtures/offline" } as const;
    const entries = Object.freeze([
      entry,
      entry,
      { kind: "document", path: entry.path } as const,
    ]);
    render(<RestoreNotice {...props({ entries })} />);
    expect(screen.getByRole("status")).toHaveTextContent("1 个工作区、1 个文件");
    const details = expandDetails();
    expect(within(details).getAllByRole("listitem")).toHaveLength(2);
    expect(entries).toHaveLength(3);
  });

  it.each([
    ["zh-CN", "部分浏览位置未能恢复", "1 个工作区、1 个文件"],
    ["en-US", "Some browsing locations could not be restored", "1 workspace, 1 file"],
  ] as const)(
    "shows localized summary and optional details in %s",
    (locale, title, count) => {
      render(<RestoreNotice {...props({ locale })} />);
      expect(screen.getByRole("complementary", { name: title })).toBeVisible();
      expect(screen.getByRole("status")).toHaveTextContent(count);
      const details = screen
        .getByText(/查看详情与处理|View details and actions/)
        .closest("details")!;
      expect(details).not.toHaveAttribute("open");
      expandDetails();
      expect(details).toHaveAttribute("open");
      expect(screen.getByText("/test-fixtures/offline-workspace")).toBeVisible();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("keeps the complete long path as selectable wrapping text, never HTML", () => {
    const path = `/test-fixtures/${"很长的文件夹 ".repeat(60)}<img src=x onerror=alert(1)>.md`;
    const { container } = render(
      <RestoreNotice {...props({ entries: [{ kind: "document", path }] })} />,
    );
    expandDetails();
    const displayedPath = container.querySelector(".restore-notice__path");
    expect(displayedPath?.textContent).toBe(path);
    expect(displayedPath).toHaveAttribute("dir", "auto");
    expect(container.querySelector("img")).toBeNull();
  });

  it("routes retry, forget and folder selection only after explicit actions", () => {
    const callbacks = props();
    render(<RestoreNotice {...callbacks} />);
    expandDetails();
    expect(callbacks.onRetry).not.toHaveBeenCalled();
    expect(callbacks.onForget).not.toHaveBeenCalled();
    expect(callbacks.onChooseWorkspace).not.toHaveBeenCalled();
    const rows = screen.getAllByRole("listitem");
    const workspaceRow = rows[0]!;
    const documentRow = rows[1]!;
    fireEvent.click(within(workspaceRow).getByRole("button", { name: "重试" }));
    expect(callbacks.onRetry).toHaveBeenCalledExactlyOnceWith(callbacks.entries[0]);
    fireEvent.click(within(documentRow).getByRole("button", { name: "从记录移除" }));
    expect(callbacks.onForget).toHaveBeenCalledExactlyOnceWith(callbacks.entries[1]);
    expect(
      within(documentRow).getByRole("button", { name: "从记录移除" }),
    ).toHaveAccessibleDescription(/只清除浏览记录，不删除文件/);
    fireEvent.click(screen.getByRole("button", { name: "选择文件夹…" }));
    expect(callbacks.onChooseWorkspace).toHaveBeenCalledOnce();
  });

  it("disables both actions for pending paths and leaves other entries usable", () => {
    const callbacks = props({ pendingPaths: ["/test-fixtures/offline-workspace"] });
    const { rerender } = render(<RestoreNotice {...callbacks} />);
    expandDetails();
    const rows = screen.getAllByRole("listitem");
    const workspaceRow = rows[0]!;
    const documentRow = rows[1]!;
    const pendingRetry = within(workspaceRow).getByRole("button", { name: "正在重试…" });
    const pendingForget = within(workspaceRow).getByRole("button", { name: "从记录移除" });
    expect(workspaceRow).toHaveAttribute("aria-busy", "true");
    expect(pendingRetry).toBeDisabled();
    expect(pendingForget).toBeDisabled();
    fireEvent.click(pendingRetry);
    fireEvent.click(pendingForget);
    expect(callbacks.onRetry).not.toHaveBeenCalled();
    expect(callbacks.onForget).not.toHaveBeenCalled();
    expect(within(documentRow).getByRole("button", { name: "重试" })).toBeEnabled();
    rerender(<RestoreNotice {...callbacks} pendingPaths={[]} />);
    fireEvent.click(within(workspaceRow).getByRole("button", { name: "重试" }));
    expect(callbacks.onRetry).toHaveBeenCalledExactlyOnceWith(callbacks.entries[0]);
  });

  it("does not offer folder selection for document-only failures", () => {
    render(
      <RestoreNotice
        {...props({ entries: [{ kind: "document", path: "/test-fixtures/a.md" }] })}
      />,
    );
    expandDetails();
    expect(screen.queryByRole("button", { name: "选择文件夹…" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("1 个文件");
  });

  it("does not steal editing focus or capture the editor's Escape key", () => {
    const callbacks = props();
    const editor = document.createElement("textarea");
    document.body.append(editor);
    editor.focus();
    try {
      render(<RestoreNotice {...callbacks} />);
      expect(editor).toHaveFocus();
      fireEvent.keyDown(editor, { key: "Escape" });
      expect(callbacks.onDismiss).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "关闭恢复提示" }));
      expect(callbacks.onDismiss).toHaveBeenCalledOnce();
      expect(callbacks.onForget).not.toHaveBeenCalled();
    } finally {
      editor.remove();
    }
  });
});
