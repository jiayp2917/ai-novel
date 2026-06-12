import type { ReactNode } from 'react';
import './Chip.css';

export type ChipVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'blue' | 'purple';

export interface ChipProps {
  variant?: ChipVariant;
  children: ReactNode;
  className?: string;
}

const variantClass: Record<ChipVariant, string> = {
  default: '',
  success: ' chip ok',
  warning: ' chip warn',
  error: ' chip danger',
  info: ' chip blue',
  blue: ' chip blue',
  purple: ' chip purple',
};

export function Chip({ variant = 'default', children, className }: ChipProps) {
  const cls = [`ui-chip${variantClass[variant]}`, className].filter(Boolean).join(' ');
  return <span className={cls}>{children}</span>;
}
