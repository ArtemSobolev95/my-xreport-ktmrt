'use client';
import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';

interface DialogOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface PendingDialog extends DialogOptions {
  message: string;
  isAlert: boolean;
  resolve: (value: boolean) => void;
}

interface DialogContextValue {
  confirm: (message: string, options?: DialogOptions) => Promise<boolean>;
  alert: (message: string, options?: DialogOptions) => Promise<void>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

// Замена нативных window.alert/window.confirm: те рендерятся браузером как
// системные диалоги (не в теме приложения), эта версия — как обычная модалка.
export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within DialogProvider');
  return ctx;
}

export default function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingDialog | null>(null);

  const confirm = useCallback((message: string, options?: DialogOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ message, isAlert: false, confirmText: 'Да', cancelText: 'Отмена', ...options, resolve });
    });
  }, []);

  const alertFn = useCallback((message: string, options?: DialogOptions) => {
    return new Promise<void>((resolve) => {
      setPending({ message, isAlert: true, confirmText: 'Ок', ...options, resolve: () => resolve() });
    });
  }, []);

  const close = (result: boolean) => {
    pending?.resolve(result);
    setPending(null);
  };

  const value = useMemo(() => ({ confirm, alert: alertFn }), [confirm, alertFn]);

  return (
    <DialogContext.Provider value={value}>
      {children}

      {pending && (
        <dialog
          className="modal modal-open"
          onKeyDown={(e) => {
            if (e.key === 'Escape') close(false);
            if (e.key === 'Enter') close(true);
          }}
        >
          <div className="modal-box bg-zinc-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl max-w-sm mx-4">
            {pending.title && (
              <div className="px-6 pt-5 pb-3 border-b border-white/10">
                <h2 className="text-lg font-semibold text-white">{pending.title}</h2>
              </div>
            )}

            <div className="px-6 py-5">
              <p className="text-sm text-zinc-300 whitespace-pre-line">{pending.message}</p>
            </div>

            <div className="px-6 pb-6 flex gap-3">
              {!pending.isAlert && (
                <button
                  onClick={() => close(false)}
                  data-custom-focus
                  className="flex-1 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-white text-sm font-medium transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
                >
                  {pending.cancelText}
                </button>
              )}
              <button
                onClick={() => close(true)}
                autoFocus
                data-custom-focus
                className={`flex-1 py-3.5 bg-white/5 border rounded-2xl text-sm font-medium transition-all cursor-pointer focus:outline-none focus-visible:ring-2 ${
                  pending.danger
                    ? 'hover:bg-red-500/10 border-white/10 hover:border-red-400 text-white hover:text-red-400 focus-visible:ring-red-400/40'
                    : 'hover:bg-amber-400/10 border-white/10 hover:border-amber-400 text-white hover:text-amber-300 focus-visible:ring-amber-400/40'
                }`}
              >
                {pending.confirmText}
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => close(false)}>close</button>
          </form>
        </dialog>
      )}
    </DialogContext.Provider>
  );
}
