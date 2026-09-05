import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n, type TranslationKey } from "../../app/i18n";
import {
  formatShortcut,
  FORMATTING_ACTIONS,
  type FormattingAction,
} from "../shortcuts/shortcuts";
import { useFormattingShortcuts } from "../editor/useFormattingShortcuts";
import {
  executeEditorContextMenuCommand,
  isReadOnlyCodeTarget,
  isVisualMarkdownTarget,
  isWritableEditorTarget,
  resolveContextMenuLink,
  type EditorContextMenuCommand,
} from "./editorCommands";
import type { ContextMenuPosition } from "./useEditorContextMenu";
import "./EditorContextMenu.css";
import {
  resolveImageActionTarget,
  type ImageActionTarget,
} from "../image-actions/imageActions";

export interface EditorContextMenuActionContext {
  readonly command: EditorContextMenuCommand;
  readonly href?: string;
  readonly target: EventTarget | null;
  readonly image?: ImageActionTarget;
}

export type EditorContextMenuActions = Partial<
  Record<
    EditorContextMenuCommand,
    (context: EditorContextMenuActionContext) => void | Promise<void>
  >
>;

export interface EditorContextMenuProps {
  readonly open: boolean;
  readonly position: ContextMenuPosition;
  readonly target?: EventTarget | null;
  readonly actions?: EditorContextMenuActions;
  readonly readOnly?: boolean;
  readonly onClose: () => void;
}

interface MenuItem {
  readonly command: EditorContextMenuCommand;
  readonly label: TranslationKey;
  readonly shortcut?: string;
  readonly separated?: boolean;
}

interface MenuBranch {
  readonly id: "paragraph" | "format" | "insert" | "table";
  readonly label: TranslationKey;
  readonly items: ReadonlyArray<MenuItem>;
  readonly separated?: boolean;
}

const LINK_ITEMS: ReadonlyArray<MenuItem> = [
  { command: "openLink", label: "context.openLink" },
  { command: "openLinkNewTab", label: "context.openLinkNewTab" },
  { command: "copyLink", label: "context.copyLink" },
];

const HISTORY_ITEMS: ReadonlyArray<MenuItem> = [
  { command: "undo", label: "menu.undo", shortcut: "Mod+Z" },
  { command: "redo", label: "menu.redo", shortcut: "Mod+Shift+Z" },
];

const EDIT_ITEMS: ReadonlyArray<MenuItem> = [
  { command: "cut", label: "context.cut", shortcut: "Mod+X", separated: true },
  { command: "copy", label: "context.copy", shortcut: "Mod+C" },
  { command: "paste", label: "context.paste", shortcut: "Mod+V" },
  {
    command: "selectAll",
    label: "context.selectAll",
    shortcut: "Mod+A",
    separated: true,
  },
];

const READ_ONLY_ITEMS: ReadonlyArray<MenuItem> = [
  { command: "copy", label: "context.copy", shortcut: "Mod+C" },
  {
    command: "selectAll",
    label: "context.selectAll",
    shortcut: "Mod+A",
    separated: true,
  },
];

const VISUAL_BRANCHES: ReadonlyArray<MenuBranch> = [
  {
    id: "paragraph",
    label: "menu.paragraph",
    separated: true,
    items: [
      { command: "paragraph", label: "context.paragraph" },
      { command: "heading1", label: "context.heading1" },
      { command: "heading2", label: "context.heading2" },
      { command: "heading3", label: "context.heading3" },
      { command: "heading4", label: "context.heading4" },
      { command: "heading5", label: "context.heading5" },
      { command: "heading6", label: "context.heading6" },
      { command: "blockquote", label: "context.blockquote", separated: true },
      { command: "bulletList", label: "context.bulletList" },
      { command: "orderedList", label: "context.orderedList" },
      { command: "taskList", label: "context.taskList" },
    ],
  },
  {
    id: "format",
    label: "menu.format",
    items: [
      { command: "toggleBold", label: "context.bold" },
      { command: "toggleItalic", label: "context.italic" },
      { command: "toggleStrike", label: "context.strike" },
      { command: "toggleInlineCode", label: "context.inlineCode" },
      { command: "clearFormatting", label: "context.clearFormatting", separated: true },
    ],
  },
  {
    id: "insert",
    label: "context.insert",
    items: [
      { command: "insertTable", label: "context.insertTable" },
      { command: "codeBlock", label: "context.codeBlock" },
      { command: "horizontalRule", label: "context.horizontalRule" },
    ],
  },
];

