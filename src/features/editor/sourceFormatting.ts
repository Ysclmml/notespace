import { isolateHistory } from "@codemirror/commands";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import type { FormattingAction } from "../shortcuts/shortcuts";

const INLINE_MARKERS: Partial<Record<FormattingAction, string>> = {
  toggleBold: "**",
  toggleItalic: "*",
  toggleStrike: "~~",
  toggleInlineCode: "`",
};

function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const match of text.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length);
  return longest;
}

function markerSize(action: FormattingAction, left: string, right: string): number {
  if (action === "toggleInlineCode") {
    const opening = left.match(/`+$/u)?.[0].length ?? 0;
    const closing = right.match(/^`+/u)?.[0].length ?? 0;
    return opening === closing ? opening : 0;
  }
  if (action === "toggleItalic") {
    return (left.match(/\*+$/u)?.[0].length ?? 0) % 2 === 1 &&
      (right.match(/^\*+/u)?.[0].length ?? 0) % 2 === 1
      ? 1
      : 0;
  }
  const marker = INLINE_MARKERS[action]!;
  return left.endsWith(marker) && right.startsWith(marker) ? marker.length : 0;
}

/** Source formatting is a normal, isolated text edit; no parse/serialize round trip. */
export function sourceFormattingTransaction(
  state: EditorState,
  action: FormattingAction,
): TransactionSpec {
  const { from, to } = state.selection.main;
  const text = state.doc.toString();
  const marker = INLINE_MARKERS[action];
  let start = from;
  let end = to;
  let insert = "";
  let anchor = from;
  let head = to;

  if (marker) {
    const selected = text.slice(from, to);
    const includedSize = markerSize(
      action,
      selected.match(/^(?:\*+|`+|~+)/u)?.[0] ?? "",
      selected.match(/(?:\*+|`+|~+)$/u)?.[0] ?? "",
    );
    const surroundingSize = markerSize(action, text.slice(0, from), text.slice(to));
    if (from !== to && includedSize && selected.length > includedSize * 2) {
      insert = selected.slice(includedSize, -includedSize);
      head = start + insert.length;
    } else if (surroundingSize) {
      start -= surroundingSize;
      end += surroundingSize;
      insert = selected;
      anchor = start;
      head = start + selected.length;
    } else if (
      action === "toggleInlineCode" &&
      text[from - 1] === " " &&
      text[to] === " " &&
      markerSize(action, text.slice(0, from - 1), text.slice(to + 1))
    ) {
      const size = markerSize(action, text.slice(0, from - 1), text.slice(to + 1));
      start -= size + 1;
      end += size + 1;
      insert = selected;
      anchor = start;
      head = start + selected.length;
    } else {
      // Markdown emphasis cannot start/end with whitespace. Leave whitespace
      // outside the delimiters while preserving the selected text exactly.
      const leading = selected.match(/^\s*/u)?.[0] ?? "";
      const trailing = selected.trim() ? (selected.match(/\s*$/u)?.[0] ?? "") : "";
      const content = selected.slice(leading.length, selected.length - trailing.length);
      const delimiter =
        action === "toggleInlineCode"
          ? "`".repeat(longestBacktickRun(content) + 1)
          : marker;
      const padding =
        action === "toggleInlineCode" && (content.startsWith("`") || content.endsWith("`"))
          ? " "
          : "";
      insert = `${leading}${delimiter}${padding}${content}${padding}${delimiter}${trailing}`;
      anchor = start + leading.length + delimiter.length + padding.length;
      head = anchor + content.length;
    }
  } else {
    const first = state.doc.lineAt(from);
    // A selection ending at the next line start does not select that line.
    const last = state.doc.lineAt(to > from && text[to - 1] === "\n" ? to - 1 : to);
    start = first.from;
    end = last.to;
    const selected = text.slice(start, end);
    if (action === "codeBlock") {
      const before = first.number > 1 ? state.doc.line(first.number - 1) : null;
      const after = last.number < state.doc.lines ? state.doc.line(last.number + 1) : null;
      const fence = before?.text.match(/^(`{3,}|~{3,})[^`~]*$/u)?.[1];
      if (
        fence &&
        after &&
        new RegExp(`^${fence[0]}{${fence.length},}\\s*$`, "u").test(after.text)
      ) {
        start = before!.from;
        end = after.to;
        insert = selected;
        anchor = start + (from - first.from);
        head = anchor + (to - from);
      } else {
        const ticks = Math.max(2, longestBacktickRun(selected));
        const delimiter = "`".repeat(ticks + 1);
        insert = `${delimiter}\n${selected}\n${delimiter}`;
        anchor = start + delimiter.length + 1 + (from - first.from);
        head = anchor + (to - from);
      }
    } else {
      const lines = selected.split("\n");
      const removeQuote =
        action === "blockquote" && lines.every((line) => /^ {0,3}>\s?/u.test(line));
      const prefix = action.startsWith("heading")
        ? `${"#".repeat(Number(action.slice(-1)))} `
        : "";
      const transformed = lines.map((line) => {
        if (action === "blockquote")
          return removeQuote ? line.replace(/^ {0,3}>[ \t]?/u, "") : `> ${line}`;
        const plain = line.replace(/^ {0,3}#{1,6}(?:[ \t]+|$)/u, "");
        return `${prefix}${plain}`;
      });
      insert = transformed.join("\n");
      // Keep the selected block selected, or leave an empty selection after
      // the first line's new prefix, so subsequent typing edits the same text.
      if (from === to) {
        anchor = Math.max(start, from + transformed[0]!.length - lines[0]!.length);
        head = anchor;
      } else {
        anchor = start;
        head = start + insert.length;
      }
    }
  }
  return {
    changes:
      text.slice(start, end) === insert ? undefined : { from: start, to: end, insert },
    selection: { anchor, head },
    scrollIntoView: true,
    annotations: [Transaction.userEvent.of("input.format"), isolateHistory.of("full")],
  };
}

export function runSourceFormatting(view: EditorView, action: FormattingAction): boolean {
  if (view.composing || view.state.facet(EditorState.readOnly)) return false;
  view.dispatch(sourceFormattingTransaction(view.state, action));
  return true;
}
