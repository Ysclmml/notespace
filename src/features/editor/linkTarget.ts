import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export type LinkDisposition = "current" | "newBackground" | "newForeground";

export function linkDispositionFromPointer(
  primaryModifier: boolean,
  shift: boolean,
  button: number,
): LinkDisposition {
  if (button === 1) return "newBackground";
  if (primaryModifier && shift) return "newForeground";
  if (primaryModifier) return "newBackground";
  return "current";
}

export function markdownLinkTargetAt(state: EditorState, position: number): string | null {
  const resolved = syntaxTree(state).resolveInner(position, -1);
  let node: typeof resolved | null = resolved;
  while (node && node.name !== "Link") node = node.parent;
  if (!node) return null;

  const cursor = node.cursor();
  if (!cursor.firstChild()) return null;
  do {
    if (cursor.name === "URL") {
      return state.sliceDoc(cursor.from, cursor.to);
    }
  } while (cursor.nextSibling());

  return null;
}
