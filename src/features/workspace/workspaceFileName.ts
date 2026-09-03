export function normalizeWorkspaceFileName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /(?:^|[^.])\.[^./\\]+$/u.test(trimmed) || trimmed.startsWith(".")
    ? trimmed
    : `${trimmed}.md`;
}
