/** Resolve Markdown links inside the currently shared workspace, never a host path. */
export function mobileDocumentLink(currentPath: string, href: string) {
  const hash = href.indexOf("#");
  const rawPath = hash < 0 ? href : href.slice(0, hash);
  let path: string;
  let anchor: string;
  try {
    path = decodeURIComponent(rawPath);
    anchor = hash < 0 ? "" : decodeURIComponent(href.slice(hash + 1));
  } catch {
    throw new Error("链接地址的编码无效");
  }
  if (!path) return { relativePath: currentPath, anchor };
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//")) {
    throw new Error("目前只支持跳转到当前共享工作区内的 Markdown 文档");
  }
  if (
    path.length > 4096 ||
    /[\\?]/u.test(path) ||
    [...path].some((char) => char.charCodeAt(0) < 32)
  ) {
    throw new Error("文档链接地址无效");
  }
  const parts = path.startsWith("/") ? [] : currentPath.split("/").slice(0, -1);
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("链接超出当前共享工作区");
      parts.pop();
    } else parts.push(part);
  }
  const relativePath = parts.join("/");
  if (!/\.(md|markdown)$/i.test(relativePath)) {
    throw new Error("该链接不是 Markdown 文档");
  }
  return { relativePath, anchor };
}
