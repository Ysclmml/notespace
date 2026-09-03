import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useEditorContextMenu } from "./useEditorContextMenu";

function ContextMenuHarness() {
  const { contextMenu, onContextMenu, onPointerDownCapture } = useEditorContextMenu();
  return (
    <div
      data-testid="surface"
      onContextMenu={onContextMenu}
      onPointerDownCapture={onPointerDownCapture}
    >
      <span contentEditable data-testid="target" suppressContentEditableWarning>
        code
      </span>
      <span data-testid="non-editor">chrome</span>
      <output data-testid="state">
        {contextMenu.open
          ? `${contextMenu.position.x},${contextMenu.position.y}`
          : "closed"}
      </output>
    </div>
  );
}

function secondaryPointerDown(target: Element, controlClick = false): boolean {
  return fireEvent(
    target,
    new MouseEvent("pointerdown", {
      bubbles: true,
      button: controlClick ? 0 : 2,
      cancelable: true,
      ctrlKey: controlClick,
    }),
  );
}

describe("useEditorContextMenu", () => {
  it("does not cancel pointerdown before opening on the first secondary click", () => {
    render(<ContextMenuHarness />);
    const target = screen.getByTestId("target");

    expect(fireEvent.pointerDown(target, { button: 0 })).toBe(true);
    expect(secondaryPointerDown(target)).toBe(true);
    fireEvent.contextMenu(target, { clientX: 120, clientY: 90 });
    expect(screen.getByTestId("state")).toHaveTextContent("120,90");
  });

  it("treats macOS control-click as a secondary click", () => {
    render(<ContextMenuHarness />);
    const target = screen.getByTestId("target");

    expect(secondaryPointerDown(target, true)).toBe(true);
    fireEvent.contextMenu(target, { clientX: 40, clientY: 55, ctrlKey: true });
    expect(screen.getByTestId("state")).toHaveTextContent("40,55");
  });

  it("restores the existing editor selection after a trackpad secondary click", () => {
    render(<ContextMenuHarness />);
    const target = screen.getByTestId("target");
    const text = target.firstChild;
    if (!text) throw new Error("editable text node is missing");
    const selection = window.getSelection();
    if (!selection) throw new Error("selection API is missing");
    const selectedRange = document.createRange();
    selectedRange.setStart(text, 0);
    selectedRange.setEnd(text, 4);
    selection.removeAllRanges();
    selection.addRange(selectedRange);

    expect(secondaryPointerDown(target)).toBe(true);
    const movedRange = document.createRange();
    movedRange.setStart(text, 4);
    movedRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(movedRange);
    fireEvent.contextMenu(target, { clientX: 75, clientY: 65 });

    expect(screen.getByTestId("state")).toHaveTextContent("75,65");
    expect(window.getSelection()?.toString()).toBe("code");
  });

  it("leaves non-editor chrome to the platform context menu", () => {
    render(<ContextMenuHarness />);

    expect(
      fireEvent.contextMenu(screen.getByTestId("non-editor"), {
        clientX: 12,
        clientY: 18,
      }),
    ).toBe(true);
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
  });
});
