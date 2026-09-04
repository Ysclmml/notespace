import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { normalizeMathDelimiters } from "../features/markdown-math/normalizeMathDelimiters";

interface MarkdownPosition {
  readonly start?: { readonly offset?: number };
  readonly end?: { readonly offset?: number };
}

export interface MarkdownNode {
  readonly type: string;
  readonly value?: string;
  readonly depth?: number;
  readonly url?: string;
  readonly alt?: string;
  readonly title?: string;
  readonly lang?: string | null;
  readonly ordered?: boolean;
  readonly start?: number | null;
  readonly checked?: boolean | null;
  readonly children?: readonly MarkdownNode[];
  readonly position?: MarkdownPosition;
}

export interface MobileOutlineItem {
  readonly id: string;
  readonly depth: number;
  readonly text: string;
}

function sourceSlice(node: MarkdownNode, source: string): string | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return typeof start === "number" && typeof end === "number"
    ? source.slice(start, end)
    : null;
}

function prepareMathNodes(node: MarkdownNode, source: string): MarkdownNode {
  const raw = sourceSlice(node, source);

  // micromark accepts an opening display fence through EOF. NoteSpace keeps
  // an unfinished formula literal so a half-written note is never reinterpreted.
  if (node.type === "math" && !(raw?.trimEnd().endsWith("$$") ?? false)) {
    return {
      type: "paragraph",
      children: [{ type: "text", value: raw ?? `$$${node.value ?? ""}` }],
      position: node.position,
    };
  }

  const children = node.children?.map((child) => prepareMathNodes(child, source));
  return {
    ...node,
    ...(children ? { children } : {}),
  };
}

export function parseMobileMarkdown(markdown: string) {
  const normalized = normalizeMathDelimiters(markdown);
  const root = unified()
    .use(remarkParse)
    .use(remarkMath)
    .use(remarkGfm)
    .parse(normalized) as unknown as MarkdownNode;
  return prepareMathNodes(root, normalized);
}

function plainText(node: MarkdownNode): string {
  if (node.value) return node.value;
  return (node.children ?? []).map(plainText).join("");
}

function slugPart(value: string) {
  return (
    value
      .trim()
      .toLocaleLowerCase()
      .replaceAll(/[^\p{Letter}\p{Number}\s-]/gu, "")
      .replaceAll(/\s+/g, "-") || "section"
  );
}

export function mobileMarkdownHeadingIds(root: MarkdownNode) {
  const ids = new Map<MarkdownNode, string>();
  const used = new Map<string, number>();
  const visit = (node: MarkdownNode) => {
    if (node.type === "heading") {
      const base = slugPart(plainText(node));
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      ids.set(node, count === 0 ? base : `${base}-${count + 1}`);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return ids;
}

export function mobileMarkdownOutline(markdown: string): readonly MobileOutlineItem[] {
  const root = parseMobileMarkdown(markdown);
  const ids = mobileMarkdownHeadingIds(root);
  const outline: MobileOutlineItem[] = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "heading") {
      outline.push({
        id: ids.get(node) ?? "section",
        depth: Math.min(6, Math.max(1, node.depth ?? 1)),
        text: plainText(node),
      });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return outline;
}
