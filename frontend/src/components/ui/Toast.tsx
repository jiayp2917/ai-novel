import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import './Toast.css';

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface ToastEntry {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
  warning: () => {},
});

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const push = useCallback((message: string, variant: ToastVariant) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const showToast = useCallback((message: string, variant: ToastVariant = 'info') => {
    push(message, variant);
  }, [push]);

  const value = useMemo<ToastContextValue>(
    () => ({
      showToast,
      success: (message: string) => push(message, 'success'),
      error: (message: string) => push(message, 'error'),
      info: (message: string) => push(message, 'info'),
      warning: (message: string) => push(message, 'warning'),
    }),
    [showToast, push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </ToastContext.Provider>
  );
}

function ToastContainer({ toasts, onDismiss }: { toasts: ToastEntry[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.variant}`} onClick={() => onDismiss(toast.id)}>
          <span className="toast__icon">{variantIcon(toast.variant)}</span>
          <span className="toast__message">{toast.message}</span>
          <button className="toast__close" type="button" onClick={() => onDismiss(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function variantIcon(variant: ToastVariant): string {
  switch (variant) {
    case 'success':
      return '✓';
    case 'error':
      return '✗';
    case 'warning':
      return '⚠';
    case 'info':
    default:
      return 'ℹ';
  }
}
