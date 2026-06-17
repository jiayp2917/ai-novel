import { useEffect } from 'react';

type DirtyGuardProps = {
  isDirty: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function DirtyGuard({ isDirty, onConfirm, onCancel }: DirtyGuardProps) {
  useEffect(() => {
    if (!isDirty) {
      onCancel();
      return undefined;
    }
    onConfirm();
    return () => onCancel();
  }, [isDirty, onConfirm, onCancel]);

  return null;
}