const TABLE_BRANCH: MenuBranch = {
  id: "table",
  label: "context.table",
  items: [
    { command: "addRowBefore", label: "context.addRowBefore" },
    { command: "addRowAfter", label: "context.addRowAfter" },
    { command: "deleteRow", label: "context.deleteRow" },
    { command: "addColumnBefore", label: "context.addColumnBefore", separated: true },
    { command: "addColumnAfter", label: "context.addColumnAfter" },
    { command: "deleteColumn", label: "context.deleteColumn" },
    { command: "deleteTable", label: "context.deleteTable", separated: true },
  ],
};

function isTableTarget(target?: EventTarget | null): boolean {
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  return Boolean(element?.closest(".ProseMirror table"));
}

function hasTextSelection(target?: EventTarget | null): boolean {
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  const control = element?.closest<HTMLInputElement | HTMLTextAreaElement>(
    "input, textarea",
  );
  if (control) {
    return (
      control.selectionStart !== null &&
      control.selectionEnd !== null &&
      control.selectionStart !== control.selectionEnd
    );
  }

  const surface = element?.closest<HTMLElement>(
    '[contenteditable="true"], [contenteditable=""], [contenteditable="false"], .cm-content',
  );
  const selection = window.getSelection();
  return Boolean(
    surface &&
    selection &&
    !selection.isCollapsed &&
    selection.rangeCount > 0 &&
    surface.contains(selection.getRangeAt(0).commonAncestorContainer),
  );
}

function isItemDisabled(
  command: EditorContextMenuCommand,
  target: EventTarget | null | undefined,
  writable: boolean,
): boolean {
  if (command === "copy") return !hasTextSelection(target);
  if (command === "cut") return !writable || !hasTextSelection(target);
  if (command === "paste" || command === "undo" || command === "redo") {
    return !writable;
  }
  return false;
}

