import type { ActiveView, InspectorTab, ThemeMode } from './types';

export const STORAGE_KEYS = {
  activeView: 'novel-editor-active-view',
  selectedChapterId: 'novel-editor-selected-chapter-id',
  selectedSourceFileId: 'novel-editor-selected-source-file-id',
  openChapterTabIds: 'novel-editor-open-chapter-tab-ids',
  rightPanelOpen: 'novel-editor-right-panel-open',
  catalogPanelOpen: 'novel-editor-catalog-panel-open',
  writingFullscreen: 'novel-editor-writing-fullscreen',
  chapterFilter: 'novel-editor-chapter-filter',
  inspectorTab: 'novel-editor-inspector-tab',
} as const;

export function initialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'dark';
  }
  return window.localStorage.getItem('novel-editor-theme') === 'light' ? 'light' : 'dark';
}

export function storedString(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(key);
}

export function storedNumber(key: string): number | null {
  const raw = storedString(key);
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function storedBoolean(key: string, fallback: boolean): boolean {
  const raw = storedString(key);
  if (raw === null) {
    return fallback;
  }
  return raw === 'true';
}

export function storedNumberArray(key: string): number[] {
  const raw = storedString(key);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is number => Number.isInteger(item) && item > 0).slice(0, 8);
  } catch {
    return [];
  }
}

export function storeValue(key: string, value: string | number | boolean | null): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (value === null) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, String(value));
}

export function storeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function initialActiveView(): ActiveView {
  const raw = storedString(STORAGE_KEYS.activeView);
  const valid: ActiveView[] = ['home', 'workspace', 'writing', 'planning', 'pipeline', 'review', 'memory', 'fix_publish', 'models'];
  return valid.includes(raw as ActiveView) ? (raw as ActiveView) : 'home';
}

export function initialInspectorTab(): InspectorTab {
  const raw = storedString(STORAGE_KEYS.inspectorTab);
  const valid: InspectorTab[] = ['annotations', 'candidates', 'review', 'memory'];
  return valid.includes(raw as InspectorTab) ? (raw as InspectorTab) : 'annotations';
}
