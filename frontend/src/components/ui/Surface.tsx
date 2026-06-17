import type { CSSProperties, ElementType, ReactNode } from 'react';
import { getAssetMode } from '../../assetMode';

export type SurfaceVariant = 'bg' | 'paper' | 'dialog' | 'chip' | 'divider' | 'button';

export interface SurfaceProps {
  variant?: SurfaceVariant;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  as?: ElementType;
}

const VAR_MAP: Record<SurfaceVariant, string> = {
  bg: '--surface-bg-image',
  paper: '--surface-paper-image',
  dialog: '--surface-paper-image',
  chip: '--surface-chip-image',
  divider: '--surface-divider-image',
  button: '--surface-button-image',
};

export function Surface({
  variant = 'paper',
  className,
  style,
  children,
  as: As = 'div',
}: SurfaceProps) {
  const assetMode = getAssetMode();
  const cssVar = `var(${VAR_MAP[variant]})`;
  const isBg = variant === 'bg';
  const baseStyle: CSSProperties = isBg
    ? {
        height: '100vh',
        aspectRatio: '16 / 9',
        minHeight: '100vh',
        backgroundAttachment: 'fixed',
      }
    : {};
  const mergedStyle: CSSProperties = assetMode === 'solid'
    ? {
        ...baseStyle,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        ...style,
      }
    : {
        ...baseStyle,
        backgroundImage: cssVar,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        ...style,
      };
  const cls = ['surface', `surface--${variant}`, `surface--${assetMode}`, className].filter(Boolean).join(' ');
  return (
    <As className={cls} style={mergedStyle}>
      {children}
    </As>
  );
}
