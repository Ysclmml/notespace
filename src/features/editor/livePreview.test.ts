import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installCodeMirrorDomMeasurementStubs } from "./spike/domTestSupport";
import { dispatchCompositionEvent } from "./spike/domInputHarness";
import {
  getLivePreviewDecorations,
  isLivePreviewCompositionFrozen,
  livePreviewExtensions,
  type LivePreviewConfig,
} from "./livePreview";

beforeAll(() => installCodeMirrorDomMeasurementStubs());

let mounted: { host: HTMLDivElement; view: EditorView } | null = null;

afterEach(() => {
  mounted?.view.destroy();
  mounted?.host.remove();
  mounted = null;
});

function mount(
  source: string,
  selection = 0,
  renderMermaid?: (source: string) => Promise<string>,
  config: LivePreviewConfig = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  const state = EditorState.create({
    doc: source,
    selection: { anchor: selection },
    extensions: [livePreviewExtensions({ ...config, renderMermaid })],
  });
  const view = new EditorView({ parent: host, state });
  mounted = { host, view };
  return mounted;
}

describe("product live preview", () => {
  it("renders block semantics without changing Markdown bytes", () => {
    const source = `# 标题

> 引用正文

- 列表一
- 列表二
- [ ] 待完成

<https://example.com>

\`\`\`bash
echo hello
\`\`\`

| 能力 | 状态 |
| --- | --- |
| 表格 | 完成 |
`;
    const { host, view } = mount(source);

    expect(host.querySelector(".cm-live-heading-1")).not.toBeNull();
    expect(host.querySelector(".cm-live-blockquote")).not.toBeNull();
    expect(host.querySelectorAll(".cm-live-list-marker")).toHaveLength(2);
    expect(host.querySelector<HTMLInputElement>(".cm-live-task-marker")?.checked).toBe(
      false,
    );
    expect(host.textContent).toContain("https://example.com");
    expect(host.querySelector(".cm-live-code-card code")?.textContent).toBe("echo hello");
    expect(host.querySelector(".cm-live-table")?.textContent).toContain("表格完成");
    expect(getLivePreviewDecorations(view.state).size).toBeGreaterThan(0);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("toggles a rendered task marker without rewriting unrelated Markdown", () => {
    const source = "# 清单\n\n- [ ] 保留其余内容\n";
    const { host, view } = mount(source);
    const task = host.querySelector<HTMLInputElement>(".cm-live-task-marker");

    expect(task).not.toBeNull();
    task?.click();

    expect(view.state.doc.toString()).toBe("# 清单\n\n- [x] 保留其余内容\n");
  });

  it("freezes structural decorations during IME composition and refreshes next frame", async () => {
    const source = "# 标题\n\n普通段落\n";
    const { view } = mount(source, source.indexOf("普通"));

    dispatchCompositionEvent(view, "compositionstart");
    expect(isLivePreviewCompositionFrozen(view.state)).toBe(true);
    view.dispatch({
      changes: { from: source.indexOf("普通"), insert: "中文" },
    });
    expect(isLivePreviewCompositionFrozen(view.state)).toBe(true);

    dispatchCompositionEvent(view, "compositionend", "中文");
    expect(isLivePreviewCompositionFrozen(view.state)).toBe(true);
    await waitFor(() => expect(isLivePreviewCompositionFrozen(view.state)).toBe(false));
    expect(view.state.doc.toString()).toBe("# 标题\n\n中文普通段落\n");
  });

  it("renders a resolved local image and opens it in the shared viewer", () => {
    const onOpenVisual = vi.fn();
    const source = "# 图片\n\n![示例](assets/demo.png)\n";
    const { host, view } = mount(source, 0, undefined, {
      onOpenVisual,
      resolveImageSource: (target) => `asset://resolved/${target}`,
    });
    const image = host.querySelector<HTMLImageElement>(".cm-live-image-card img");

    expect(image?.getAttribute("src")).toBe("asset://resolved/assets/demo.png");
    host.querySelector<HTMLButtonElement>(".cm-live-image-card button")?.click();
    expect(onOpenVisual).toHaveBeenCalledWith({
      kind: "image",
      source: "asset://resolved/assets/demo.png",
      title: "示例",
    });
    expect(view.state.doc.toString()).toBe(source);
  });

  it("reveals exact table source when a rendered cell is clicked", () => {
    const source = `plain

| A | B |
| --- | --- |
| x | y |
`;
    const { host, view } = mount(source);
    const cell = host.querySelector("td");
    expect(cell).not.toBeNull();

    cell?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(host.querySelector("table")).toBeNull();
    expect(view.state.doc.toString()).toBe(source);
    expect(view.state.selection.main.from).toBe(source.indexOf("x"));
  });

  it("renders an inactive Mermaid fence asynchronously", async () => {
    const source = `plain

\`\`\`mermaid
flowchart LR
A --> B
\`\`\`
`;
    const { host, view } = mount(
      source,
      1,
      async () => '<svg viewBox="0 0 100 40"><text>diagram</text></svg>',
    );

    await waitFor(() => expect(host.querySelector("svg")?.textContent).toBe("diagram"));
    expect(view.state.doc.toString()).toBe(source);
  });
});
