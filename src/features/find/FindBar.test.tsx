import { useEffect } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FindBar } from "./FindBar";
import { findTextMatches, type PageFindTarget } from "./pageFind";
import { usePageFind } from "./usePageFind";

function FindHarness({
  readOnly = false,
  target,
}: {
  readonly readOnly?: boolean;
  readonly target: PageFindTarget;
}) {
  const find = usePageFind(1);
  const { targetRef, refresh } = find;
  useEffect(() => {
    targetRef.current = target;
    refresh();
    return () => {
      targetRef.current = null;
    };
  }, [target, targetRef, refresh]);
  return <FindBar find={find} locale="en-US" readOnly={readOnly} />;
}

function findTarget(): PageFindTarget {
  return {
    matches: (query) => findTextMatches("Read here, read there", query),
    highlight: vi.fn(),
    focus: vi.fn(),
    replace: vi.fn(() => "blocked" as const),
  };
}

describe("FindBar reading mode", () => {
  it("keeps query editing, result navigation and close without replacement controls", async () => {
    const target = findTarget();
    render(<FindHarness readOnly target={target} />);
    const input = await screen.findByRole("textbox", { name: "Find in page" });
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Show replace" })).toBeNull();
    fireEvent.change(input, { target: { value: "read" } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1/2"));

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(screen.getByRole("status")).toHaveTextContent("1/2");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("status")).toHaveTextContent("2/2");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.getByRole("status")).toHaveTextContent("1/2");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("search")).toBeNull();
    expect(target.focus).toHaveBeenCalledOnce();
    expect(target.replace).not.toHaveBeenCalled();
  });

  it("collapses existing replacement and errors when entering reading mode, retaining the query", async () => {
    const target = findTarget();
    const { rerender } = render(<FindHarness target={target} />);
    const input = await screen.findByRole("textbox", { name: "Find in page" });
    fireEvent.change(input, { target: { value: "read" } });
    fireEvent.click(await screen.findByRole("button", { name: "Show replace" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), {
      target: { value: "write" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(target.replace).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toBeVisible();

    rerender(<FindHarness readOnly target={target} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Show replace" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input).toHaveValue("read");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(target.replace).toHaveBeenCalledOnce();

    rerender(<FindHarness target={target} />);
    expect(screen.getByRole("button", { name: "Show replace" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("preserves replacement keyboard commands in editing mode", async () => {
    const target = findTarget();
    render(<FindHarness target={target} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Find in page" }), {
      target: { value: "read" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Show replace" }));
    const replacement = screen.getByRole("textbox", { name: "Replace with" });
    fireEvent.change(replacement, { target: { value: "write" } });
    fireEvent.keyDown(replacement, { key: "Enter" });
    expect(target.replace).toHaveBeenLastCalledWith([{ from: 0, to: 4 }], "write");
    fireEvent.keyDown(replacement, { key: "Enter", shiftKey: true });
    expect(target.replace).toHaveBeenLastCalledWith(
      [
        { from: 0, to: 4 },
        { from: 11, to: 15 },
      ],
      "write",
    );
  });
});