export function EditorContextMenu({
  actions,
  onClose,
  open,
  position,
  readOnly = false,
  target,
}: EditorContextMenuProps) {
  const { t } = useI18n();
  const shortcuts = useFormattingShortcuts();
  const itemShortcut = (item: MenuItem) =>
    formatShortcut(
      FORMATTING_ACTIONS.includes(item.command as FormattingAction)
        ? shortcuts[item.command as FormattingAction]
        : (item.shortcut ?? null),
    );
  const menuRef = useRef<HTMLDivElement>(null);
  const [openBranch, setOpenBranch] = useState<MenuBranch["id"] | null>(null);
  const [actionError, setActionError] = useState(false);
  const image = resolveImageActionTarget(target);
  const link = resolveContextMenuLink(target);
  const writable = !readOnly && (target == null || isWritableEditorTarget(target));
  const readOnlyCode = isReadOnlyCodeTarget(target);
  const visualMarkdown = isVisualMarkdownTarget(target);
  const tableTarget = isTableTarget(target);
  const branches = useMemo(
    () =>
      visualMarkdown && !readOnly && !image
        ? tableTarget
          ? [...VISUAL_BRANCHES, TABLE_BRANCH]
          : VISUAL_BRANCHES
        : [],
    [tableTarget, visualMarkdown, readOnly, image],
  );
  const menuItems = useMemo(() => {
    const items: MenuItem[] = [];
    if (image) {
      if (image.kind === "mermaid") {
        if (image.element.querySelector("[data-visual-mermaid-id]"))
          items.push({ command: "previewImage", label: "context.previewDiagram" });
        if (
          !readOnly &&
          image.element.closest(".milkdown-code-block")?.querySelector(".codemirror-host")
        )
          items.push({ command: "editMermaidSource", label: "context.editMermaidSource" });
      } else {
        if (!image.element.closest(".visual-viewer"))
          items.push({ command: "previewImage", label: "context.previewImage" });
        items.push({
          command: "copyImage",
          label: "context.copyImage",
          separated: items.length > 0,
        });
        if (image.reference)
          items.push(
            { command: "copyImageAddress", label: "context.copyImageAddress" },
            { command: "copyImageMarkdown", label: "context.copyImageMarkdown" },
          );
        if (image.editable && !readOnly)
          items.push({ command: "editImage", label: "context.editImage", separated: true });
        if (image.localPath && actions?.revealImage)
          items.push({
            command: "revealImage",
            label: "context.revealImage",
            separated: !image.editable || readOnly,
          });
      }
      return items;
    }
    if (link) items.push(...LINK_ITEMS);
    const editingItems =
      writable && !readOnlyCode ? [...HISTORY_ITEMS, ...EDIT_ITEMS] : [...READ_ONLY_ITEMS];
    if (link && editingItems.length > 0) {
      const firstItem = editingItems[0];
      if (firstItem) editingItems[0] = { ...firstItem, separated: true };
    }
    items.push(...editingItems);
    return items;
  }, [actions, image, link, readOnly, readOnlyCode, writable]);
  const closeMenu = useCallback(() => {
    setOpenBranch(null);
    setActionError(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    const closeOnViewportChange = () => closeMenu();
    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [closeMenu, open]);

  if (!open || (image && menuItems.length === 0)) return null;

  const menuWidth = 224;
  const separatedCount = menuItems.filter((item) => item.separated).length;
  const branchCount = branches.length;
  const estimatedHeight =
    12 +
    (menuItems.length + branchCount) * 28 +
    separatedCount * 6 +
    (actionError ? 100 : 0);
  const viewportWidth =
    typeof window === "undefined" ? position.x + menuWidth : window.innerWidth;
  const viewportHeight =
    typeof window === "undefined" ? position.y + estimatedHeight : window.innerHeight;
  const left = Math.max(8, Math.min(position.x, viewportWidth - menuWidth - 8));
  const top = Math.max(8, Math.min(position.y, viewportHeight - estimatedHeight - 8));
  const submenuOnLeft = left + menuWidth * 2 > viewportWidth - 8;

  return (
    <div
      aria-label={t(image ? "context.imageMenu" : "menu.edit")}
      className="editor-context-menu"
      onContextMenu={(event) => event.preventDefault()}
      ref={menuRef}
      role="menu"
      style={{ left, top }}
    >
      {menuItems.map((item) => {
        const disabled = isItemDisabled(item.command, target, writable);
        return (
          <button
            className={
              item.separated
                ? "editor-context-menu__item editor-context-menu__item--separated"
                : "editor-context-menu__item"
            }
            disabled={disabled}
            key={item.command}
            onClick={() => {
              const context: EditorContextMenuActionContext = {
                command: item.command,
                href: link?.href,
                target: target ?? null,
                image: image ?? undefined,
              };
              const customAction = actions?.[item.command];
              setActionError(false);
              const run = async () => {
                try {
                  const result = customAction
                    ? await customAction(context)
                    : await executeEditorContextMenuCommand(
                        item.command,
                        target,
                        link?.href,
                      );
                  if (image && result === false) {
                    setActionError(true);
                    return;
                  }
                  closeMenu();
                } catch {
                  if (image) setActionError(true);
                  else closeMenu();
                }
              };
              void run();
            }}
            onPointerDown={(event) => event.preventDefault()}
            role="menuitem"
            type="button"
          >
            <span>{t(item.label)}</span>
            {itemShortcut(item) && <kbd>{itemShortcut(item)}</kbd>}
          </button>
        );
      })}
      {actionError && (
        <p className="editor-context-menu__error" role="alert">
          {t("context.imageActionFailed")}
        </p>
      )}
      {branches.map((branch) => (
        <div className="editor-context-menu__branch" key={branch.id}>
          <button
            aria-expanded={openBranch === branch.id}
            aria-haspopup="menu"
            className={
              branch.separated
                ? "editor-context-menu__item editor-context-menu__item--separated"
                : "editor-context-menu__item"
            }
            onClick={() =>
              setOpenBranch((current) => (current === branch.id ? null : branch.id))
            }
            onPointerEnter={() => setOpenBranch(branch.id)}
            role="menuitem"
            type="button"
          >
            <span>{t(branch.label)}</span>
            <span aria-hidden="true" className="editor-context-menu__chevron">
              ›
            </span>
          </button>
          {openBranch === branch.id && (
            <div
              aria-label={t(branch.label)}
              className={
                submenuOnLeft
                  ? "editor-context-menu editor-context-menu__submenu editor-context-menu__submenu--left"
                  : "editor-context-menu editor-context-menu__submenu"
              }
              role="menu"
            >
              {branch.items.map((item) => (
                <button
                  className={
                    item.separated
                      ? "editor-context-menu__item editor-context-menu__item--separated"
                      : "editor-context-menu__item"
                  }
                  key={item.command}
                  onClick={() => {
                    const context: EditorContextMenuActionContext = {
                      command: item.command,
                      target: target ?? null,
                    };
                    const customAction = actions?.[item.command];
                    const result = customAction
                      ? Promise.resolve().then(() => customAction(context))
                      : executeEditorContextMenuCommand(item.command, target);
                    void result.catch(() => undefined).finally(closeMenu);
                  }}
                  onPointerDown={(event) => event.preventDefault()}
                  role="menuitem"
                  type="button"
                >
                  <span>{t(item.label)}</span>
                  {itemShortcut(item) && <kbd>{itemShortcut(item)}</kbd>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
