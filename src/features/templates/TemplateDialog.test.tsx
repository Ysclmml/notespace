import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TemplateDialog } from "./TemplateDialog";
import {
  MAX_TEMPLATE_BYTES,
  type DocumentTemplateLibrary,
  type TemplateLibraryAdapter,
} from "./types";

const entry = {
  path: "/synthetic-app/templates/Review.md",
  title: "Review",
  sizeBytes: 20,
};
const catalog: DocumentTemplateLibrary = {
  directoryPath: "/synthetic-app/templates",
  templates: [entry],
  skippedCount: 0,
  truncated: false,
};

function adapter() {
  return {
    list: vi.fn<TemplateLibraryAdapter["list"]>().mockResolvedValue(catalog),
    read: vi
      .fn<TemplateLibraryAdapter["read"]>()
      .mockResolvedValue({ ...entry, markdown: "# Review\n\nFrom disk\n" }),
    save: vi
      .fn<TemplateLibraryAdapter["save"]>()
      .mockImplementation(async (name, content) => ({
        path: `/synthetic-app/templates/${name}.md`,
        title: name,
        sizeBytes: new TextEncoder().encode(content).byteLength,
      })),
    openDirectory: vi
      .fn<TemplateLibraryAdapter["openDirectory"]>()
      .mockResolvedValue(undefined),
  };
}

