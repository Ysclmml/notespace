import { renderMermaidSvg } from "../editor/mermaidRenderer";
import { buildHtmlExport, type HtmlExportOptions } from "./buildHtmlExport";

export interface ExportImage {
  readonly id: string;
  readonly source: string;
}

export interface ShareableHtmlExport {
  readonly html: string;
  readonly images: readonly ExportImage[];
}

const MAX_IMAGES = 128;
const MAX_DIAGRAMS = 64;
const MAX_SVG_BYTES = 4 * 1024 * 1024;
const MAX_PREPARED_BYTES = 80 * 1024 * 1024;
const STYLE_ATTRIBUTES = new Set([
  "style",
  "fill",
  "stroke",
  "filter",
  "clip-path",
  "mask",
  "marker-start",
  "marker-mid",
  "marker-end",
  "cursor",
]);

function exportError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function hasExternalStyle(value: string): boolean {
  if (/@import|\\/iu.test(value)) return true;
  return [...value.matchAll(/url\(([^)]*)\)/giu)].some(
    (match) =>
      !match[1]
        ?.trim()
        .replace(/^["']|["']$/gu, "")
        .startsWith("#"),
  );
}

/** Keep generated SVG static and namespace its IDs for repeated diagrams. */
export function staticMermaidSvg(markup: string, index: number): string {
  if (new TextEncoder().encode(markup).byteLength > MAX_SVG_BYTES) {
    throw exportError(
      "exportDiagramTooLarge",
      "The Mermaid diagram is too large to export.",
    );
  }
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const svg = parsed.documentElement;
  if (svg.localName !== "svg" || parsed.querySelector("parsererror")) {
    throw exportError("exportDiagramFailed", "The Mermaid diagram could not be rendered.");
  }
  const identifiers = new Map<string, string>();
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    if (
      [
        "script",
        "iframe",
        "object",
        "embed",
        "image",
        "img",
        "video",
        "audio",
        "source",
        "link",
      ].includes(element.localName)
    ) {
      throw exportError(
        "exportDiagramResource",
        "The Mermaid diagram contains a non-portable resource.",
      );
    }
    const id = element.getAttribute("id");
    if (id) identifiers.set(id, `export-mermaid-${index}-${id}`);
    for (const attribute of [...element.attributes]) {
      if (/^on/iu.test(attribute.localName)) element.removeAttributeNode(attribute);
      if (attribute.localName === "href" && !attribute.value.startsWith("#"))
        element.removeAttributeNode(attribute);
      if (STYLE_ATTRIBUTES.has(attribute.localName) && hasExternalStyle(attribute.value)) {
        throw exportError(
          "exportDiagramResource",
          "The Mermaid diagram contains an external style resource.",
        );
      }
    }
    if (element.localName === "style" && hasExternalStyle(element.textContent ?? "")) {
      throw exportError(
        "exportDiagramResource",
        "The Mermaid diagram contains an external style resource.",
      );
    }
  }
  const rewrite = (value: string): string => {
    let result = value;
    // Longest first prevents one ID from consuming another ID's prefix.
    for (const [id, replacement] of [...identifiers].sort(
      (a, b) => b[0].length - a[0].length,
    )) {
      result = result.replaceAll(`#${id}`, () => `#${replacement}`);
    }
    return result;
  };
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      if (attribute.localName === "id")
        attribute.value = identifiers.get(attribute.value) ?? attribute.value;
      else if (
        attribute.localName === "aria-labelledby" ||
        attribute.localName === "aria-describedby"
      ) {
        attribute.value = attribute.value
          .split(/\s+/u)
          .map((id) => identifiers.get(id) ?? id)
          .join(" ");
      } else attribute.value = rewrite(attribute.value);
    }
    if (element.localName === "style")
      element.textContent = rewrite(element.textContent ?? "");
  }
  return new XMLSerializer().serializeToString(svg);
}

/** Uses the latest supplied Markdown, not editor DOM, saved text, or viewport. */
export async function prepareShareableHtml(
  content: string,
  options: Pick<HtmlExportOptions, "title" | "documentPath">,
): Promise<ShareableHtmlExport> {
  const images: ExportImage[] = [];
  const sourceIds = new Map<string, string>();
  const diagrams: { source: string; token: string }[] = [];
  let html = buildHtmlExport(content, {
    ...options,
    portable: true,
    imageSource(source, original) {
      if (!source)
        throw exportError("exportImageUnresolved", `Cannot resolve image: ${original}`);
      const known = sourceIds.get(source);
      if (known) return known;
      if (images.length >= MAX_IMAGES)
        throw exportError(
          "exportTooManyImages",
          "Export supports up to 128 different images.",
        );
      const id = `notespace-export-image-${images.length}`;
      images.push({ id, source });
      sourceIds.set(source, id);
      return id;
    },
    mermaidMarkup(source) {
      if (diagrams.length >= MAX_DIAGRAMS)
        throw exportError(
          "exportTooManyDiagrams",
          "Export supports up to 64 Mermaid diagrams.",
        );
      const token = `<div data-notespace-export-mermaid="${diagrams.length}"></div>`;
      diagrams.push({ source, token });
      return token;
    },
  });
  let preparedBytes = new TextEncoder().encode(html).byteLength;
  const started = Date.now();
  for (const [index, diagram] of diagrams.entries()) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const remaining = 60_000 - (Date.now() - started);
      if (remaining <= 0)
        throw exportError("exportDiagramFailed", "Mermaid export timed out.");
      const rendered = await Promise.race([
        renderMermaidSvg(diagram.source),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(exportError("exportDiagramFailed", "Mermaid export timed out.")),
            Math.min(15_000, remaining),
          );
        }),
      ]);
      const figure = `<figure class="mermaid-diagram">${staticMermaidSvg(rendered, index)}</figure>`;
      preparedBytes += new TextEncoder().encode(figure).byteLength - diagram.token.length;
      if (preparedBytes > MAX_PREPARED_BYTES)
        throw exportError(
          "htmlExportTooLarge",
          "The completed export is larger than 80 MiB.",
        );
      html = html.replace(diagram.token, () => figure);
    } catch (error) {
      if (error instanceof Error && "code" in error) throw error;
      throw exportError(
        "exportDiagramFailed",
        `Mermaid ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  return { html, images };
}
