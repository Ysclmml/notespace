import { isolateHistory } from "@codemirror/commands";
import { EditorState, StateEffect, StateField, Transaction } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

import {
  findTextMatches,
  replacementIsSafe,
  type FindMatch,
  type PageFindTarget,
} from "./pageFind";

export const setCodeFindMatches = StateEffect.define<{
  readonly matches: readonly FindMatch[];
  readonly current: number;
}>();

export const codeFindDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setCodeFindMatches)) {
        return Decoration.set(
          effect.value.matches.map(({ from, to }, index) =>
            Decoration.mark({
              class:
                index === effect.value.current
                  ? "page-find-match page-find-match--current"
                  : "page-find-match",
            }).range(from, to),
          ),
        );
      }
    }
    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function codeMirrorFindTarget(
  view: EditorView,
  isComposing: () => boolean = () => false,
): PageFindTarget {
  return {
    matches: (query) => findTextMatches(view.state.doc.toString(), query),
    highlight(matches, current, reveal) {
      const match = matches[current];
      view.dispatch({
        effects: [
          setCodeFindMatches.of({ matches, current }),
          ...(reveal && match
            ? [EditorView.scrollIntoView(match.from, { y: "center" })]
            : []),
        ],
      });
    },
    focus: () => view.focus(),
    ...(view.state.facet(EditorState.readOnly)
      ? {}
      : {
          replace(matches: readonly FindMatch[], replacement: string) {
            if (view.state.facet(EditorState.readOnly)) return "readonly" as const;
            if (view.composing || isComposing()) return "composing" as const;
            if (!replacementIsSafe(view.state.doc.toString(), matches, replacement)) {
              return "blocked" as const;
            }
            const changes = matches
              .filter(
                ({ from, to }) => view.state.doc.sliceString(from, to) !== replacement,
              )
              .map(({ from, to }) => ({ from, to, insert: replacement }));
            if (changes.length) {
              view.dispatch({
                changes,
                annotations: [
                  Transaction.userEvent.of("input.replace"),
                  isolateHistory.of("full"),
                ],
              });
            }
            return "replaced" as const;
          },
        }),
  };
}
