export interface LocalFileReference {
  readonly reference: string;
  readonly path: string;
  readonly line?: number;
}

const TEXT_EXTENSION =
  /\.(?:md|markdown|py|pyw|rs|js|mjs|cjs|ts|mts|cts|tsx|jsx|jsonc?|ya?ml|toml|sh|bash|zsh|fish|sql|java|cs|go|rb|php|swift|kt|kts|c|cc|cpp|cxx|h|hh|hpp|hxx|css|scss|sass|less|html?|xml|svg|vue|svelte|lua|dart|scala|groovy|pl|pm|proto|graphql|gql|ini|conf|cfg|properties|env|txt|log|csv|tsv)$/iu;

export function localFileReferenceFromText(value: string): LocalFileReference | null {
  let reference = value
    .trim()
    .replace(/^`+|`+$/gu, "")
    .trim();
  if (reference.startsWith("<") && reference.endsWith(">")) {
    reference = reference.slice(1, -1).trim();
  }
  if (!reference || /^(?:https?|mailto|data):/iu.test(reference)) return null;

  const match = /^(.*?)(?::(\d+))?$/u.exec(reference);
  const path = match?.[1]?.trim() ?? "";
  const lineText = match?.[2];
  // Classify the path after removing :line. A bare worker.py:12 is a file
  // reference, not a URI whose scheme happens to be "worker.py".
  const unsupportedScheme =
    /^[a-z][a-z\d+.-]*:/iu.test(path) &&
    !/^file:/iu.test(path) &&
    !/^[a-z]:[/\\]/iu.test(path);
  if (!path || unsupportedScheme || !TEXT_EXTENSION.test(path)) return null;

  // This is a concrete-file heuristic, not a glob/template expander. Keep
  // bracketed route names such as [slug] and the Windows long-path prefix.
  const patternPath = path.startsWith("\\\\?\\") ? path.slice(4) : path;
  if (/[*?<>]|\$\{[^}]*\}|\{\{[^}]*\}\}|\{[^{}]*,[^{}]*\}/u.test(patternPath)) {
    return null;
  }
  const line = lineText ? Number.parseInt(lineText, 10) : undefined;
  return {
    reference,
    path,
    line: line && line > 0 ? line : undefined,
  };
}
