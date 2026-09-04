import { renderToString } from "katex";
import { useMemo, type ReactNode } from "react";

import "katex/dist/katex.min.css";

import {
  mobileMarkdownHeadingIds,
  parseMobileMarkdown,
  type MarkdownNode,
} from "./markdownModel";

export interface SafeMarkdownProps {
  readonly markdown: string;
  readonly onOpenLink?: (href: string) => void;
}

const MAX_MATH_SOURCE_LENGTH = 16_384;

function mathLiteral(value: string, displayMode: boolean) {
  return displayMode ? `$$\n${value}\n$$` : `$${value}$`;
}

function renderMath(node: MarkdownNode, key: string, displayMode: boolean) {
  const value = node.value ?? "";
  const className = `mobile-markdown__math mobile-markdown__math--${
    displayMode ? "display" : "inline"
  }`;
  try {
    if (value.length > MAX_MATH_SOURCE_LENGTH) throw new Error("math source is too long");
    // KaTeX escapes source text. `trust: false` disables URL/HTML-producing
    // commands, while strict parsing makes unsupported HTML extensions fail.
    const html = renderToString(value, {
      displayMode,
      maxExpand: 1_000,
      maxSize: 20,
      output: "htmlAndMathml",
      strict: "error",
      throwOnError: true,
      trust: false,
    });
    const Element = displayMode ? "div" : "span";
    return (
      <Element
        className={className}
        data-math-display={displayMode ? "true" : "false"}
        // This HTML is produced only by KaTeX with untrusted commands disabled.
        dangerouslySetInnerHTML={{ __html: html }}
        key={key}
      />
    );
  } catch {
    const Element = displayMode ? "div" : "span";
    return (
      <Element
        aria-label="公式无法渲染"
        className={`${className} mobile-markdown__math--error`}
        data-math-error="true"
        key={key}
      >
        <span>公式无法渲染：</span>
        <code>{mathLiteral(value, displayMode)}</code>
      </Element>
    );
  }
}

function children(
  node: MarkdownNode,
  key: string,
  ids: ReadonlyMap<MarkdownNode, string>,
  onOpenLink: SafeMarkdownProps["onOpenLink"],
) {
  return (node.children ?? []).map((child, index) =>
    renderNode(child, `${key}-${index}`, ids, onOpenLink),
  );
}

function renderTableRow(
  row: MarkdownNode,
  key: string,
  header: boolean,
  ids: ReadonlyMap<MarkdownNode, string>,
  onOpenLink: SafeMarkdownProps["onOpenLink"],
) {
  const Cell = header ? "th" : "td";
  return (
    <tr key={key}>
      {(row.children ?? []).map((cell, index) => (
        <Cell key={`${key}-${index}`}>
          {children(cell, `${key}-${index}`, ids, onOpenLink)}
        </Cell>
      ))}
    </tr>
  );
}

