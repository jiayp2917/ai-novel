import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonSurface = 'raised' | 'flat' | 'paper';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  surface?: ButtonSurface;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  surface = 'paper',
  loading = false,
  disabled,
  icon,
  iconRight,
  children,
  className,
  ...rest
}: ButtonProps) {
  const cls = [
    'ui-btn',
    `ui-btn--${variant}`,
    `ui-btn--${size}`,
    `ui-btn--surface-${surface}`,
    loading && 'ui-btn--loading',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading && <span className="ui-btn__spinner" />}
      {!loading && icon && <span className="ui-btn__icon">{icon}</span>}
      {children && <span className="ui-btn__label">{children}</span>}
      {!loading && iconRight && <span className="ui-btn__icon">{iconRight}</span>}
    </button>
  );
}
