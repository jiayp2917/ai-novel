import type { ContextMenuState } from '../types';

export function placeContextMenu(menu: ContextMenuState): ContextMenuState {
  if (!menu) {
    return null;
  }
  const estimatedWidth = 280;
  const estimatedHeight = 260;
  return {
    ...menu,
    x: Math.max(8, Math.min(menu.x, window.innerWidth - estimatedWidth - 8)),
    y: Math.max(8, Math.min(menu.y, window.innerHeight - estimatedHeight - 8)),
  };
}

export function searchMatchCount(text: string, query: string): number {
  const normalized = query.trim();
  return normalized ? text.split(normalized).length - 1 : 0;
}
