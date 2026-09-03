import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  WorkspaceImageSettingsDialog,
  type WorkspaceImageSettingsDialogProps,
  type WorkspaceImageSettingsLabels,
} from "./WorkspaceImageSettingsDialog";

const messages: Record<"zh-CN" | "en-US", WorkspaceImageSettingsLabels> = {
  "zh-CN": {
    title: "图片保存位置",
    description: "仅影响此工作区以后粘贴的截图，不移动已有图片。",
    sameDirectory: "与 Markdown 文件保存在同一目录",
    sameDirectoryDescription: "每张图片保存在所属文档旁边。",
    customDirectory: "保存到指定目录",
    customDirectoryDescription: "此工作区的截图统一使用所选文件夹。",
    directoryPath: "图片文件夹",
    chooseDirectory: "选择文件夹…",
    chooseDirectoryHint: "请选择一个图片文件夹",
    chooseDirectoryError: "无法选择此文件夹，请重试。",
    cancel: "取消",
    save: "保存",
  },
  "en-US": {
    title: "Image Save Location",
    description:
      "Applies to future screenshots in this workspace. Existing images stay in place.",
    sameDirectory: "Beside each Markdown file",
    sameDirectoryDescription: "Save each image in its document's folder.",
    customDirectory: "Use a specific folder",
    customDirectoryDescription: "Save screenshots from this workspace in one folder.",
    directoryPath: "Image folder",
    chooseDirectory: "Choose Folder…",
    chooseDirectoryHint: "Choose a folder for images",
    chooseDirectoryError: "Unable to choose this folder. Please try again.",
    cancel: "Cancel",
    save: "Save",
  },
};

function renderDialog(overrides: Partial<WorkspaceImageSettingsDialogProps> = {}) {
  const props: WorkspaceImageSettingsDialogProps = {
    workspaceName: "Example Workspace",
    imageDirectoryPath: null,
    labels: messages["en-US"],
    onChooseDirectory: vi.fn().mockResolvedValue("/example/images"),
    onSave: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(<WorkspaceImageSettingsDialog {...props} />), props };
}

describe("WorkspaceImageSettingsDialog", () => {
  it.each(["zh-CN", "en-US"] as const)(
    "shows translated options, defaults to the document directory, and only saves on submit in %s",
    (locale) => {
      const labels = messages[locale];
      const { props } = renderDialog({ labels });
      const dialog = screen.getByRole("dialog", { name: labels.title });
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAccessibleDescription(labels.description);
      expect(screen.getByText("Example Workspace")).toBeVisible();
      expect(screen.getByRole("radio", { name: labels.sameDirectory })).toBeChecked();
      expect(screen.getByRole("radio", { name: labels.sameDirectory })).toHaveFocus();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(props.onSave).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: labels.save }));
      expect(props.onSave).toHaveBeenCalledExactlyOnceWith(null);
    },
  );

  it("chooses a destination without persisting until Save and restores the default with null", async () => {
    const { props, unmount } = renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "Use a specific folder" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Choose Folder…" }));
    });
    expect(screen.getByRole("textbox", { name: "Image folder" })).toHaveValue(
      "/example/images",
    );
    expect(screen.getByRole("textbox", { name: "Image folder" })).toHaveAttribute(
      "readonly",
    );
    expect(props.onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith("/example/images");
    unmount();

    const reopened = renderDialog({ imageDirectoryPath: "/example/images" });
    expect(screen.getByRole("radio", { name: "Use a specific folder" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Beside each Markdown file" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(reopened.props.onSave).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("keeps an existing folder when the native chooser is cancelled", async () => {
    const { props } = renderDialog({
      imageDirectoryPath: "/example/old-images",
      onChooseDirectory: vi.fn().mockResolvedValue(null),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Choose Folder…" }));
    });
    expect(screen.getByRole("textbox", { name: "Image folder" })).toHaveValue(
      "/example/old-images",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(props.onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it.each(["failure", "relative", "empty"])(
    "reports a translated chooser error and never saves an unusable folder: %s",
    async (kind) => {
      const onChooseDirectory =
        kind === "failure"
          ? vi.fn().mockRejectedValue(new Error("native details"))
          : vi.fn().mockResolvedValue(kind === "relative" ? "images" : "");
      const { props } = renderDialog({ onChooseDirectory });
      fireEvent.click(screen.getByRole("radio", { name: "Use a specific folder" }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Choose Folder…" }));
      });
      expect(screen.getByRole("alert")).toHaveTextContent(
        messages["en-US"].chooseDirectoryError,
      );
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Choose Folder…" })).toBeEnabled();
      expect(props.onSave).not.toHaveBeenCalled();
    },
  );

  it("blocks duplicate chooser requests and ignores results after the dialog unmounts", async () => {
    let resolve!: (value: string) => void;
    const onChooseDirectory = vi.fn(() => new Promise<string>((done) => (resolve = done)));
    const { props, unmount } = renderDialog({ onChooseDirectory });
    fireEvent.click(screen.getByRole("radio", { name: "Use a specific folder" }));
    const chooseButton = screen.getByRole("button", { name: "Choose Folder…" });
    fireEvent.click(chooseButton);
    fireEvent.click(chooseButton);
    expect(onChooseDirectory).toHaveBeenCalledOnce();
    expect(chooseButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    unmount();
    await act(async () => resolve("/example/late-images"));
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("traps focus, blocks application shortcuts, ignores composition Escape and restores focus", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { props, unmount } = renderDialog();
    const first = screen.getByRole("radio", { name: "Beside each Markdown file" });
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    fireEvent.keyDown(save, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(save).toHaveFocus();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Tab" });
    expect(first).toHaveFocus();

    const backgroundShortcut = vi.fn();
    window.addEventListener("keydown", backgroundShortcut);
    const event = new KeyboardEvent("keydown", {
      key: "s",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    first.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(backgroundShortcut).not.toHaveBeenCalled();
    window.removeEventListener("keydown", backgroundShortcut);
    fireEvent.keyDown(window, { key: "Escape", isComposing: true });
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onSave).not.toHaveBeenCalled();
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
