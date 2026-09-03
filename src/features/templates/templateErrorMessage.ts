import type { AppLocale } from "../../app/settings";

const messages: Readonly<Record<string, readonly [string, string]>> = {
  templateAlreadyExists: [
    "已有同名模板，请换一个名称。原模板没有被覆盖。",
    "A template with this name already exists. Choose another name; the original was not overwritten.",
  ],
  templateNameInvalid: [
    "请填写单个文件名，不要包含路径分隔符或系统保留字符；名称最多 180 个 UTF-8 字节。",
    "Use one file name without path separators or reserved characters, up to 180 UTF-8 bytes.",
  ],
  templateTooLarge: ["模板正文最多 256 KiB。", "Templates support up to 256 KiB."],
  templateLibraryFull: [
    "模板库已达到读取上限。请打开文件夹整理后刷新，再保存新模板。",
    "The library has reached its listing limit. Organize the folder and refresh before saving another template.",
  ],
  templateInvalidContent: [
    "模板不是有效的 UTF-8 文本，或包含超限内容，无法使用。",
    "The template is not valid UTF-8 or contains oversized content and cannot be used.",
  ],
  templateInvalid: [
    "模板必须是普通的 .md 或 .markdown 文件，不能是文件夹或符号链接。",
    "Choose a regular .md or .markdown file, not a folder or symbolic link.",
  ],
  templateOutsideLibrary: [
    "只能读取模板文件夹内的文件。请刷新后重新选择。",
    "Only files directly inside the templates folder can be used. Refresh and select again.",
  ],
  templateDirectoryInvalid: [
    "模板位置必须是普通文件夹，不能是文件或符号链接。",
    "The templates location must be a regular folder, not a file or symbolic link.",
  ],
};

export function templateErrorMessage(error: unknown, locale: AppLocale): string {
  const code =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
  return (
    messages[code]?.[locale === "zh-CN" ? 0 : 1] ??
    (locale === "zh-CN"
      ? "无法访问模板文件夹或文件。请检查位置和读取／写入权限后重试。"
      : "Could not access the templates folder or file. Check its location and permissions, then retry.")
  );
}
