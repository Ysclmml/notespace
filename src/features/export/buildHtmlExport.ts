import katex from "katex";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { markdownImagePath } from "../editor/imageSource";
import { normalizeMathDelimiters } from "../markdown-math/normalizeMathDelimiters";
import { markdownHeadingSlug } from "../workspace/outlineModel";
import remarkMath from "remark-math";

export interface HtmlExportOptions {
  title: string;
  documentPath?: string;
  /** Used by the portable-export preparation step, never by the editor. */
  imageSource?: (source: string | null, original: string) => string;
  mermaidMarkup?: (source: string) => string;
  portable?: boolean;
}

// Only the fields consumed by the renderer are needed. The actual syntax tree is
// produced by the same remark parser and GFM extension used by Milkdown.
interface MarkdownNode {
  type: string;
  children?: readonly MarkdownNode[];
  value?: string;
  url?: string;
  title?: string | null;
  alt?: string | null;
  identifier?: string;
  depth?: number;
  ordered?: boolean | null;
  start?: number | null;
  checked?: boolean | null;
  lang?: string | null;
  align?: readonly ("left" | "right" | "center" | null)[] | null;
}

const parser = unified().use(remarkParse).use(remarkMath).use(remarkGfm);
export const MAX_HTML_EXPORT_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_MATH_SOURCE_LENGTH = 16_384;
const SCHEME = /^[a-z][a-z\d+.-]*:/iu;
const WINDOWS_PATH = /^[a-z]:[\\/]/iu;
const ABSOLUTE_DOCUMENT_PATH = /^(?:\/|[a-z]:[\\/]|file:)/iu;
const EXPORT_STYLES = `
:root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #242830; background: #fff; }
body { margin: 0; padding: 40px 24px 64px; }
main { max-width: 920px; margin: 0 auto; overflow-wrap: anywhere; line-height: 1.75; }
h1, h2, h3, h4, h5, h6 { line-height: 1.35; margin: 1.6em 0 .65em; scroll-margin-top: 24px; }
h1 { font-size: 2.2em; border-bottom: 1px solid #dce1e9; padding-bottom: .35em; }
h2 { font-size: 1.65em; } h3 { font-size: 1.3em; }
p { margin: .85em 0; } a { color: #355bd5; text-underline-offset: .18em; }
blockquote { margin: 1.2em 0; border-left: 3px solid #ccd6ee; padding: .2em 1.2em; background: #f6f7fa; color: #586171; }
pre { overflow-x: auto; padding: 18px; border: 1px solid #dce1e9; border-radius: 8px; background: #f6f7fa; line-height: 1.55; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9em; }
:not(pre) > code { padding: .12em .3em; border-radius: 4px; background: #edf0f5; }
pre code { white-space: pre; overflow-wrap: normal; }
img { max-width: 100%; height: auto; } hr { border: 0; border-top: 1px solid #dce1e9; margin: 2em 0; }
.table-scroll { overflow-x: auto; margin: 1.2em 0; } table { border-collapse: collapse; min-width: 50%; }
th, td { border: 1px solid #dce1e9; padding: .65em .9em; min-width: 100px; } th { background: #f3f5f8; }
.align-left { text-align: left; } .align-center { text-align: center; } .align-right { text-align: right; }
ul, ol { padding-left: 1.7em; } li { padding-left: .15em; } li > p { margin: .4em 0; }
.task { list-style: none; } .task input { margin-right: .5em; }
.unresolved-image { display: inline-block; padding: .5em .8em; border: 1px dashed #adb7c9; border-radius: 6px; color: #586171; }
.mermaid-label { font-size: .8em; color: #586171; margin-bottom: -.7em; }
.mermaid-diagram { margin: 1.4em 0; text-align: center; }
.mermaid-diagram > svg { max-width: 100%; height: auto; }
.mermaid-diagram foreignObject p { margin: 0; padding: 0; line-height: inherit; }
.mermaid-diagram foreignObject code { font-size: inherit; padding: 0; }
.math-inline { white-space: nowrap; }
.math-display { margin: 1.2em 0; overflow-x: auto; text-align: center; }
.math-display > .katex { display: inline-block; max-width: 100%; }
.math-error { color: #8b2c2c; border: 1px dashed #d8a5a5; border-radius: 5px; background: #fff7f7; }
.math-error.math-inline { padding: .08em .28em; }
.math-error.math-display { padding: .7em 1em; text-align: left; white-space: pre-wrap; }
.raw-html { white-space: pre-wrap; } .footnotes { font-size: .9em; border-top: 1px solid #dce1e9; margin-top: 2em; }
@media (max-width: 600px) { body { padding: 20px 16px 40px; } h1 { font-size: 1.8em; } }
@page { size: A4; margin: 18mm; }
@media print { :is(h1,h2,h3,h4,h5,h6):has(+ pre.long-code) { break-before: page; } pre.long-code { break-inside: auto; } }
@media print { body { padding: 0; font-size: 11pt; } main { max-width: none; } h1,h2,h3,h4,h5,h6 { break-after: avoid; } p, pre { orphans: 3; widows: 3; } pre, pre code { white-space: pre-wrap; overflow-wrap: anywhere; } pre { overflow: visible; padding: 0; border: 0; border-radius: 0; background: transparent; } img, tr, pre, .mermaid-diagram { break-inside: avoid; } img { max-height: 240mm; object-fit: contain; } .mermaid-diagram > svg { max-height: 240mm; } .table-scroll { overflow: visible; } table { width: 100%; table-layout: fixed; } th,td { min-width: 0; padding: .4em .5em; } thead { display: table-header-group; } }
`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const point = character.charCodeAt(0);
    return point < 32 || point === 127;
  });
}

