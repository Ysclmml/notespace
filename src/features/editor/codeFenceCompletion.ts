export interface CodeFenceLanguage {
  readonly id: string;
  readonly aliases?: readonly string[];
}

// Keep the most common choices first. The list is deliberately local to the
// editor: it powers a small typing affordance, not a general language registry.
export const CODE_FENCE_LANGUAGES: readonly CodeFenceLanguage[] = [
  { id: "python", aliases: ["py"] },
  { id: "javascript", aliases: ["js"] },
  { id: "typescript", aliases: ["ts"] },
  { id: "json" },
  { id: "bash", aliases: ["sh", "shell"] },
  { id: "html" },
  { id: "css" },
  { id: "rust", aliases: ["rs"] },
  { id: "java" },
  { id: "c" },
  { id: "cpp", aliases: ["c++"] },
  { id: "csharp", aliases: ["c#", "cs"] },
  { id: "go", aliases: ["golang"] },
  { id: "sql" },
  { id: "yaml", aliases: ["yml"] },
  { id: "markdown", aliases: ["md"] },
  { id: "mermaid" },
  { id: "php" },
  { id: "perl" },
  { id: "perl6" },
  { id: "pascal" },
  { id: "powershell", aliases: ["ps1"] },
  { id: "plaintext", aliases: ["text", "txt"] },
  { id: "pegjs" },
  { id: "pgp" },
  { id: "ruby", aliases: ["rb"] },
  { id: "kotlin", aliases: ["kt"] },
  { id: "swift" },
  { id: "scala" },
  { id: "dart" },
  { id: "lua" },
  { id: "r" },
  { id: "julia" },
  { id: "elixir", aliases: ["ex"] },
  { id: "groovy" },
  { id: "graphql" },
  { id: "jsx" },
  { id: "tsx" },
  { id: "vue" },
  { id: "scss" },
  { id: "xml" },
  { id: "toml" },
  { id: "ini" },
  { id: "diff" },
  { id: "dockerfile", aliases: ["docker"] },
  { id: "objective-c", aliases: ["objc"] },
];

export function codeFenceLanguagePrefix(paragraph: string): string | null {
  return /^```([a-z]{0,32})$/u.exec(paragraph)?.[1] ?? null;
}

export function matchingCodeFenceLanguages(
  prefix: string,
  limit = 8,
): readonly CodeFenceLanguage[] {
  const query = prefix.toLocaleLowerCase();
  const matches = CODE_FENCE_LANGUAGES.filter(
    ({ id, aliases = [] }) =>
      id.startsWith(query) || aliases.some((alias) => alias.startsWith(query)),
  );

  return matches
    .sort((left, right) => {
      const leftExact = left.id === query || left.aliases?.includes(query) ? 0 : 1;
      const rightExact = right.id === query || right.aliases?.includes(query) ? 0 : 1;
      return leftExact - rightExact;
    })
    .slice(0, Math.max(0, limit));
}
