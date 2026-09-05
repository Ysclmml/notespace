import { nodeViewCtx, schemaCtx } from "@milkdown/kit/core";
import { Schema } from "@milkdown/kit/prose/model";
import {
  DecorationSet,
  type EditorView,
  type NodeView,
  type NodeViewConstructor,
} from "@milkdown/kit/prose/view";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { stabilizeCodeBlockView, stableCodeBlockView } from "./stableCodeBlockView";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    code_block: {
      group: "block",
      content: "text*",
      attrs: { language: { default: "text" } },
    },
  },
});
const codeNode = (text = "generated code", language = "text") =>
  schema.nodes.code_block.create({ language }, schema.text(text));

let resizeCallback: ResizeObserverCallback;
let disconnect: ReturnType<typeof vi.fn>;
let frames: Map<number, FrameRequestCallback>;
beforeEach(() => {
  disconnect = vi.fn();
  frames = new Map();
  let nextFrame = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function fixture(language = "text") {
  const dom = document.createElement("div");
  dom.style.overflow = "visible";
  let height = 400;
  let width = 600;
  vi.spyOn(dom, "getBoundingClientRect").mockImplementation(
    () => ({ width, height }) as DOMRect,
  );
  const child = (className: string) => {
    const element = document.createElement("div");
    element.className = className;
    dom.replaceChildren(element);
    return element;
  };
  child(language === "mermaid" ? "visual-mermaid-preview" : "cm-editor");
  document.body.append(dom);
  const update = vi.fn(() => true);
  const destroy = vi.fn();
  const native: NodeView = { dom, update, destroy };
  const node = codeNode("generated code", language);
  const stabilized = stabilizeCodeBlockView(native, node);
  return {
    dom,
    node,
    native,
    stabilized,
    update,
    destroy,
    child,
    resize(nextHeight = height, nextWidth = width) {
      height = nextHeight;
      width = nextWidth;
      resizeCallback([], {} as ResizeObserver);
    },
  };
}

const flushMutations = async () => {
  await Promise.resolve();
};
const flushFrames = () => {
  for (const [id, callback] of frames) {
    frames.delete(id);
    callback(performance.now());
  }
};

it("keeps the real view and holds its measured height through off-screen teardown", async () => {
  const f = fixture();
  expect(f.stabilized).toBe(f.native);
  f.resize();
  f.child("milkdown-code-block-placeholder");
  await flushMutations();
  expect(f.dom.style.height).toBe("400px");
  expect(f.dom.style.boxSizing).toBe("border-box");
  expect(f.dom.style.overflow).toBe("clip");
  f.resize(30);
  f.stabilized.update?.(f.node, [], DecorationSet.empty);
  expect(f.update).toHaveBeenCalledOnce();
  expect(f.dom.style.height).toBe("400px");
  f.child("cm-editor");
  await flushMutations();
  expect(f.dom.style.height).toBe("");
  expect(f.dom.style.overflow).toBe("visible");
  f.resize(480);
  f.child("milkdown-code-block-placeholder");
  await flushMutations();
  expect(f.dom.style.height).toBe("480px");
  f.stabilized.destroy?.();
});

it("holds a tall Mermaid preview through teardown and the next loading phase", async () => {
  const f = fixture("mermaid");
  f.resize(650);
  f.child("milkdown-code-block-placeholder");
  await flushMutations();
  expect(f.dom.style.height).toBe("650px");
  f.child("visual-mermaid-preview visual-mermaid-preview--loading");
  await flushMutations();
  f.resize(120);
  expect(f.dom.style.height).toBe("650px");
  expect(f.dom.style.overflow).toBe("visible");
  f.child("visual-mermaid-preview");
  await flushMutations();
  expect(f.dom.style.height).toBe("");
  f.resize(620);
  f.child("milkdown-code-block-placeholder");
  await flushMutations();
  expect(f.dom.style.height).toBe("620px");
  f.stabilized.destroy?.();
});

it.each([codeNode("changed code"), codeNode("generated code", "mermaid")])(
  "invalidates a stale measurement when actual code content or language changes",
  async (nextNode) => {
    const f = fixture();
    f.resize();
    f.child("milkdown-code-block-placeholder");
    await flushMutations();
    f.stabilized.update?.(nextNode, [], DecorationSet.empty);
    expect(f.dom.style.height).toBe("");
    expect(f.dom.style.overflow).toBe("visible");
    f.resize(25);
    await flushMutations();
    expect(f.dom.style.height).toBe("");
    f.stabilized.destroy?.();
  },
);

it("ignores detached zero sizes and placeholder width changes, then measures real content again", async () => {
  const f = fixture();
  f.resize();
  f.dom.remove();
  f.resize(0, 0);
  f.child("milkdown-code-block-placeholder");
  await flushMutations();
  document.body.append(f.dom);
  f.resize(40, 300);
  expect(f.dom.style.height).toBe("400px");
  f.child("cm-editor");
  await flushMutations();
  f.resize(700, 300);
  f.child("milkdown-code-block-placeholder");
  await flushMutations();
  expect(f.dom.style.height).toBe("700px");
  f.stabilized.destroy?.();
});

it("disconnects observers and restores styles when the real view is destroyed", async () => {
  const f = fixture();
  f.resize();
  f.child("milkdown-code-block-placeholder");
  await flushMutations();
  f.stabilized.destroy?.();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(f.destroy).toHaveBeenCalledOnce();
  expect(f.dom.style.height).toBe("");
  expect(f.dom.style.overflow).toBe("visible");
  f.resize(800);
  f.child("cm-editor");
  f.child("milkdown-code-block-placeholder");
  await flushMutations();
  expect(f.dom.style.height).toBe("");
});

it("remeasures an equal-height edit before the next off-screen teardown", async () => {
  const f = fixture();
  f.resize();
  f.stabilized.update?.(codeNode("same height edit"), [], DecorationSet.empty);
  flushFrames();
  f.child("milkdown-code-block-placeholder");
  await flushMutations();
  expect(f.dom.style.height).toBe("400px");
  f.stabilized.destroy?.();
});

it("releases a loading preview's held height when the user explicitly opens its source", async () => {
  const f = fixture("mermaid");
  f.resize(650);
  const loading = f.child("visual-mermaid-preview visual-mermaid-preview--loading");
  const source = document.createElement("div");
  source.className = "codemirror-host hidden";
  f.dom.append(source);
  await flushMutations();
  expect(f.dom.style.height).toBe("650px");
  source.classList.remove("hidden");
  await flushMutations();
  expect(f.dom.style.height).toBe("");
  expect(f.dom.style.overflow).toBe("visible");
  loading.remove();
  await flushMutations();
  expect(f.dom.style.height).toBe("");
  f.stabilized.destroy?.();
});

it("can measure settled mutations when ResizeObserver is unavailable", async () => {
  vi.stubGlobal("ResizeObserver", undefined);
  const f = fixture();
  f.child("cm-editor");
  await flushMutations();
  f.child("milkdown-code-block-placeholder");
  await flushMutations();
  expect(f.dom.style.height).toBe("400px");
  f.stabilized.destroy?.();
  expect(f.destroy).toHaveBeenCalledOnce();
});

it("captures each editor's own registered constructor without cross-group configuration", async () => {
  const createContext = (stock: NodeViewConstructor) => {
    let entries: [string, NodeViewConstructor][] = [["code_block", stock]];
    const context = {
      wait: async () => {},
      get: (slice: unknown) => {
        if (slice === nodeViewCtx) return entries;
        if (slice === schemaCtx) return schema;
        throw new Error("Unexpected context read");
      },
      update: (
        slice: unknown,
        update: (value: [string, NodeViewConstructor][]) => [string, NodeViewConstructor][],
      ) => {
        expect(slice).toBe(nodeViewCtx);
        entries = update(entries);
      },
    } as unknown as Parameters<typeof stableCodeBlockView>[0];
    return { context, factory: () => entries.at(-1)![1] };
  };
  const stockA = vi.fn<NodeViewConstructor>(() => ({ dom: document.createElement("div") }));
  const stockB = vi.fn<NodeViewConstructor>(() => ({ dom: document.createElement("div") }));
  const first = createContext(stockA);
  const second = createContext(stockB);
  await stableCodeBlockView(first.context)();
  await stableCodeBlockView(second.context)();
  const args = [codeNode(), {} as EditorView, () => 0, [], DecorationSet.empty] as const;
  const firstView = first.factory()(...args);
  const secondView = second.factory()(...args);
  expect(stockA).toHaveBeenCalledOnce();
  expect(stockB).toHaveBeenCalledOnce();
  expect(firstView).toBe(stockA.mock.results[0]!.value);
  expect(secondView).toBe(stockB.mock.results[0]!.value);
  firstView.destroy?.();
  secondView.destroy?.();
});
