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

export const SURFACE_TOKENS = {
  paper: "var(--surface)",
  elevated: "var(--surface-elevated)",
  muted: "var(--surface-muted)",
  bg: "var(--bg)",
  panel: "var(--panel)",
  panel2: "var(--panel-2)",
  buttonBg: "var(--button-bg)",
} as const;

export const TEXT_TOKENS = {
  ink: "var(--ink)",
  muted: "var(--muted)",
  paperInk: "var(--paper-ink)",
  onBrand: "var(--on-brand)",
  brand: "var(--brand)",
  brand2: "var(--brand-2)",
  accent: "var(--accent)",
} as const;

export const STATUS_TOKENS = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  purple: "var(--purple)",
  okBg: "var(--ok-bg)",
  warnBg: "var(--warn-bg)",
  dangerBg: "var(--danger-bg)",
  blueBg: "var(--blue-bg)",
  purpleBg: "var(--purple-bg)",
} as const;

export const LAYOUT_TOKENS = {
  radius: "var(--radius)",
  shadow: "var(--shadow)",
  line: "var(--line)",
} as const;

export const SURFACE_IMAGE_VARS = {
  bg: "var(--surface-bg-image)",
  paper: "var(--surface-paper-image)",
  dialog: "var(--surface-dialog-image)",
  chip: "var(--surface-chip-image)",
  divider: "var(--surface-divider-image)",
  button: "var(--surface-button-image)",
} as const;
