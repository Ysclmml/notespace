import type { AppLocale } from "../../app/settings";

const messages: Readonly<Record<string, string>> = {
  exportImageUnresolved: "无法解析图片地址。请先保存文档，并检查图片路径。",
  exportDiagramFailed: "Mermaid 图表无法渲染或渲染超时，请检查图表语法。",
  exportDiagramResource: "图表含有无法离线打包的外部资源。",
  exportDiagramTooLarge: "单个图表超出 4 MiB 导出限制。",
  exportTooManyImages: "最多可导出 128 个不同图片。",
  exportTooManyDiagrams: "最多可导出 64 个 Mermaid 图表。",
  exportRemoteImagesDisabled:
    "文档包含联网图片。请重新导出并勾选“下载并嵌入联网图片”，或先将图片保存到本地。",
  exportImageFailed: "图片不存在、无法读取或不支持离线打包。请检查图片地址与格式。",
  exportImageTooLarge:
    "图片超过导出预算：单图 16 MiB、总计 48 MiB，单图最多 3200 万像素或 128 MiB 解码数据。",
  htmlExportTooLarge: "导出文件超过 80 MiB 大小限制。",
  pdfExport: "PDF 生成失败或超时，请稍后重试。",
  pdfExportTargetInvalid: "请选择普通 PDF 文件，不能覆盖符号链接。",
  htmlExportTargetInvalid: "请选择普通 HTML 文件，不能覆盖源文件或符号链接。",
  pdfExportUnsupported: "PDF 导出目前支持 macOS；其他平台可先导出 HTML。",
  saveTargetAlreadyOpen: "不能用导出文件覆盖源文档、已打开文件或来源图片。请选择其他位置。",
};

export function exportErrorMessage(
  error: unknown,
  locale: AppLocale,
  fallback: string,
): string {
  if (locale !== "zh-CN" || !error || typeof error !== "object" || !("code" in error))
    return fallback;
  const message = typeof error.code === "string" ? messages[error.code] : undefined;
  return message ? `${message}\n${fallback}` : fallback;
}
