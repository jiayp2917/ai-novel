// 资源图层模式（AI 化主线，参见 docs/ui-refactor-plan.md §6.5 / §7 Phase 0）。
// 引入本开关是为了在 AI 素材图与纯 CSS 兜底之间提供回滚抓手：
//   - `ai`  优先渲染 AI 生成的纸张 / 弹窗 / 按钮等图层；
//   - `solid` 退化到现有 CSS 渐变 / box-shadow 兜底，不动依赖资产。
//
// 状态通过 `workbench.assetMode` 持久化，与 `theme` 解耦；
// 默认 `ai` 与 docs/ui-refactor-plan.md §6.5 一致。

export type AssetMode = 'ai' | 'solid';

export const ASSET_MODE_STORAGE_KEY = 'workbench.assetMode';
export const ASSET_MODE_ATTR = 'data-asset-mode';

function read(): AssetMode {
  if (typeof window === 'undefined') {
    return 'ai';
  }
  const raw = window.localStorage.getItem(ASSET_MODE_STORAGE_KEY);
  return raw === 'solid' ? 'solid' : 'ai';
}

function applyToDocument(mode: AssetMode) {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.setAttribute(ASSET_MODE_ATTR, mode);
}

let current: AssetMode = read();
applyToDocument(current);

if (typeof window !== 'undefined' && !window.localStorage.getItem(ASSET_MODE_STORAGE_KEY)) {
  window.localStorage.setItem(ASSET_MODE_STORAGE_KEY, current);
}

export function getAssetMode(): AssetMode {
  return current;
}

export function setAssetMode(mode: AssetMode) {
  current = mode;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(ASSET_MODE_STORAGE_KEY, mode);
  }
  applyToDocument(mode);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('workbench-asset-mode', { detail: mode }));
  }
}

// 让业务组件可以订阅变化（Phase 3 Surface 原子层上线后会消费）。
export function onAssetModeChange(listener: (mode: AssetMode) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<AssetMode>).detail;
    if (detail === 'ai' || detail === 'solid') {
      listener(detail);
    }
  };
  window.addEventListener('workbench-asset-mode', handler);
  return () => window.removeEventListener('workbench-asset-mode', handler);
}
