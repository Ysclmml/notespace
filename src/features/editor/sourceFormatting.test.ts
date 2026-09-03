import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { sourceFormattingTransaction } from "./sourceFormatting";
import type { FormattingAction } from "../shortcuts/shortcuts";

function formatted(text: string, action: FormattingAction, from = 0, to = text.length) {
  const state = EditorState.create({ doc: text, selection: { anchor: from, head: to } });
  return state.update(sourceFormattingTransaction(state, action)).state;
}

describe("source Markdown formatting", () => {
  it.each([1, 2, 3, 4, 5, 6])(
    "applies heading %s without touching surrounding lines",
    (level) => {
      expect(
        formatted(
          "before\n## 中文\nafter",
          `heading${level}` as FormattingAction,
          8,
          10,
        ).doc.toString(),
      ).toBe(`before\n${"#".repeat(level)} 中文\nafter`);
    },
  );

  it("converts selected headings to paragraphs and excludes the next line at a boundary", () => {
    expect(
      formatted("# first\n## second\n# third", "paragraph", 0, 18).doc.toString(),
    ).toBe("first\nsecond\n# third");
  });

  it.each([
    ["toggleBold", "**中文**"],
    ["toggleItalic", "*中文*"],
    ["toggleStrike", "~~中文~~"],
    ["toggleInlineCode", "`中文`"],
  ] as const)("toggles %s around the same selection", (action, expected) => {
    const first = formatted("中文", action);
    expect(first.doc.toString()).toBe(expected);
    const second = first.update(sourceFormattingTransaction(first, action)).state;
    expect(second.doc.toString()).toBe("中文");
    expect(second.selection.main.from).toBe(0);
    expect(second.selection.main.to).toBe(2);
  });

  it("keeps whitespace outside emphasis and leaves an empty caret between delimiters", () => {
    expect(formatted(" 中文 ", "toggleBold").doc.toString()).toBe(" **中文** ");
    const empty = formatted("", "toggleItalic");
    expect(empty.doc.toString()).toBe("**");
    expect(empty.selection.main.from).toBe(1);
    expect(empty.selection.main.empty).toBe(true);
  });

  it("uses a longer code delimiter when selected text contains backticks", () => {
    expect(formatted("a`b", "toggleInlineCode").doc.toString()).toBe("``a`b``");
    const code = formatted("a\n```\nb", "codeBlock");
    expect(code.doc.toString()).toBe("````\na\n```\nb\n````");
    expect(
      code.update(sourceFormattingTransaction(code, "codeBlock")).state.doc.toString(),
    ).toBe("a\n```\nb");
  });

  it("composes emphasis and keeps literal edge backticks when toggling code twice", () => {
    const italic = formatted("**中文**", "toggleItalic", 2, 4);
    expect(italic.doc.toString()).toBe("***中文***");
    expect(
      italic
        .update(sourceFormattingTransaction(italic, "toggleItalic"))
        .state.doc.toString(),
    ).toBe("**中文**");
    const code = formatted("`中文", "toggleInlineCode");
    expect(code.doc.toString()).toBe("`` `中文 ``");
    expect(
      code
        .update(sourceFormattingTransaction(code, "toggleInlineCode"))
        .state.doc.toString(),
    ).toBe("`中文");
    const inner = formatted("a`b", "toggleInlineCode");
    expect(
      inner
        .update(sourceFormattingTransaction(inner, "toggleInlineCode"))
        .state.doc.toString(),
    ).toBe("a`b");
  });

  it("toggles blockquotes line by line and restores a single caret", () => {
    const first = formatted("a\nb", "blockquote");
    expect(first.doc.toString()).toBe("> a\n> b");
    expect(
      first.update(sourceFormattingTransaction(first, "blockquote")).state.doc.toString(),
    ).toBe("a\nb");
    expect(formatted("# abc", "paragraph", 3, 3).selection.main.from).toBe(1);
  });
});
