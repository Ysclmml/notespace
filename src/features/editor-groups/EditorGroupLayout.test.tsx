import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createViewState, type Tab } from "../../app/state";
import { EditorGroupLayout } from "./EditorGroupLayout";
import { TAB_DRAG_MIME } from "./EditorGroupTabs";

type LayoutProps = ComponentProps<typeof EditorGroupLayout>;

function tab(id: string): Tab {
  return {
    id,
    preview: false,
    current: { documentId: id, path: `/notes/${id}.md`, view: createViewState() },
    back: [],
    forward: [],
  };
}

const a = tab("a");
const b = tab("b");
const c = tab("c");
const d = tab("d");

function props(overrides: Partial<LayoutProps> = {}): LayoutProps {
  return {
    groups: [
      { id: "left", tabs: [a, b], activeTab: a },
      { id: "right", tabs: [c], activeTab: c },
    ],
    focusedGroupId: "left",
    draggedTabId: null,
    groupLabel: (index) => `Group ${index}`,
    resizeLabel: (index) => `Resize groups ${index}`,
    dropLabel: "Move here",
    onActivateGroup: vi.fn(),
    onMoveTab: vi.fn(),
    onDragTabChange: vi.fn(),
    renderTabs: (group) => (
      <nav aria-label={`Tabs ${group.id}`}>
        {group.tabs.map((entry) => entry.id).join(", ")}
      </nav>
    ),
    renderTab: (entry, focused) => (
      <input
        aria-label={`Editor ${entry.id}`}
        data-focused={focused}
        defaultValue={entry.id}
      />
    ),
    renderEmpty: (id) => <span>Empty {id}</span>,
    ...overrides,
  };
}

function transfer(initial: Record<string, string>) {
  return {
    types: Object.keys(initial),
    getData: vi.fn((type: string) => initial[type] ?? ""),
    dropEffect: "none",
  };
}

function drag(
  target: Element,
  type: "dragEnter" | "dragOver" | "dragLeave" | "drop",
  dataTransfer: ReturnType<typeof transfer>,
) {
  const event = createEvent[type](target, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  fireEvent(target, event);
  return event;
}

function pointer(
  target: Element,
  type:
    "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel" | "lostPointerCapture",
  values: { pointerId?: number; clientX?: number; button?: number; ctrlKey?: boolean } = {},
) {
  const event = createEvent[type](target, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: values.pointerId ?? 1 },
    clientX: { value: values.clientX ?? 400 },
    button: { value: values.button ?? 0 },
    ctrlKey: { value: values.ctrlKey ?? false },
  });
  fireEvent(target, event);
  return event;
}

function measureHeaders(container: HTMLElement) {
  for (const header of container.querySelectorAll<HTMLElement>(".editor-group-header")) {
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 40));
  }
}

function mockHorizontalGeometry(viewportWidth = 392, groupWidth = 280) {
  const geometry = { viewportWidth, groupWidth };
  const headers = (element: Element) =>
    Array.from(element.querySelectorAll<HTMLElement>(".editor-group-header"));
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (
    this: Element,
  ) {
    return this.classList.contains("editor-groups") ? geometry.viewportWidth : 0;
  });
  vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (
    this: Element,
  ) {
    if (!this.classList.contains("editor-groups")) return 0;
    const count = headers(this).length;
    return Math.max(
      geometry.viewportWidth,
      count * geometry.groupWidth + Math.max(0, count - 1) * 6,
    );
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    if (this.classList.contains("editor-groups")) {
      return new DOMRect(248, 80, geometry.viewportWidth, 440);
    }
    const parent = this.parentElement;
    if (parent && this.classList.contains("editor-group-header")) {
      const index = headers(parent).indexOf(this as HTMLElement);
      return new DOMRect(
        248 + index * (geometry.groupWidth + 6) - parent.scrollLeft,
        80,
        geometry.groupWidth,
        40,
      );
    }
    return new DOMRect();
  });
  return geometry;
}

