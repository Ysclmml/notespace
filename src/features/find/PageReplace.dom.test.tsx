import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { undo as undoCode, redo as redoCode } from "@codemirror/commands";
import { EditorView as CodeView } from "@codemirror/view";
import { undo as undoVisual, redo as redoVisual } from "@milkdown/kit/prose/history";
import { EditorView as VisualView } from "@milkdown/kit/prose/view";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { CodeFilePreview } from "../code-preview/CodeFilePreview";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { VisualMarkdownEditor } from "../editor/VisualMarkdownEditor";
import {
  installCodeMirrorDomMeasurementStubs,
  installImmediateIntersectionObserverStub,
} from "../editor/spike/domTestSupport";
import { codeMirrorFindTarget } from "./codeMirrorFind";

beforeAll(() => {
  installCodeMirrorDomMeasurementStubs();
  installImmediateIntersectionObserverStub();
});

describe("current-page replace", () => {
  it.each(["source", "code"] as const)(
    "replaces one/all in %s as isolated Undo steps",
    (surface) => {
      const onChange = vi.fn();
      const value = "中文 a+b 中文 A+B";
      const { container, getByRole } = render(
        surface === "source" ? (
          <MarkdownEditor
            documentId="/fixtures/replace.md"
            mode="normal"
            presentationMode="source"
            value={value}
            onChange={onChange}
            findRequest={1}
          />
        ) : (
          <CodeFilePreview
            path="/fixtures/replace.txt"
            language="text"
            editable
            content={value}
            onChange={onChange}
            findRequest={1}
          />
        ),
      );
      const view = CodeView.findFromDOM(
        container.querySelector<HTMLElement>(".cm-editor")!,
      )!;
      fireEvent.change(getByRole("textbox", { name: "当前页查找" }), {
        target: { value: "a+b" },
      });
      fireEvent.click(getByRole("button", { name: "显示替换" }));
      fireEvent.change(getByRole("textbox", { name: "替换为" }), {
        target: { value: "$&" },
      });
      fireEvent.click(getByRole("button", { name: "替换" }));
      expect(view.state.doc.toString()).toBe("中文 $& 中文 A+B");
      fireEvent.click(getByRole("button", { name: "全部替换" }));
      expect(view.state.doc.toString()).toBe("中文 $& 中文 $&");
      expect(container.querySelector(".page-find__count")).toHaveTextContent("无匹配项");
      act(() => {
        expect(undoCode(view)).toBe(true);
      });
      expect(view.state.doc.toString()).toBe("中文 $& 中文 A+B");
      act(() => {
        expect(undoCode(view)).toBe(true);
      });
      expect(view.state.doc.toString()).toBe(value);
      act(() => {
        expect(redoCode(view)).toBe(true);
      });
      expect(view.state.doc.toString()).toBe("中文 $& 中文 A+B");
      expect(onChange).toHaveBeenCalled();
    },
  );

  it("keeps readonly previews find-only and supports an editable capability change", () => {
    const props = {
      path: "/fixtures/readonly.txt",
      language: "text",
      content: "中文",
      findRequest: 1,
    };
    const { container, getByRole, queryByRole, rerender } = render(
      <CodeFilePreview {...props} />,
    );
    const view = CodeView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
    expect(queryByRole("button", { name: "显示替换" })).toBeNull();
    expect(codeMirrorFindTarget(view).replace).toBeUndefined();
    rerender(<CodeFilePreview {...props} editable />);
    expect(getByRole("button", { name: "显示替换" })).toBeVisible();
    const noOpTarget = codeMirrorFindTarget(view);
    expect(noOpTarget.replace?.(noOpTarget.matches("中文"), "中文")).toBe("replaced");
    expect(undoCode(view)).toBe(false);
    rerender(<CodeFilePreview {...props} />);
    expect(queryByRole("button", { name: "显示替换" })).toBeNull();
  });

  it("replaces rendered CJK across marks, tables and code without changing link URLs; all is one Undo", async () => {
    const views = new Set<VisualView>();
    const originalUpdate = VisualView.prototype.updateState;
    vi.spyOn(VisualView.prototype, "updateState").mockImplementation(function (
      this: VisualView,
      state,
    ) {
      originalUpdate.call(this, state);
      views.add(this);
    });
    const onChange = vi.fn();
    const { container, getByRole } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/fixtures/replace-visual.md"
        value={
          "中**文**正文 [中文](https://example.test/中文)\n\n| 中文 | 值 |\n| --- | --- |\n| 内容 | 中文 |\n\n```text\n中文\n```\n\n结束\n"
        }
        onChange={onChange}
        findRequest={1}
      />,
    );
    fireEvent.change(getByRole("textbox", { name: "当前页查找" }), {
      target: { value: "中文" },
    });
    await waitFor(
      () => expect(container.querySelector(".page-find__count")).toHaveTextContent("1/5"),
      { timeout: 4000 },
    );
    const view = await waitFor(() => {
      const found = [...views].find(
        (item) => item.dom === container.querySelector(".ProseMirror"),
      );
      expect(found).toBeTruthy();
      return found!;
    });
    const original = view.state.doc;
    fireEvent.click(getByRole("button", { name: "显示替换" }));
    fireEvent.change(getByRole("textbox", { name: "替换为" }), {
      target: { value: "替换" },
    });
    fireEvent.click(getByRole("button", { name: "全部替换" }));
    expect(view.state.doc.textContent).not.toContain("中文");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.stringContaining("https://example.test/中文"),
    );
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining("替换"));
    act(() => {
      expect(undoVisual(view.state, view.dispatch)).toBe(true);
    });
    expect(view.state.doc.eq(original)).toBe(true);
    act(() => {
      expect(redoVisual(view.state, view.dispatch)).toBe(true);
    });
    expect(view.state.doc.textContent).not.toContain("中文");
  });

  it("does not replace during composition, rejects huge image data and advances past replacement-created matches", () => {
    const onChange = vi.fn();
    const { container, getByRole } = render(
      <CodeFilePreview
        path="/fixtures/safe.txt"
        language="text"
        editable
        content="x x"
        onChange={onChange}
        findRequest={1}
      />,
    );
    const view = CodeView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
    fireEvent.change(getByRole("textbox", { name: "当前页查找" }), {
      target: { value: "x" },
    });
    fireEvent.click(getByRole("button", { name: "显示替换" }));
    const input = getByRole("textbox", { name: "替换为" });
    fireEvent.change(input, { target: { value: "xx" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(view.state.doc.toString()).toBe("x x");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(view.state.doc.toString()).toBe("xx x");
    expect(container.querySelector(".page-find__count")).toHaveTextContent("3/3");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(getByRole("button", { name: "全部替换" }));
    expect(view.state.doc.toString()).toBe(" ");
    act(() => {
      undoCode(view);
    });
    const target = codeMirrorFindTarget(view);
    const calls = onChange.mock.calls.length;
    expect(
      target.replace?.(
        target.matches("x"),
        `data:image/png;base64,${"a".repeat(1024 * 1024)}`,
      ),
    ).toBe("blocked");
    expect(onChange).toHaveBeenCalledTimes(calls);
    expect(view.state.doc.toString()).toBe("xx x");
  });
});