function renderNode(
  node: MarkdownNode,
  key: string,
  ids: ReadonlyMap<MarkdownNode, string>,
  onOpenLink: SafeMarkdownProps["onOpenLink"],
): ReactNode {
  switch (node.type) {
    case "root":
      return <div key={key}>{children(node, key, ids, onOpenLink)}</div>;
    case "text":
      return node.value ?? "";
    case "paragraph":
      return <p key={key}>{children(node, key, ids, onOpenLink)}</p>;
    case "heading": {
      const depth = Math.min(6, Math.max(1, node.depth ?? 1));
      const content = children(node, key, ids, onOpenLink);
      const id = ids.get(node);
      if (depth === 1)
        return (
          <h1 id={id} key={key}>
            {content}
          </h1>
        );
      if (depth === 2)
        return (
          <h2 id={id} key={key}>
            {content}
          </h2>
        );
      if (depth === 3)
        return (
          <h3 id={id} key={key}>
            {content}
          </h3>
        );
      if (depth === 4)
        return (
          <h4 id={id} key={key}>
            {content}
          </h4>
        );
      if (depth === 5)
        return (
          <h5 id={id} key={key}>
            {content}
          </h5>
        );
      return (
        <h6 id={id} key={key}>
          {content}
        </h6>
      );
    }
    case "strong":
      return <strong key={key}>{children(node, key, ids, onOpenLink)}</strong>;
    case "emphasis":
      return <em key={key}>{children(node, key, ids, onOpenLink)}</em>;
    case "delete":
      return <del key={key}>{children(node, key, ids, onOpenLink)}</del>;
    case "inlineCode":
      return <code key={key}>{node.value ?? ""}</code>;
    case "inlineMath":
      return renderMath(node, key, false);
    case "math":
      return renderMath(node, key, true);
    case "code":
      if (node.lang?.toLocaleLowerCase() === "mermaid") {
        return (
          <figure
            aria-label="Mermaid 图表占位"
            className="mobile-markdown__diagram"
            key={key}
          >
            <figcaption>Mermaid 图表</figcaption>
            <p>已安全读取图表源码，联网阅读适配器接入后将在这里渲染。</p>
            <details>
              <summary>查看源码</summary>
              <pre>
                <code>{node.value ?? ""}</code>
              </pre>
            </details>
          </figure>
        );
      }
      return (
        <pre key={key}>
          <code data-language={node.lang ?? undefined}>{node.value ?? ""}</code>
        </pre>
      );
    case "blockquote":
      return <blockquote key={key}>{children(node, key, ids, onOpenLink)}</blockquote>;
    case "list": {
      const List = node.ordered ? "ol" : "ul";
      return (
        <List key={key} start={node.ordered ? (node.start ?? undefined) : undefined}>
          {children(node, key, ids, onOpenLink)}
        </List>
      );
    }
    case "listItem":
      return (
        <li
          className={node.checked === null ? undefined : "mobile-markdown__task"}
          key={key}
        >
          {typeof node.checked === "boolean" && (
            <input
              aria-label={node.checked ? "已完成" : "未完成"}
              checked={node.checked}
              disabled
              type="checkbox"
            />
          )}
          {children(node, key, ids, onOpenLink)}
        </li>
      );
    case "link":
      return (
        <button
          className="mobile-markdown__link"
          key={key}
          onClick={() => node.url && onOpenLink?.(node.url)}
          title={node.title ?? undefined}
          type="button"
        >
          {children(node, key, ids, onOpenLink)}
        </button>
      );
    case "image":
      return (
        <span className="mobile-markdown__asset" key={key} role="img">
          <span aria-hidden="true">▧</span>
          <span>
            图片{node.alt ? ` · ${node.alt}` : ""}
            <small>{node.url}</small>
          </span>
        </span>
      );
    case "thematicBreak":
      return <hr key={key} />;
    case "break":
      return <br key={key} />;
    case "table": {
      const [head, ...body] = node.children ?? [];
      return (
        <div className="mobile-markdown__table-scroll" key={key}>
          <table>
            {head && (
              <thead>{renderTableRow(head, `${key}-head`, true, ids, onOpenLink)}</thead>
            )}
            {body.length > 0 && (
              <tbody>
                {body.map((row, index) =>
                  renderTableRow(row, `${key}-row-${index}`, false, ids, onOpenLink),
                )}
              </tbody>
            )}
          </table>
        </div>
      );
    }
    case "html":
      return (
        <code className="mobile-markdown__raw-html" key={key}>
          {node.value ?? ""}
        </code>
      );
    case "definition":
      return null;
    default:
      return <span key={key}>{children(node, key, ids, onOpenLink)}</span>;
  }
}

export function SafeMarkdown({ markdown, onOpenLink }: SafeMarkdownProps) {
  const root = useMemo(() => parseMobileMarkdown(markdown), [markdown]);
  const ids = useMemo(() => mobileMarkdownHeadingIds(root), [root]);
  return (
    <article className="mobile-markdown">
      {renderNode(root, "markdown", ids, onOpenLink)}
    </article>
  );
}