function EditorProbe({
  id,
  onMount,
  onUnmount,
}: {
  readonly id: string;
  readonly onMount: (id: string) => void;
  readonly onUnmount: (id: string) => void;
}) {
  useEffect(() => {
    onMount(id);
    return () => onUnmount(id);
  }, [id, onMount, onUnmount]);
  return <input aria-label={`Probe ${id}`} defaultValue={id} />;
}

describe("EditorGroupLayout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("minimally reveals newly focused columns without scrolling the page or editor", () => {
    mockHorizontalGeometry();
    const input = props();
    const { container, rerender } = render(<EditorGroupLayout {...input} />);
    const viewport = container.firstElementChild as HTMLElement;
    const firstEditor = screen.getByRole("textbox", { name: "Editor a" });
    const firstPanel = screen.getByRole("region", { name: "Group 1" });
    firstEditor.focus();
    firstPanel.scrollTop = 125;
    viewport.scrollTop = 17;
    container.scrollTop = 93;
    const three = [...input.groups, { id: "third", tabs: [d], activeTab: d }];

    rerender(<EditorGroupLayout {...input} groups={three} focusedGroupId="third" />);
    expect(viewport.scrollLeft).toBe(460);
    expect(firstPanel.scrollTop).toBe(125);
    expect(viewport.scrollTop).toBe(17);
    expect(container.scrollTop).toBe(93);
    expect(firstEditor).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Editor a" })).toBe(firstEditor);

    rerender(<EditorGroupLayout {...input} groups={three} focusedGroupId="right" />);
    expect(viewport.scrollLeft).toBe(286);
    rerender(<EditorGroupLayout {...input} groups={three} focusedGroupId="left" />);
    expect(viewport.scrollLeft).toBe(0);
    rerender(<EditorGroupLayout {...input} groups={three} focusedGroupId="right" />);
    expect(viewport.scrollLeft).toBe(174);
  });

  it("follows layout changes but preserves manual horizontal scrolling during unrelated updates", () => {
    mockHorizontalGeometry();
    const input = props({ focusedGroupId: "right" });
    const { container, rerender } = render(<EditorGroupLayout {...input} />);
    const viewport = container.firstElementChild as HTMLElement;
    expect(viewport.scrollLeft).toBe(174);
    const reordered = [
      input.groups[0]!,
      { id: "third", tabs: [d], activeTab: d },
      input.groups[1]!,
    ];
    rerender(<EditorGroupLayout {...input} groups={reordered} />);
    expect(viewport.scrollLeft).toBe(460);

    viewport.scrollLeft = 0;
    rerender(
      <EditorGroupLayout
        {...input}
        groups={reordered.map((group) => ({ ...group, tabs: [...group.tabs] }))}
        renderTab={(entry) => (
          <input aria-label={`Editor ${entry.id}`} defaultValue="edited" />
        )}
      />,
    );
    fireEvent.resize(window);
    expect(viewport.scrollLeft).toBe(0);
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize groups 1" }), {
      key: "ArrowRight",
    });
    expect(viewport.scrollLeft).toBe(0);
  });

  it("reveals the active group when its viewport narrows, but not on unchanged or expanding sizes", () => {
    const geometry = mockHorizontalGeometry(900);
    let notifyResize = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          notifyResize = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const input = props();
    const { container, unmount } = render(
      <EditorGroupLayout
        {...input}
        groups={[...input.groups, { id: "third", tabs: [d], activeTab: d }]}
        focusedGroupId="third"
      />,
    );
    const viewport = container.firstElementChild as HTMLElement;
    expect(observe).toHaveBeenCalledExactlyOnceWith(viewport);
    expect(viewport.scrollLeft).toBe(0);
    geometry.viewportWidth = 392;
    notifyResize();
    expect(viewport.scrollLeft).toBe(460);

    viewport.scrollLeft = 100;
    notifyResize();
    expect(viewport.scrollLeft).toBe(100);
    geometry.viewportWidth = 900;
    notifyResize();
    expect(viewport.scrollLeft).toBe(100);
    geometry.viewportWidth = 360;
    fireEvent.resize(window);
    expect(viewport.scrollLeft).toBe(492);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("aligns an oversized group to its start when the viewport first becomes measurable", () => {
    const geometry = mockHorizontalGeometry(0);
    const input = props({ focusedGroupId: "right" });
    const { container } = render(<EditorGroupLayout {...input} />);
    const viewport = container.firstElementChild as HTMLElement;
    expect(viewport.scrollLeft).toBe(0);
    geometry.viewportWidth = 200;
    fireEvent.resize(window);
    expect(viewport.scrollLeft).toBe(286);
  });

  it("renders only each group's active editor in two or three horizontal columns", () => {
    const input = props();
    const { container, rerender } = render(<EditorGroupLayout {...input} />);
    expect(screen.getAllByRole("region")).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "Editor a" })).toHaveAttribute(
      "data-focused",
      "true",
    );
    expect(screen.getByRole("textbox", { name: "Editor c" })).toHaveAttribute(
      "data-focused",
      "false",
    );
    expect(screen.queryByRole("textbox", { name: "Editor b" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Group 1" })).toHaveStyle({
      gridColumn: "1",
    });
    expect(screen.getByRole("region", { name: "Group 2" })).toHaveStyle({
      gridColumn: "3",
    });
    expect(screen.getByRole("separator")).toHaveAttribute("aria-orientation", "vertical");
    expect(container.firstElementChild).toHaveStyle({
      gridTemplateColumns: "minmax(280px, 1fr) 6px minmax(280px, 1fr)",
    });

    rerender(
      <EditorGroupLayout
        {...input}
        groups={[...input.groups, { id: "third", tabs: [d], activeTab: d }]}
        focusedGroupId="third"
      />,
    );
    expect(screen.getAllByRole("region")).toHaveLength(3);
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Group 3" })).toHaveStyle({
      gridColumn: "5",
    });
    expect(screen.getByRole("textbox", { name: "Editor d" })).toHaveAttribute(
      "data-focused",
      "true",
    );
    expect(screen.queryByRole("textbox", { name: "Editor b" })).not.toBeInTheDocument();
  });

  it("preserves a visible editor instance and its local input while moving it to another column", () => {
    const onMount = vi.fn();
    const onUnmount = vi.fn();
    const input = props({
      renderTab: (entry) => (
        <EditorProbe id={entry.id} onMount={onMount} onUnmount={onUnmount} />
      ),
    });
    const { container, rerender } = render(<EditorGroupLayout {...input} />);
    const original = screen.getByRole("textbox", { name: "Probe a" });
    fireEvent.change(original, { target: { value: "uncommitted local editor state" } });
    const moved: LayoutProps["groups"] = [
      { id: "left", tabs: [b], activeTab: b },
      { id: "right", tabs: [c], activeTab: c },
      { id: "third", tabs: [a, d], activeTab: a },
    ];
    rerender(<EditorGroupLayout {...input} groups={moved} focusedGroupId="third" />);
    expect(screen.getByRole("textbox", { name: "Probe a" })).toBe(original);
    expect(original).toHaveValue("uncommitted local editor state");
    expect(original.closest("section")).toHaveStyle({ gridColumn: "5" });
    expect(onMount.mock.calls.filter(([id]) => id === "a")).toHaveLength(1);
    expect(onUnmount).not.toHaveBeenCalled();

    measureHeaders(container);
    const divider = screen.getByRole("separator", { name: "Resize groups 1" });
    pointer(divider, "pointerDown");
    pointer(divider, "pointerMove", { clientX: 500 });
    pointer(divider, "pointerUp");
    expect(screen.getByRole("textbox", { name: "Probe a" })).toBe(original);
    expect(onMount).toHaveBeenCalledTimes(3);
    expect(onUnmount).not.toHaveBeenCalled();
  });

  it("moves an internal tab to a content area and supports empty groups", () => {
    const input = props({ draggedTabId: "a" });
    const { rerender } = render(<EditorGroupLayout {...input} />);
    const target = screen.getByRole("region", { name: "Group 2" });
    const data = transfer({ [TAB_DRAG_MIME]: "a" });
    expect(drag(target, "dragEnter", data).defaultPrevented).toBe(true);
    expect(target).toHaveClass("editor-tab-panel--drop-target");
    expect(screen.getByText("Move here")).toBeVisible();
    expect(drag(target, "dragOver", data).defaultPrevented).toBe(true);
    expect(data.dropEffect).toBe("move");
    expect(drag(target, "drop", data).defaultPrevented).toBe(true);
    expect(input.onMoveTab).toHaveBeenCalledExactlyOnceWith("a", "right");
    expect(input.onDragTabChange).toHaveBeenCalledExactlyOnceWith(null);
    expect(target).not.toHaveClass("editor-tab-panel--drop-target");

    rerender(
      <EditorGroupLayout
        {...input}
        groups={[{ id: "empty", tabs: [], activeTab: undefined }]}
      />,
    );
    expect(screen.getByText("Empty empty")).toBeVisible();
    drag(screen.getByRole("region", { name: "Group 1" }), "drop", data);
    expect(input.onMoveTab).toHaveBeenLastCalledWith("a", "empty");
  });

  it("leaves external files and text untouched and rejects mismatched internal payloads", () => {
    const input = props({ draggedTabId: "a" });
    const { rerender } = render(<EditorGroupLayout {...input} />);
    const target = screen.getByRole("region", { name: "Group 2" });
    for (const data of [
      transfer({ Files: "" }),
      transfer({ "text/plain": "external" }),
      transfer({ [TAB_DRAG_MIME]: "a", Files: "" }),
    ]) {
      expect(drag(target, "dragEnter", data).defaultPrevented).toBe(false);
      expect(drag(target, "dragOver", data).defaultPrevented).toBe(false);
      expect(drag(target, "drop", data).defaultPrevented).toBe(false);
    }
    expect(
      drag(target, "drop", transfer({ [TAB_DRAG_MIME]: "another-window" }))
        .defaultPrevented,
    ).toBe(false);
    rerender(<EditorGroupLayout {...input} draggedTabId={null} />);
    expect(drag(target, "drop", transfer({ [TAB_DRAG_MIME]: "a" })).defaultPrevented).toBe(
      false,
    );
    expect(input.onMoveTab).not.toHaveBeenCalled();
    expect(input.onDragTabChange).not.toHaveBeenCalled();
  });

  it("clears old content drop feedback when a drag is canceled", () => {
    const input = props({ draggedTabId: "a" });
    const { rerender } = render(<EditorGroupLayout {...input} />);
    const target = screen.getByRole("region", { name: "Group 2" });
    drag(target, "dragEnter", transfer({ [TAB_DRAG_MIME]: "a" }));
    expect(target).toHaveClass("editor-tab-panel--drop-target");
    rerender(<EditorGroupLayout {...input} draggedTabId={null} />);
    rerender(<EditorGroupLayout {...input} draggedTabId="b" />);
    expect(target).not.toHaveClass("editor-tab-panel--drop-target");
    expect(screen.queryByText("Move here")).not.toBeInTheDocument();
  });

  it("activates the focused content group on a primary pointer or keyboard focus, not a secondary pointer", () => {
    const input = props();
    render(<EditorGroupLayout {...input} />);
    const target = screen.getByRole("textbox", { name: "Editor c" });
    pointer(target, "pointerDown", { button: 2 });
    pointer(target, "pointerDown", { ctrlKey: true });
    expect(input.onActivateGroup).not.toHaveBeenCalled();
    pointer(target, "pointerDown");
    expect(input.onActivateGroup).toHaveBeenCalledExactlyOnceWith("right");
    fireEvent.focus(target);
    expect(input.onActivateGroup).toHaveBeenLastCalledWith("right");
    fireEvent.focus(screen.getByRole("textbox", { name: "Editor a" }));
    expect(input.onActivateGroup).toHaveBeenLastCalledWith("left");
  });

  it("resizes only the adjacent columns with pointer capture and 280px minimums", () => {
    const input = props();
    const { container } = render(
      <EditorGroupLayout
        {...input}
        groups={[...input.groups, { id: "third", tabs: [d], activeTab: d }]}
      />,
    );
    measureHeaders(container);
    const divider = screen.getByRole("separator", { name: "Resize groups 1" });
    const capture = vi.fn();
    const release = vi.fn();
    Object.defineProperties(divider, {
      setPointerCapture: { value: capture },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: release },
    });
    expect(pointer(divider, "pointerDown").defaultPrevented).toBe(true);
    expect(capture).toHaveBeenCalledExactlyOnceWith(1);
    expect(container.firstElementChild).toHaveClass("editor-groups--resizing");
    pointer(divider, "pointerMove", { pointerId: 2, clientX: 500 });
    expect(divider).toHaveAttribute("aria-valuenow", "50");
    pointer(divider, "pointerMove", { clientX: 500 });
    expect(divider).toHaveAttribute("aria-valuenow", "63");
    expect(container.firstElementChild).toHaveStyle({
      gridTemplateColumns:
        "minmax(280px, 1.25fr) 6px minmax(280px, 0.75fr) 6px minmax(280px, 1fr)",
    });
    pointer(divider, "pointerMove", { clientX: 10000 });
    expect(divider).toHaveAttribute("aria-valuenow", "65");
    pointer(divider, "pointerMove", { clientX: -10000 });
    expect(divider).toHaveAttribute("aria-valuenow", "35");
    pointer(divider, "pointerUp");
    expect(release).toHaveBeenCalledExactlyOnceWith(1);
    expect(container.firstElementChild).not.toHaveClass("editor-groups--resizing");
    pointer(divider, "pointerMove", { clientX: 500 });
    expect(divider).toHaveAttribute("aria-valuenow", "35");
  });

  it("supports separator keyboard adjustments and reset without bypassing minimum widths", () => {
    const { container } = render(<EditorGroupLayout {...props()} />);
    measureHeaders(container);
    const divider = screen.getByRole("separator");
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(divider).toHaveAttribute("aria-valuenow", "54");
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider).toHaveAttribute("aria-valuenow", "50");
    fireEvent.keyDown(divider, { key: "Home" });
    expect(divider).toHaveAttribute("aria-valuenow", "35");
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider).toHaveAttribute("aria-valuenow", "35");
    fireEvent.keyDown(divider, { key: "End" });
    expect(divider).toHaveAttribute("aria-valuenow", "65");
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(divider).toHaveAttribute("aria-valuenow", "65");
    fireEvent.keyDown(divider, { key: "Enter" });
    expect(divider).toHaveAttribute("aria-valuenow", "50");
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    fireEvent.doubleClick(divider);
    expect(divider).toHaveAttribute("aria-valuenow", "50");
  });

  it("does not start a resize on secondary pointers and ends canceled or lost captures", () => {
    const { container } = render(<EditorGroupLayout {...props()} />);
    measureHeaders(container);
    const divider = screen.getByRole("separator");
    pointer(divider, "pointerDown", { button: 2 });
    pointer(divider, "pointerDown", { ctrlKey: true });
    expect(container.firstElementChild).not.toHaveClass("editor-groups--resizing");
    pointer(divider, "pointerDown");
    pointer(divider, "pointerCancel");
    expect(container.firstElementChild).not.toHaveClass("editor-groups--resizing");
    pointer(divider, "pointerDown");
    pointer(divider, "lostPointerCapture");
    expect(container.firstElementChild).not.toHaveClass("editor-groups--resizing");
  });
});
