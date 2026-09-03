import { EditorView as CodeMirrorView } from "@codemirror/view";
import type { Node } from "@milkdown/kit/prose/model";
import { closeHistory } from "@milkdown/kit/prose/history";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";

import { codeFindDecorations, setCodeFindMatches } from "./codeMirrorFind";
import {
  findTextMatches,
  replacementIsSafe,
  type FindMatch,
  type PageFindTarget,
} from "./pageFind";

const visualFindKey = new PluginKey<DecorationSet>("notespace-page-find");

export function visualFindPlugin() {
  return new Plugin<DecorationSet>({
    key: visualFindKey,
    state: {
      init: () => DecorationSet.empty,
      apply(transaction, decorations) {
        const matches = transaction.getMeta(visualFindKey) as DecorationSet | undefined;
        return matches ?? decorations.map(transaction.mapping, transaction.doc);
      },
    },
    props: { decorations: (state) => visualFindKey.getState(state) },
  });
}

/** Search rendered text, joining inline marks but not unrelated paragraphs/UI. */
export function findVisualMatches(document: Node, query: string): FindMatch[] {
  const matches: FindMatch[] = [];
  if (!query) return matches;
  document.descendants((node, position) => {
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, "\n", "\ufffc");
    for (const match of findTextMatches(text, query)) {
      matches.push({ from: position + 1 + match.from, to: position + 1 + match.to });
    }
    return false;
  });
  return matches;
}

/** Preserve PM offsets while replacing structural positions with separators. */
function textAtVisualPositions(document: Node): string {
  const fragments: string[] = [];
  let offset = 0;
  document.descendants((node, position) => {
    if (!node.isText && !node.isLeaf) return true;
    fragments.push("\n".repeat(position - offset), node.text ?? "\ufffc");
    offset = position + node.nodeSize;
    return false;
  });
  return fragments.join("");
}

export function visualFindTarget(
  view: EditorView,
  scroller: HTMLElement,
  isComposing: () => boolean = () => false,
): PageFindTarget {
  return {
    matches: (query) => findVisualMatches(view.state.doc, query),
    highlight(matches, current, reveal) {
      view.dispatch(
        view.state.tr
          .setMeta(
            visualFindKey,
            DecorationSet.create(
              view.state.doc,
              matches.map(({ from, to }, index) =>
                Decoration.inline(from, to, {
                  class:
                    index === current
                      ? "page-find-match page-find-match--current"
                      : "page-find-match",
                }),
              ),
            ),
          )
          .setMeta("addToHistory", false),
      );
      const active = matches[current];
      let activeCode: HTMLElement | null = null;
      view.state.doc.descendants((node, position) => {
        if (node.type.name !== "code_block") return true;
        const block = view.nodeDOM(position);
        if (!(block instanceof HTMLElement)) return false;
        const start = position + 1;
        const local = matches.filter(
          (match) => match.from >= start && match.to <= start + node.content.size,
        );
        const index = active ? local.indexOf(active) : -1;
        if (index >= 0) {
          activeCode = block;
          if (reveal && block.querySelector(".codemirror-host.hidden")) {
            // Preview-only Mermaid is view state. Expose its matching source
            // through Crepe's own toggle; do not rewrite the code node.
            block.querySelector<HTMLButtonElement>(".preview-toggle-button")?.click();
          }
        }
        const element = block.querySelector<HTMLElement>(".cm-editor");
        const code = element ? CodeMirrorView.findFromDOM(element) : null;
        if (!code || !code.state.field(codeFindDecorations, false)) return false;
        code.dispatch({
          effects: [
            setCodeFindMatches.of({
              matches: local.map(({ from, to }) => ({
                from: from - start,
                to: to - start,
              })),
              current: index,
            }),
            ...(reveal && active && index >= 0
              ? [CodeMirrorView.scrollIntoView(active.from - start, { y: "center" })]
              : []),
          ],
        });
        return false;
      });
      if (!reveal || !active) return;
      try {
        const rect = activeCode
          ? (activeCode as HTMLElement).getBoundingClientRect()
          : view.coordsAtPos(active.from);
        scroller.scrollTop = Math.max(
          0,
          scroller.scrollTop +
            rect.top -
            scroller.getBoundingClientRect().top -
            scroller.clientHeight / 2,
        );
      } catch {
        // A just-replaced node may not have a measured rectangle until the next frame.
      }
    },
    focus: () => view.focus(),
    replace(matches, replacement) {
      if (!view.editable) return "readonly";
      if (view.composing || isComposing()) return "composing";
      const text = textAtVisualPositions(view.state.doc);
      if (!replacementIsSafe(text, matches, replacement)) return "blocked";
      let transaction = closeHistory(view.state.tr);
      for (const { from, to } of [...matches].reverse()) {
        transaction = transaction.insertText(replacement, from, to);
      }
      if (!transaction.doc.eq(view.state.doc)) {
        view.dispatch(transaction);
        view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
      }
      return "replaced";
    },
  };
}
