import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppSettingsProvider } from "../../app/settings";
import { EditorContextMenu, type EditorContextMenuActions } from "./EditorContextMenu";

const surfaces: HTMLElement[] = [];

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
});

afterEach(() => {
  surfaces.splice(0).forEach((surface) => surface.remove());
  window.getSelection()?.removeAllRanges();
});

function surface(className: string, html: string) {
  const element = document.createElement("div");
  element.className = className;
  element.setAttribute("contenteditable", "false");
  element.innerHTML = html;
  document.body.append(element);
  surfaces.push(element);
  return element;
}

function menu(target: Element, actions?: EditorContextMenuActions) {
  return render(
    <AppSettingsProvider initialSettings={{ locale: "en-US" }} storage={null}>
      <EditorContextMenu
        actions={actions}
        onClose={vi.fn()}
        open
        position={{ x: 20, y: 20 }}
        readOnly
        target={target}
      />
    </AppSettingsProvider>,
  );
}

describe("reading context menu", () => {
  it.each(["ProseMirror", "cm-content"])(
    "keeps working copy and select all on a noneditable %s surface",
    async (className) => {
      const document = surface(className, "<p>Readable document</p>");
      const paragraph = document.querySelector("p")!;
      const range = window.document.createRange();
      range.selectNodeContents(paragraph);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      menu(paragraph);

      expect(screen.getAllByRole("menuitem")).toHaveLength(2);
      fireEvent.click(screen.getByRole("menuitem", { name: /^Copy/ }));
      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Readable document"),
      );
      window.getSelection()?.collapse(paragraph.firstChild, 0);
      fireEvent.click(screen.getByRole("menuitem", { name: /^Select All/ }));
      await waitFor(() =>
        expect(window.getSelection()?.toString()).toBe("Readable document"),
      );
      expect(document.textContent).toBe("Readable document");
    },
  );

  it("retains link navigation and address copying inside tables without table or formatting actions", async () => {
    const document = surface(
      "ProseMirror",
      '<table><tbody><tr><td><a href="./guide.md#intro">Guide</a></td></tr></tbody></table>',
    );
    const openLink = vi.fn();
    const openLinkNewTab = vi.fn();
    const copyLink = vi.fn();
    menu(document.querySelector("a")!, { openLink, openLinkNewTab, copyLink });

    expect(screen.getAllByRole("menuitem")).toHaveLength(5);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open Link" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open Link in New Tab" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy Link" }));
    await waitFor(() => {
      expect(openLink).toHaveBeenCalledOnce();
      expect(openLinkNewTab).toHaveBeenCalledOnce();
      expect(copyLink).toHaveBeenCalledOnce();
    });
    expect(screen.queryByRole("menuitem", { name: "Table" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Paragraph" })).toBeNull();
  });

  it("keeps image reading and copying actions while hiding reference editing", async () => {
    const document = surface(
      "ProseMirror",
      '<img src="asset://localhost/fixtures/picture.png" data-visual-image-reference="./picture.png" data-visual-image-document="/fixtures/guide.md">',
    );
    const previewImage = vi.fn();
    const copyImage = vi.fn();
    const revealImage = vi.fn();
    menu(document.querySelector("img")!, { previewImage, copyImage, revealImage });

    expect(screen.getAllByRole("menuitem")).toHaveLength(5);
    expect(screen.queryByRole("menuitem", { name: "Edit Image Reference…" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Preview Image" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy Image" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy Image Address" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reveal Image in File Manager" }));
    await waitFor(() => {
      expect(previewImage).toHaveBeenCalledOnce();
      expect(copyImage).toHaveBeenCalledOnce();
      expect(revealImage).toHaveBeenCalledOnce();
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("./picture.png");
    });
  });

  it("keeps diagram preview while hiding Mermaid source editing", async () => {
    const document = surface(
      "ProseMirror",
      '<div class="milkdown-code-block"><div class="codemirror-host"></div><section class="visual-mermaid-preview"><svg><text>Diagram</text></svg><button data-visual-mermaid-id="demo">Zoom</button></section></div>',
    );
    const previewImage = vi.fn();
    menu(document.querySelector("text")!, { previewImage });

    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("menuitem", { name: "Preview Diagram" }));
    await waitFor(() => expect(previewImage).toHaveBeenCalledOnce());
  });
});
