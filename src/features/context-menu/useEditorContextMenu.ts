import {
  useCallback,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { resolveImageActionTarget } from "../image-actions/imageActions";

export interface ContextMenuPosition {
  readonly x: number;
  readonly y: number;
}

export interface EditorContextMenuState {
  readonly open: boolean;
  readonly position: ContextMenuPosition;
  readonly target: EventTarget | null;
}

const CLOSED_CONTEXT_MENU: EditorContextMenuState = {
  open: false,
  position: { x: 0, y: 0 },
  target: null,
};

type RestoreSelection = () => void;

function targetElement(target: EventTarget | null): Element | null {
  return target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
}

function supportsEditorContextMenu(target: EventTarget | null): boolean {
  if (resolveImageActionTarget(target)) return true;
  const element = targetElement(target);
  return Boolean(
    element?.closest(
      'a[href], input, textarea, [contenteditable="true"], [contenteditable=""], .cm-content, .code-file-preview',
    ),
  );
}

function captureEditorSelection(target: EventTarget | null): RestoreSelection | null {
  const element = targetElement(target);
  const control = element?.closest<HTMLInputElement | HTMLTextAreaElement>(
    "input, textarea",
  );
  if (control && control.selectionStart !== null && control.selectionEnd !== null) {
    const start = control.selectionStart;
    const end = control.selectionEnd;
    const direction = control.selectionDirection ?? undefined;
    return () => {
      if (control.isConnected) control.setSelectionRange(start, end, direction);
    };
  }

  const surface = element?.closest<HTMLElement>(
    '[contenteditable="true"], [contenteditable=""], .cm-content',
  );
  const selection = window.getSelection();
  if (!surface || !selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!surface.contains(range.commonAncestorContainer)) return null;
  const preservedRange = range.cloneRange();
  return () => {
    if (!surface.isConnected || !preservedRange.commonAncestorContainer.isConnected) return;
    const liveSelection = window.getSelection();
    if (!liveSelection) return;
    liveSelection.removeAllRanges();
    liveSelection.addRange(preservedRange);
  };
}

export function useEditorContextMenu() {
  const [contextMenu, setContextMenu] =
    useState<EditorContextMenuState>(CLOSED_CONTEXT_MENU);
  const secondaryPointerTargetRef = useRef<EventTarget | null>(null);
  const restoreSelectionRef = useRef<RestoreSelection | null>(null);
  const onPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const secondaryClick =
      event.button === 2 ||
      (event.buttons & 2) === 2 ||
      (event.button === 0 && event.ctrlKey);
    if (!secondaryClick) {
      secondaryPointerTargetRef.current = null;
      restoreSelectionRef.current = null;
      return;
    }

    // Remember the exact surface hit by a macOS secondary/control click. Do not cancel
    // pointerdown: WebKit may suppress the following contextmenu event when it is cancelled.
    secondaryPointerTargetRef.current = event.target;
    restoreSelectionRef.current = captureEditorSelection(event.target);
  }, []);
  const onContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const target = secondaryPointerTargetRef.current ?? event.target;
    secondaryPointerTargetRef.current = null;
    const restoreSelection = restoreSelectionRef.current;
    restoreSelectionRef.current = null;
    if (!supportsEditorContextMenu(target)) {
      setContextMenu(CLOSED_CONTEXT_MENU);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    // A macOS trackpad secondary click may briefly move the DOM selection before
    // `contextmenu`. Restore the editor's prior selection without cancelling
    // pointerdown, which would suppress the menu in WebKit.
    if (!resolveImageActionTarget(target)) restoreSelection?.();
    setContextMenu({
      open: true,
      position: { x: event.clientX, y: event.clientY },
      target,
    });
  }, []);
  const closeContextMenu = useCallback(() => {
    secondaryPointerTargetRef.current = null;
    restoreSelectionRef.current = null;
    setContextMenu(CLOSED_CONTEXT_MENU);
  }, []);

  return {
    contextMenu,
    onContextMenu,
    onPointerDownCapture,
    closeContextMenu,
  } as const;
}