async function openCustom() {
  fireEvent.click(screen.getByRole("tab", { name: "Custom templates" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
  );
}

describe("template library dialog", () => {
  it("keeps focus trapped while saving disables all controls", async () => {
    const library = adapter();
    let finish!: (value: typeof entry) => void;
    library.save.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(
      <TemplateDialog
        locale="en-US"
        onClose={vi.fn()}
        onSelect={vi.fn()}
        library={library}
        currentMarkdown="draft"
      />,
    );
    await openCustom();
    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "Pending" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();
    for (const shiftKey of [false, true]) {
      expect(fireEvent.keyDown(dialog, { key: "Tab", shiftKey })).toBe(false);
      expect(dialog).toHaveFocus();
    }
    await act(async () => finish(entry));
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(screen.getByRole("tab", { name: "Custom templates" })).toHaveFocus();
  });
  it("does not touch the library for built-ins and makes browser unavailability explicit", () => {
    const library = adapter(),
      onSelect = vi.fn();
    const view = render(
      <TemplateDialog
        locale="en-US"
        onClose={vi.fn()}
        onSelect={onSelect}
        library={library}
      />,
    );
    expect(library.list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Meeting notes/ }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "meeting",
        markdown: expect.stringContaining("# Meeting notes"),
      }),
    );
    view.unmount();
    render(<TemplateDialog locale="en-US" onClose={vi.fn()} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Custom templates" }));
    expect(screen.getByText(/Custom templates require the desktop app/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save template" })).not.toBeInTheDocument();
  });

  it("lists metadata lazily, reads only the chosen file, and uses the current library folder", async () => {
    const library = adapter(),
      onSelect = vi.fn();
    render(
      <TemplateDialog
        locale="en-US"
        onClose={vi.fn()}
        onSelect={onSelect}
        library={library}
      />,
    );
    await openCustom();
    expect(library.list).toHaveBeenCalledTimes(1);
    expect(library.read).not.toHaveBeenCalled();
    expect(screen.getByText(catalog.directoryPath)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Open templates folder" }));
    await waitFor(() =>
      expect(library.openDirectory).toHaveBeenCalledWith(catalog.directoryPath),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Review/ })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({
        id: `custom:${entry.path}`,
        title: "Review",
        description: "Custom templates",
        markdown: "# Review\n\nFrom disk\n",
      }),
    );
    expect(library.read).toHaveBeenCalledWith(entry.path);
    expect(library.save).not.toHaveBeenCalled();
  });

  it("saves the latest supplied draft without selecting a document or overwriting existing templates", async () => {
    const library = adapter(),
      onSelect = vi.fn(),
      onClose = vi.fn();
    const props = { locale: "en-US" as const, onClose, onSelect, library };
    const view = render(<TemplateDialog {...props} currentMarkdown={"# Old snapshot\n"} />);
    await openCustom();
    view.rerender(
      <TemplateDialog
        {...props}
        currentMarkdown={"# Unsaved draft\n\n![diagram](relative.png)\n"}
      />,
    );
    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "New review" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    await screen.findByText(/Saved template “New review”/);
    expect(library.save).toHaveBeenCalledWith(
      "New review",
      "# Unsaved draft\n\n![diagram](relative.png)\n",
    );
    expect(screen.getByRole("button", { name: /New review/ })).toBeVisible();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    library.save.mockRejectedValueOnce({ code: "templateAlreadyExists" });
    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "Review" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "original was not overwritten",
    );
    expect(screen.getByLabelText("Template name")).toHaveValue("Review");
  });

  it("reports incomplete lists, refreshes after external additions, and surfaces read failures", async () => {
    const library = adapter();
    library.list.mockResolvedValueOnce({ ...catalog, skippedCount: 2, truncated: true });
    render(
      <TemplateDialog
        locale="en-US"
        onClose={vi.fn()}
        onSelect={vi.fn()}
        library={library}
      />,
    );
    await openCustom();
    expect(screen.getByText(/Skipped 2/)).toBeVisible();
    expect(screen.getByText(/Showing up to 128/)).toBeVisible();
    library.list.mockResolvedValueOnce({ ...catalog, templates: [] });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText(/No custom templates yet/);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByRole("button", { name: /Review/ });
    library.read.mockRejectedValueOnce({ code: "templateInvalidContent" });
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not valid UTF-8");
  });

  it("recovers from a directory error and displays localized errors", async () => {
    const library = adapter();
    library.list.mockRejectedValueOnce({ code: "templateDirectoryInvalid" });
    render(
      <TemplateDialog
        locale="zh-CN"
        onClose={vi.fn()}
        onSelect={vi.fn()}
        library={library}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "自定义模板" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("不能是文件或符号链接");
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByRole("button", { name: /Review/ });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not select a late template after cancellation", async () => {
    const library = adapter(),
      onSelect = vi.fn(),
      onClose = vi.fn();
    let resolveRead!: (value: Awaited<ReturnType<TemplateLibraryAdapter["read"]>>) => void;
    library.read.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    render(
      <TemplateDialog
        locale="en-US"
        onClose={onClose}
        onSelect={onSelect}
        library={library}
      />,
    );
    await openCustom();
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => resolveRead({ ...entry, markdown: "# Too late" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("blocks oversized UTF-8 drafts and requires an active Markdown document to save", async () => {
    const library = adapter(),
      onSelect = vi.fn();
    const props = { locale: "en-US" as const, onClose: vi.fn(), onSelect, library };
    const view = render(<TemplateDialog {...props} />);
    await openCustom();
    expect(screen.getByRole("button", { name: "Save template" })).toBeDisabled();
    view.rerender(
      <TemplateDialog
        {...props}
        currentMarkdown={"界".repeat(Math.ceil(MAX_TEMPLATE_BYTES / 3))}
      />,
    );
    expect(screen.getByText(/Shorten the current document/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Save template" })).toBeDisabled();
    library.read.mockResolvedValueOnce({
      ...entry,
      markdown: "x".repeat(MAX_TEMPLATE_BYTES + 1),
    });
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("256 KiB");
    expect(onSelect).not.toHaveBeenCalled();
    expect(library.save).not.toHaveBeenCalled();
  });

  it("keeps keyboard focus inside the dialog and respects composing Escape", async () => {
    const library = adapter(),
      onClose = vi.fn();
    render(
      <TemplateDialog
        locale="en-US"
        onClose={onClose}
        onSelect={vi.fn()}
        library={library}
        currentMarkdown="draft"
      />,
    );
    const builtIn = screen.getByRole("tab", { name: "Built-in" });
    expect(builtIn).toHaveFocus();
    fireEvent.keyDown(builtIn, { key: "ArrowRight" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
    );
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(screen.getByRole("tab", { name: "Custom templates" })).toHaveFocus();
    fireEvent.keyDown(screen.getByLabelText("Template name"), {
      key: "Escape",
      isComposing: true,
    });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
