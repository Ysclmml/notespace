import { fireEvent, render, screen } from "@testing-library/react";
import { type MouseEventHandler } from "react";
import { createPortal } from "react-dom";
import { describe, expect, it, vi } from "vitest";

import { useNativeContextMenuPolicy } from "./useNativeContextMenuPolicy";

function PolicyHarness({
  confirmationPending = false,
  onContextMenu,
}: {
  readonly confirmationPending?: boolean;
  readonly onContextMenu?: MouseEventHandler<HTMLDivElement>;
}) {
  useNativeContextMenuPolicy(confirmationPending);
  return (
    <div onContextMenu={onContextMenu}>
      <header data-native-context-menu="true">
        <button type="button">
          <span data-testid="topbar">toolbar</span>
        </button>
        <div role="menu">
          <button data-testid="topbar-menu" role="menuitem" type="button">
            menu action
          </button>
        </div>
        <div role="dialog">
          <span data-testid="topbar-dialog">dialog content</span>
        </div>
        <div role="alertdialog">
          <span data-testid="topbar-alertdialog">confirmation content</span>
        </div>
      </header>
      <aside data-testid="chrome">sidebar</aside>
      <button data-testid="tab" type="button">
        document tab
      </button>
      <main data-testid="content">document content</main>
      {createPortal(<div data-testid="portal">portal content</div>, document.body)}
    </div>
  );
}

function contextMenu(target: Node): MouseEvent {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  fireEvent(target, event);
  return event;
}

describe("useNativeContextMenuPolicy", () => {
  it("blocks the browser menu on ordinary chrome, document content, body, and portals", () => {
    render(<PolicyHarness />);

    for (const target of [
      document.body,
      screen.getByTestId("chrome"),
      screen.getByTestId("tab"),
      screen.getByTestId("content"),
      screen.getByTestId("portal"),
    ]) {
      expect(contextMenu(target).defaultPrevented).toBe(true);
    }
  });

  it("allows the browser menu only within the explicitly marked toolbar", () => {
    render(<PolicyHarness />);

    const toolbar = screen.getByTestId("topbar");
    expect(contextMenu(toolbar).defaultPrevented).toBe(false);
    expect(contextMenu(toolbar.firstChild!).defaultPrevented).toBe(false);
  });

  it.each(["menu", "dialog", "alertdialog"])(
    "blocks a %s nested within the otherwise allowed toolbar",
    (role) => {
      render(<PolicyHarness />);

      expect(contextMenu(screen.getByTestId(`topbar-${role}`)).defaultPrevented).toBe(true);
    },
  );

  it("blocks the toolbar too while a confirmation is pending", () => {
    render(<PolicyHarness confirmationPending />);

    expect(contextMenu(screen.getByTestId("topbar")).defaultPrevented).toBe(true);
  });

  it("keeps custom bubbling handlers working after cancelling the browser menu", () => {
    const onContextMenu = vi.fn<MouseEventHandler<HTMLDivElement>>();
    render(<PolicyHarness onContextMenu={onContextMenu} />);

    contextMenu(screen.getByTestId("content"));
    contextMenu(screen.getByTestId("portal"));

    expect(onContextMenu).toHaveBeenCalledTimes(2);
    for (const [event] of onContextMenu.mock.calls) {
      expect(event.defaultPrevented).toBe(true);
      expect(event.isPropagationStopped()).toBe(false);
    }
  });

  it("updates the confirmation policy when its prop changes", () => {
    const { rerender } = render(<PolicyHarness />);
    expect(contextMenu(screen.getByTestId("topbar")).defaultPrevented).toBe(false);

    rerender(<PolicyHarness confirmationPending />);
    expect(contextMenu(screen.getByTestId("topbar")).defaultPrevented).toBe(true);

    rerender(<PolicyHarness confirmationPending={false} />);
    expect(contextMenu(screen.getByTestId("topbar")).defaultPrevented).toBe(false);
  });

  it("removes the document capture listener on unmount", () => {
    const { unmount } = render(<PolicyHarness />);
    expect(contextMenu(document.body).defaultPrevented).toBe(true);

    unmount();

    expect(contextMenu(document.body).defaultPrevented).toBe(false);
  });
});
