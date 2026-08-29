import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { linkDispositionFromPointer, markdownLinkTargetAt } from "./linkTarget";

describe("markdown link target", () => {
  it("reads the URL from a clicked Markdown link without rewriting it", () => {
    const state = EditorState.create({
      doc: "read [下一篇](guide/next.md#开始) now",
      extensions: [markdown()],
    });

    expect(markdownLinkTargetAt(state, state.doc.toString().indexOf("下一篇"))).toBe(
      "guide/next.md#开始",
    );
    expect(markdownLinkTargetAt(state, 1)).toBeNull();
  });

  it("maps browser-like pointer modifiers to tab disposition", () => {
    expect(linkDispositionFromPointer(false, false, 0)).toBe("current");
    expect(linkDispositionFromPointer(true, false, 0)).toBe("newBackground");
    expect(linkDispositionFromPointer(true, true, 0)).toBe("newForeground");
    expect(linkDispositionFromPointer(false, false, 1)).toBe("newBackground");
  });
});
