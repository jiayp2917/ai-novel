import './LoadingSpinner.css';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface LoadingSpinnerProps {
  size?: SpinnerSize;
  className?: string;
}

export function LoadingSpinner({ size = 'md', className }: LoadingSpinnerProps) {
  return <div className={`ui-spinner ui-spinner--${size} ${className ?? ''}`.trim()} />;
}
