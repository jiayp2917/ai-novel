import { useId, type ReactNode } from 'react';
import { Button } from './Button';
import type { ButtonVariant } from './Button';
import { useFocusTrap } from './useFocusTrap';
import './Dialog.css';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  paper?: boolean;
  mark?: ReactNode;
  markVariant?: 'publish' | 'delete';
  className?: string;
}

export function Dialog({ open, onClose, title, children, paper, mark, markVariant, className }: DialogProps) {
  const titleId = useId();
  const containerRef = useFocusTrap<HTMLDivElement>({
    active: open,
    onEscape: onClose,
  });

  if (!open) return null;

  const cls = ['confirm-dialog', paper && 'confirm-dialog--paper', className].filter(Boolean).join(' ');

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        ref={containerRef}
        className={cls}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-dialog__header">
          {(mark || markVariant) && (
            <span className={`confirm-dialog__mark${markVariant ? ` confirm-dialog__mark--${markVariant}` : ''}`}>
              {mark}
            </span>
          )}
          <div>
            <h3 id={titleId}>{title}</h3>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  paper?: boolean;
  children?: ReactNode;
  onConfirm: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  mark?: ReactNode;
  markVariant?: 'publish' | 'delete';
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  message,
  paper,
  children,
  onConfirm,
  onCancel,
  confirmLabel = '确认',
  cancelLabel = '取消',
  confirmVariant = 'primary',
  mark,
  markVariant,
}: ConfirmDialogProps) {
  const handleCancel = () => {
    onCancel?.();
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={title} paper={paper} mark={mark} markVariant={markVariant}>
      {message && <p>{message}</p>}
      {children}
      <div className="confirm-dialog__actions">
        <Button variant="secondary" onClick={handleCancel}>
          {cancelLabel}
        </Button>
        <Button variant={confirmVariant} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
