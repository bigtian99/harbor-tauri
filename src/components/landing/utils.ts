import { convertFileSrc } from "@tauri-apps/api/core";
import type { LandingPageResult } from "../../types";

/** 生成结果预览 iframe src：优先本地 HTTP 预览服务器，回退 asset 协议 */
export function getTemplateIframeSrc(
  genResult: LandingPageResult,
  templateIdx: number,
  previewBaseUrl: string,
  landingOutputDir: string
): string {
  const idx = genResult.template_dirs && genResult.template_dirs.length > 0 ? templateIdx : 0;
  const base = landingOutputDir;
  if (previewBaseUrl && base) {
    // Windows 路径分隔符是 \，后端 output_dir / landingOutputDir 在 Windows 上都是反斜杠。
    // 这里统一归一化成正斜杠再做前缀判断，否则 startsWith + [len] === "/" 永远不成立，
    // 会回退到 convertFileSrc（asset 协议），iframe 里本地相对路径图片/字体加载不出来。
    const normOut = genResult.output_dir.replace(/\\/g, "/").replace(/\/+$/, "");
    const normBase = base.replace(/\\/g, "/").replace(/\/+$/, "");
    if (normOut.startsWith(normBase) && normOut[normBase.length] === "/") {
      const rel = normOut.slice(normBase.length).replace(/^\/+|\/+$/g, "");
      const file = `${rel}/template_${idx}/index.html`;
      const encoded = file.split("/").map(encodeURIComponent).join("/");
      return `${previewBaseUrl}/${encoded}`;
    }
  }
  return convertFileSrc(`${genResult.output_dir}/template_${idx}/index.html`);
}

/** 模板目录预览 src：优先本地 HTTP，回退 asset 协议 */
export function getTemplatePreviewSrc(
  dir: string,
  previewBaseUrl: string,
  templatesBaseDir: string
): string {
  if (previewBaseUrl) {
    return `${previewBaseUrl}/__templates__/${encodeURIComponent(dir)}/index.html`;
  }
  if (templatesBaseDir) {
    return convertFileSrc(`${templatesBaseDir}/${dir}/index.html`);
  }
  return "";
}

/** 轮播可见下标：1 个居中；2 个并排；≥3 为 prev/current/next */
export function getCarouselIndices(current: number, total: number): number[] {
  const indices: number[] = [];

  if (total === 1) {
    indices.push(0);
  } else if (total === 2) {
    indices.push(0, 1);
  } else {
    indices.push(current > 0 ? current - 1 : total - 1);
    indices.push(current);
    indices.push(current < total - 1 ? current + 1 : 0);
  }

  return indices;
}
