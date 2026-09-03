import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EditorGroupTabs,
  TAB_DRAG_MIME,
  type EditorGroupTabsProps,
} from "./EditorGroupTabs";

const labels: EditorGroupTabsProps["labels"] = {
  rail: "Document tabs",
  start: "Start writing",
  newTab: "New tab",
  unsaved: "Unsaved changes",
  closeTab: (name) => `Close ${name}`,
  tabActions: "Tab actions",
  splitRight: "Split right",
  moveTo: (label) => `Move to ${label}`,
  keepOpen: "Keep open",
  close: "Close tab",
};

function props(overrides: Partial<EditorGroupTabsProps> = {}): EditorGroupTabsProps {
  return {
    groupId: "main",
    tabs: [
      { id: "a", path: "/notes/alpha.md", dirty: true, preview: false },
      { id: "b", path: "C:\\notes\\beta.py", dirty: false, preview: true },
      { id: "c", path: "/notes/gamma.json", dirty: false, preview: false },
    ],
    activeTabId: "a",
    focused: true,
    destinations: [
      { id: "main", label: "Main" },
      { id: "right", label: "Right" },
    ],
    draggedTabId: null,
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onNew: vi.fn(),
    onSplitRight: vi.fn(),
    onMove: vi.fn(),
    onKeepOpen: vi.fn(),
    onDragTabChange: vi.fn(),
    labels,
    ...overrides,
  };
}

function transfer(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get types() {
      return Array.from(data.keys());
    },
    getData: vi.fn((type: string) => data.get(type) ?? ""),
    setData: vi.fn((type: string, value: string) => {
      data.set(type, value);
    }),
    dropEffect: "none",
    effectAllowed: "uninitialized",
  };
}

function drag(
  target: Element,
  type: "dragStart" | "dragOver" | "drop" | "dragEnd" | "dragLeave",
  dataTransfer: ReturnType<typeof transfer>,
  clientX = 0,
) {
  const event = createEvent[type](target, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientX: { value: clientX },
  });
  fireEvent(target, event);
  return event;
}

function row(name: string): HTMLElement {
  return screen.getByTitle(name).closest(".tab-rail__item") as HTMLElement;
}

