import type { ThemeMode } from './types';

export const themeLabels: Record<ThemeMode, string> = {
  bright: '主题1：轻快动漫',
  anime: '主题2：赛博朋克',
};

export function nextTheme(theme: ThemeMode): ThemeMode {
  return theme === 'anime' ? 'bright' : 'anime';
}