/** Resolve references without reading a file, creating an image or making a request. */
function exportUrl(
  value: string,
  documentPath: string | undefined,
  image: boolean,
): string | null {
  const reference = value.trim();
  if (!reference || hasControlCharacter(reference)) return null;
  if (reference.startsWith("#")) return image ? null : reference;
  if (reference.startsWith("//") || reference.startsWith("\\\\")) return null;

  if (SCHEME.test(reference) && !WINDOWS_PATH.test(reference)) {
    try {
      const url = new URL(reference);
      if (url.protocol === "https:" || url.protocol === "http:") {
        return url.hostname ? url.href : null;
      }
      if (!image && url.protocol === "mailto:") return url.href;
      if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost"))
        return null;
    } catch {
      return null;
    }
  }

  const sourcePath =
    documentPath && ABSOLUTE_DOCUMENT_PATH.test(documentPath) ? documentPath : "";
  const path = markdownImagePath(sourcePath, reference);
  if (!path || hasControlCharacter(path)) return null;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const fileUrl = WINDOWS_PATH.test(path)
    ? `file:///${encodedPath.replace(/^([a-z])%3A/iu, "$1:")}`
    : `file://${encodedPath}`;
  // The path resolver consumes escapes in the path only. Retain a link's
  // fragment/query separately (for example an SVG view fragment).
  const suffix = reference.match(/[?#].*$/u)?.[0] ?? "";
  return `${fileUrl}${suffix}`;
}

function nodeText(node: MarkdownNode): string {
  return node.value ?? node.alt ?? node.children?.map(nodeText).join("") ?? "";
}

/** Export a snapshot of the supplied Markdown, independent of editor mode/DOM. */
export function buildHtmlExport(content: string, options: HtmlExportOptions): string {
  // Edits and ordinary text pastes can grow a normal session after its initial
  // file preflight. Check again before parsing, including unsaved documents.
  // UTF-16 length cheaply rejects obviously oversized input without encoding it.
  if (
    content.length > MAX_HTML_EXPORT_SOURCE_BYTES ||
    new TextEncoder().encode(content).byteLength > MAX_HTML_EXPORT_SOURCE_BYTES
  ) {
    throw Object.assign(new Error("HTML export supports Markdown up to 8 MiB."), {
      code: "htmlExportSourceTooLarge",
    });
  }
  const root: MarkdownNode = parser.parse(normalizeMathDelimiters(content));
  const definitions = new Map<string, MarkdownNode>();
  const footnotes = new Map<string, MarkdownNode>();
  const headingIds = new WeakMap<MarkdownNode, string>();
  const usedIds = new Set<string>();
  const nextSuffix = new Map<string, number>();
  function allocateId(value: string): string {
    const base = value || "section";
    let id = base;
    let suffix = nextSuffix.get(base) ?? 1;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    nextSuffix.set(base, suffix);
    usedIds.add(id);
    return id;
  }
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if (node.type === "heading") {
      headingIds.set(node, allocateId(markdownHeadingSlug(nodeText(node))));
    }
    if (
      node.identifier &&
      node.type === "definition" &&
      !definitions.has(node.identifier)
    ) {
      definitions.set(node.identifier, node);
    }
    if (node.identifier && node.type === "footnoteDefinition")
      footnotes.set(node.identifier, node);
    const nested = node.children ?? [];
    for (let index = nested.length - 1; index >= 0; index -= 1) {
      const child = nested[index];
      if (child) pending.push(child);
    }
  }

  const footnoteNumbers = new Map<string, number>();
  const footnoteIds = new Map<string, string>();
  const children = (node: MarkdownNode): string =>
    (node.children ?? []).map(render).join("");

  function link(node: MarkdownNode, definition = node): string {
    const label = children(node);
    const url = exportUrl(definition.url ?? "", options.documentPath, false);
    if (!url) return label;
    const title = definition.title ? ` title="${escapeHtml(definition.title)}"` : "";
    return `<a href="${escapeHtml(url)}"${title} rel="noreferrer">${label}</a>`;
  }

  function image(node: MarkdownNode, definition = node): string {
    const original = definition.url ?? "";
    const resolved = exportUrl(original, options.documentPath, true);
    const source = options.imageSource?.(resolved, original) ?? resolved;
    const alt = escapeHtml(node.alt ?? "");
    if (!source) {
      return `<span class="unresolved-image" role="img" aria-label="${alt || "Image"}">${alt ? `${alt} — ` : ""}${escapeHtml(definition.url ?? "")}</span>`;
    }
    const title = definition.title ? ` title="${escapeHtml(definition.title)}"` : "";
    return `<img src="${escapeHtml(source)}" alt="${alt}"${title} loading="eager" referrerpolicy="no-referrer">`;
  }

  function math(node: MarkdownNode, displayMode: boolean): string {
    const source = node.value ?? "";
    try {
      if (source.length > MAX_MATH_SOURCE_LENGTH) {
        throw new Error("math source is too long");
      }
      // MathML keeps the exported HTML single-file and script-free: unlike the
      // HTML output it does not require KaTeX CSS or external font assets.
      const markup = katex.renderToString(source, {
        displayMode,
        maxExpand: 1_000,
        maxSize: 20,
        output: "mathml",
        strict: "error",
        throwOnError: true,
        trust: false,
      });
      return displayMode
        ? `<div class="math-display" role="math">${markup}</div>\n`
        : `<span class="math-inline" role="math">${markup}</span>`;
    } catch {
      const fallback = escapeHtml(displayMode ? `$$\n${source}\n$$` : `$${source}$`);
      return displayMode
        ? `<pre class="math-error math-display"><code>${fallback}</code></pre>\n`
        : `<code class="math-error math-inline">${fallback}</code>`;
    }
  }

  function render(node: MarkdownNode): string {
    switch (node.type) {
      case "root":
        return children(node);
      case "text":
        return escapeHtml(node.value ?? "");
      case "paragraph":
        return `<p>${children(node)}</p>\n`;
      case "heading": {
        const slug =
          headingIds.get(node) ?? allocateId(markdownHeadingSlug(nodeText(node)));
        const depth = Math.min(6, Math.max(1, node.depth ?? 1));
        return `<h${depth} id="${escapeHtml(slug)}">${children(node)}</h${depth}>\n`;
      }
      case "emphasis":
        return `<em>${children(node)}</em>`;
      case "strong":
        return `<strong>${children(node)}</strong>`;
      case "delete":
        return `<del>${children(node)}</del>`;
      case "inlineCode":
        return `<code>${escapeHtml(node.value ?? "")}</code>`;
      case "inlineMath":
        return math(node, false);
      case "math":
        return math(node, true);
      case "break":
        return "<br>\n";
      case "thematicBreak":
        return "<hr>\n";
      case "blockquote":
        return `<blockquote>${children(node)}</blockquote>\n`;
      case "list": {
        const tag = node.ordered ? "ol" : "ul";
        const start =
          node.ordered && node.start != null && node.start !== 1
            ? ` start="${node.start}"`
            : "";
        return `<${tag}${start}>${children(node)}</${tag}>\n`;
      }
      case "listItem": {
        const task = node.checked != null;
        const checkbox = task
          ? `<input type="checkbox" disabled${node.checked ? " checked" : ""}>`
          : "";
        const body = (node.children ?? [])
          .map((child, index) => {
            if (task && index === 0 && child.type === "paragraph") {
              return `<p>${checkbox}${children(child)}</p>\n`;
            }
            return render(child);
          })
          .join("");
        return `<li${task ? ' class="task"' : ""}>${body}</li>\n`;
      }
      case "code": {
        const language = node.lang?.trim() ?? "";
        if (language.toLowerCase() === "mermaid" && options.mermaidMarkup) {
          return options.mermaidMarkup(node.value ?? "");
        }
        const className = language ? ` class="language-${escapeHtml(language)}"` : "";
        const label =
          language.toLowerCase() === "mermaid"
            ? '<p class="mermaid-label">Mermaid · 源码 / source</p>'
            : "";
        const longCode = (node.value ?? "").split("\n", 42).length > 40;
        return `${label}<pre${longCode ? ' class="long-code"' : ""}><code${className}>${escapeHtml(node.value ?? "")}\n</code></pre>\n`;
      }
      case "html":
        return `<code class="raw-html">${escapeHtml(node.value ?? "")}</code>`;
      case "link":
        return link(node);
      case "image":
        return image(node);
      case "linkReference": {
        const definition = definitions.get(node.identifier ?? "");
        return definition ? link(node, definition) : children(node);
      }
      case "imageReference": {
        const definition = definitions.get(node.identifier ?? "");
        return image(node, definition ?? node);
      }
      case "definition":
      case "footnoteDefinition":
        return "";
      case "footnoteReference": {
        const identifier = node.identifier ?? "";
        if (!footnotes.has(identifier)) return escapeHtml(`[^${identifier}]`);
        const number = footnoteNumbers.get(identifier) ?? footnoteNumbers.size + 1;
        footnoteNumbers.set(identifier, number);
        const id =
          footnoteIds.get(identifier) ?? allocateId(`notespace-footnote-${number}`);
        footnoteIds.set(identifier, id);
        return `<sup><a href="#${escapeHtml(id)}">${number}</a></sup>`;
      }
      case "table": {
        const rows = (node.children ?? []).map((row, index) => {
          const cellTag = index === 0 ? "th" : "td";
          const cells = (row.children ?? [])
            .map((cell, column) => {
              const alignment = node.align?.[column];
              const className = alignment ? ` class="align-${alignment}"` : "";
              return `<${cellTag}${className}>${children(cell)}</${cellTag}>`;
            })
            .join("");
          return `<tr>${cells}</tr>`;
        });
        return `<div class="table-scroll"><table><thead>${rows[0] ?? ""}</thead><tbody>${rows.slice(1).join("")}</tbody></table></div>\n`;
      }
      default:
        return node.value ? escapeHtml(node.value) : children(node);
    }
  }

  const body = render(root);
  const notes: string[] = [];
  // Rendering one note may discover another reference. Map iteration preserves
  // that order and each definition is rendered at most once, including cycles.
  for (const identifier of footnoteNumbers.keys()) {
    const definition = footnotes.get(identifier);
    const id = footnoteIds.get(identifier);
    if (definition)
      notes.push(`<li id="${escapeHtml(id ?? "")}">${children(definition)}</li>`);
  }
  const notesHtml = notes.length
    ? `<section class="footnotes"><ol>${notes.join("")}</ol></section>`
    : "";
  return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${options.portable ? "data:" : "file: http: https:"}; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(options.title)}</title><style>${EXPORT_STYLES}</style></head><body><main>${body}${notesHtml}</main></body></html>\n`;
}
