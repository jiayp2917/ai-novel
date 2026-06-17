// 运行时动态选源骨架（参见 docs/ui-refactor-plan.md §7 Phase 1 / §8.2）。
//
// 目标：在 Phase 2+ 引入多格式资源（avif / webp / jpg）时，业务组件只需调用
// `buildAssetUrl(theme, usage)`，由本模块按浏览器能力选择最优格式。
//
// 当前 Phase 1：所有素材统一为 jpg 单源（见 content/assets/theme/<theme>/<usage>.jpg），
// 因此 `detectBestFormat` 在 jsdom / 老旧环境下稳定回退到 "jpg"，
// `buildAssetUrl` 始终返回 jpg 路径。多格式切换留给未来扩展。

export type AssetFormat = "avif" | "webp" | "jpg";

export function detectBestFormat(): AssetFormat {
  if (typeof CSS === "undefined" || !CSS.supports) return "jpg";
  if (CSS.supports("image/avif")) return "avif";
  if (CSS.supports("image/webp")) return "webp";
  return "jpg";
}

export function buildAssetUrl(
  theme: string,
  usage: string,
  format?: AssetFormat,
): string {
  const fmt = format ?? detectBestFormat();
  return fmt === "jpg"
    ? `./assets/theme/${theme}/${usage}.jpg`
    : `./assets/theme/${theme}/${usage}.${fmt}`;
}