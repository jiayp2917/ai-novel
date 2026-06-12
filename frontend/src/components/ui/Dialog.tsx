import { useId, type ReactNode } from 'react';
import { Button } from './Button';
import type { ButtonVariant } from './Button';
import './Dialog.css';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  mark?: ReactNode;
  markVariant?: 'publish' | 'delete';
  className?: string;
}

export function Dialog({ open, onClose, title, children, mark, markVariant, className }: DialogProps) {
  const titleId = useId();

  if (!open) return null;

  const cls = ['confirm-dialog', className].filter(Boolean).join(' ');

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div className={cls} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
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
  children,
  onConfirm,
  onCancel,
  confirmLabel = '确认',
  cancelLabel = '取消',
  confirmVariant = 'primary',
  mark,
  markVariant,
}: ConfirmDialogProps) {
  if (!open) return null;

  const handleCancel = () => {
    onCancel?.();
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={title} mark={mark} markVariant={markVariant}>
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
