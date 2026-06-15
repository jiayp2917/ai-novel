import type { ThemeMode } from './types';

export const themeOrder: ThemeMode[] = ['breeze', 'stargold', 'silk'];

export const themeLabels: Record<ThemeMode, string> = {
  breeze: '主题1：清风稿纸',
  stargold: '主题2：星空鎏金',
  silk: '主题3：白丝质感',
};

export const themeShortLabels: Record<ThemeMode, string> = {
  breeze: '清风',
  stargold: '星空',
  silk: '白丝',
};

export function nextTheme(theme: ThemeMode): ThemeMode {
  const currentIndex = themeOrder.indexOf(theme);
  return themeOrder[(currentIndex + 1) % themeOrder.length] ?? 'breeze';
}

export function normalizeTheme(raw: string | null | undefined): ThemeMode {
  if (raw === 'breeze' || raw === 'stargold' || raw === 'silk') {
    return raw;
  }
  if (raw === 'bright') {
    return 'breeze';
  }
  if (raw === 'anime' || raw === 'dark') {
    return 'stargold';
  }
  return 'breeze';
}