describe("EditorGroupTabs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders local active state, basenames, dirty status, and independent actions", () => {
    const input = props();
    const { rerender } = render(<EditorGroupTabs {...input} />);
    const rail = screen.getByRole("navigation", { name: labels.rail });
    expect(rail).toHaveClass("editor-group-tabs--focused");
    expect(screen.getByTitle("/notes/alpha.md")).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText(labels.unsaved)).toBeVisible();
    expect(screen.getByTitle("C:\\notes\\beta.py")).toHaveTextContent("beta.py");
    expect(row("C:\\notes\\beta.py")).toHaveClass("tab-rail__item--preview");

    fireEvent.click(screen.getByTitle("C:\\notes\\beta.py"));
    expect(input.onActivate).toHaveBeenCalledExactlyOnceWith("b");
    fireEvent.click(screen.getByRole("button", { name: "Close beta.py" }));
    expect(input.onClose).toHaveBeenCalledExactlyOnceWith("b");
    expect(input.onActivate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: labels.newTab }));
    expect(input.onNew).toHaveBeenCalledOnce();

    rerender(<EditorGroupTabs {...input} focused={false} activeTabId="b" />);
    expect(rail).not.toHaveClass("editor-group-tabs--focused");
    expect(screen.getByTitle("C:\\notes\\beta.py")).toHaveAttribute("aria-current", "page");
  });

  it("keeps preview tabs open on double-click and through the localized menu", () => {
    const input = props();
    render(<EditorGroupTabs {...input} />);
    const preview = screen.getByTitle("C:\\notes\\beta.py");
    fireEvent.doubleClick(preview);
    expect(input.onKeepOpen).toHaveBeenCalledExactlyOnceWith("b");
    fireEvent.contextMenu(preview, { clientX: 30, clientY: 30 });
    fireEvent.click(screen.getByRole("menuitem", { name: labels.keepOpen }));
    expect(input.onKeepOpen).toHaveBeenCalledTimes(2);
    fireEvent.contextMenu(screen.getByTitle("/notes/alpha.md"), {
      clientX: 30,
      clientY: 30,
    });
    expect(
      screen.queryByRole("menuitem", { name: labels.keepOpen }),
    ).not.toBeInTheDocument();
  });

  it("does not activate on secondary clicks and directs menu actions to the clicked tab", () => {
    const input = props();
    render(<EditorGroupTabs {...input} />);
    const target = screen.getByTitle("C:\\notes\\beta.py");
    expect(fireEvent.mouseDown(target, { button: 2 })).toBe(false);
    fireEvent.click(target, { button: 2 });
    fireEvent.click(target, { ctrlKey: true });
    fireEvent.contextMenu(target, { clientX: 30, clientY: 30 });
    expect(input.onActivate).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("menuitem", { name: "Move to Main" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: labels.splitRight }));
    expect(input.onSplitRight).toHaveBeenCalledExactlyOnceWith("b");

    fireEvent.contextMenu(target, { clientX: 30, clientY: 30 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to Right" }));
    expect(input.onMove).toHaveBeenCalledExactlyOnceWith("b", "right");
    fireEvent.contextMenu(target, { clientX: 30, clientY: 30 });
    fireEvent.click(screen.getByRole("menuitem", { name: labels.close }));
    expect(input.onClose).toHaveBeenCalledExactlyOnceWith("b");
    expect(input.onActivate).not.toHaveBeenCalled();
  });

  it("portals the compact menu, clamps measured bounds, and returns keyboard focus", () => {
    const bounds = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("editor-group-tab-menu")
        ? new DOMRect(0, 0, 220, 180)
        : bounds.call(this);
    });
    const { container } = render(<EditorGroupTabs {...props()} />);
    const target = screen.getByTitle("C:\\notes\\beta.py");
    fireEvent.contextMenu(target, {
      clientX: window.innerWidth - 1,
      clientY: window.innerHeight - 1,
    });
    const menu = screen.getByRole("menu", { name: labels.tabActions });
    expect(container).not.toContainElement(menu);
    expect(menu).toHaveStyle({
      left: `${window.innerWidth - 228}px`,
      top: `${window.innerHeight - 188}px`,
    });
    expect(menu).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: labels.keepOpen })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    expect(screen.getByRole("menuitem", { name: labels.close })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: labels.close })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(target).toHaveFocus();

    fireEvent.contextMenu(target);
    expect(screen.getByRole("menuitem", { name: labels.keepOpen })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("dismisses its menu when another surface is clicked, scrolled, or opens a menu", () => {
    const { rerender } = render(<EditorGroupTabs {...props()} />);
    const target = screen.getByTitle("C:\\notes\\beta.py");
    for (const dismiss of [
      () => fireEvent.pointerDown(document.body),
      () => fireEvent.scroll(document.body),
      () => fireEvent.contextMenu(document.body),
      () => fireEvent.resize(window),
    ]) {
      fireEvent.contextMenu(target, { clientX: 30, clientY: 30 });
      dismiss();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    }
    fireEvent.contextMenu(target, { clientX: 30, clientY: 30 });
    rerender(<EditorGroupTabs {...props({ tabs: [] })} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    rerender(<EditorGroupTabs {...props()} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("starts internal moves without activating the dragged tab and clears native cancellation", () => {
    const input = props();
    const { rerender } = render(<EditorGroupTabs {...input} />);
    const target = row("C:\\notes\\beta.py");
    const data = transfer();
    drag(target, "dragStart", data);
    expect(data.setData).toHaveBeenCalledExactlyOnceWith(TAB_DRAG_MIME, "b");
    expect(data.effectAllowed).toBe("move");
    expect(input.onDragTabChange).toHaveBeenCalledExactlyOnceWith("b");
    expect(input.onActivate).not.toHaveBeenCalled();

    rerender(<EditorGroupTabs {...input} draggedTabId="b" />);
    expect(target).toHaveClass("tab-rail__item--dragging");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(input.onDragTabChange).toHaveBeenLastCalledWith(null);
    drag(target, "dragEnd", data);
    expect(input.onDragTabChange).toHaveBeenLastCalledWith(null);
  });

  it("moves before or after hovered tabs and appends after the last tab", () => {
    const input = props({ draggedTabId: "remote-tab" });
    render(<EditorGroupTabs {...input} />);
    const target = row("C:\\notes\\beta.py");
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 0, 200, 38));
    const data = transfer({ [TAB_DRAG_MIME]: "remote-tab" });
    expect(drag(target, "dragOver", data, 120).defaultPrevented).toBe(true);
    expect(data.dropEffect).toBe("move");
    expect(target).toHaveClass("tab-rail__item--drop-before");
    drag(target, "drop", data, 120);
    expect(input.onMove).toHaveBeenLastCalledWith("remote-tab", "main", "b");
    expect(input.onDragTabChange).toHaveBeenLastCalledWith(null);

    drag(target, "dragOver", data, 270);
    expect(target).toHaveClass("tab-rail__item--drop-after");
    drag(target, "drop", data, 270);
    expect(input.onMove).toHaveBeenLastCalledWith("remote-tab", "main", "c");
    const last = row("/notes/gamma.json");
    vi.spyOn(last, "getBoundingClientRect").mockReturnValue(new DOMRect(300, 0, 200, 38));
    drag(last, "drop", data, 490);
    expect(input.onMove).toHaveBeenLastCalledWith("remote-tab", "main", undefined);
  });

  it("supports same-group sorting and dropping onto an empty group's rail", () => {
    const input = props({ draggedTabId: "a" });
    const { rerender } = render(<EditorGroupTabs {...input} />);
    const data = transfer({ [TAB_DRAG_MIME]: "a" });
    drag(row("C:\\notes\\beta.py"), "drop", data, 500);
    expect(input.onMove).toHaveBeenLastCalledWith("a", "main", "c");

    rerender(<EditorGroupTabs {...input} groupId="empty" tabs={[]} activeTabId={null} />);
    const rail = screen.getByRole("navigation", { name: labels.rail });
    expect(screen.getByText(labels.start)).toBeVisible();
    drag(rail, "dragOver", data);
    expect(rail).toHaveClass("editor-group-tabs--drop-append");
    drag(rail, "drop", data);
    expect(input.onMove).toHaveBeenLastCalledWith("a", "empty", undefined);
  });

  it("does not intercept file/text drags, untrusted custom payloads, or inactive drags", () => {
    const input = props({ draggedTabId: "a" });
    const { rerender } = render(<EditorGroupTabs {...input} />);
    const rail = screen.getByRole("navigation", { name: labels.rail });
    for (const data of [
      transfer({ "text/plain": "external" }),
      transfer({ Files: "" }),
      transfer({ [TAB_DRAG_MIME]: "a", Files: "" }),
    ]) {
      expect(drag(rail, "dragOver", data).defaultPrevented).toBe(false);
      expect(drag(rail, "drop", data).defaultPrevented).toBe(false);
    }
    expect(
      drag(rail, "drop", transfer({ [TAB_DRAG_MIME]: "other-window" })).defaultPrevented,
    ).toBe(false);
    rerender(<EditorGroupTabs {...input} draggedTabId={null} />);
    const data = transfer({ [TAB_DRAG_MIME]: "a" });
    expect(drag(rail, "dragOver", data).defaultPrevented).toBe(false);
    expect(drag(rail, "drop", data).defaultPrevented).toBe(false);
    expect(input.onMove).not.toHaveBeenCalled();
    expect(input.onDragTabChange).not.toHaveBeenCalled();
  });

  it("clears another group's drop indicator after cancellation before the next drag", () => {
    const input = props({ draggedTabId: "remote-tab" });
    const { rerender } = render(<EditorGroupTabs {...input} />);
    const rail = screen.getByRole("navigation", { name: labels.rail });
    drag(rail, "dragOver", transfer({ [TAB_DRAG_MIME]: "remote-tab" }));
    expect(rail).toHaveClass("editor-group-tabs--drop-append");
    rerender(<EditorGroupTabs {...input} draggedTabId={null} />);
    rerender(<EditorGroupTabs {...input} draggedTabId="a" />);
    expect(rail).not.toHaveClass("editor-group-tabs--drop-append");
  });
});
