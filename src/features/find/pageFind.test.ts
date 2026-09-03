import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { codeFindDecorations, setCodeFindMatches } from "./codeMirrorFind";
import { findTextMatches } from "./pageFind";

describe("current page literal matching", () => {
  it("matches CJK and literal punctuation with stable Unicode offsets", () => {
    expect(findTextMatches("🙂İ中文 a+b 中文 A+B", "中文")).toEqual([
      { from: 3, to: 5 },
      { from: 10, to: 12 },
    ]);
    expect(findTextMatches("a+b A+B axb", "a+b")).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
    ]);
    expect(findTextMatches("[x] (x) .", "[x]")).toEqual([{ from: 0, to: 3 }]);
    expect(findTextMatches("正文", "missing")).toEqual([]);
    expect(findTextMatches("正文", "")).toEqual([]);
  });

  it("creates and clears code highlights without editing text or selection", () => {
    const initial = EditorState.create({
      doc: "中文 text 中文",
      selection: { anchor: 4 },
      extensions: [codeFindDecorations],
    });
    const transaction = initial.update({
      effects: setCodeFindMatches.of({
        matches: findTextMatches(initial.doc.toString(), "中文"),
        current: 1,
      }),
    });
    expect(transaction.docChanged).toBe(false);
    expect(transaction.state.selection.eq(initial.selection)).toBe(true);
    expect(transaction.state.field(codeFindDecorations).size).toBe(2);
    const cleared = transaction.state.update({
      effects: setCodeFindMatches.of({ matches: [], current: 0 }),
    });
    expect(cleared.state.field(codeFindDecorations).size).toBe(0);
    expect(cleared.state.doc).toBe(initial.doc);
  });
});
