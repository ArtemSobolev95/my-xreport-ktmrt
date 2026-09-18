'use client';
import { createContext, useCallback, useContext, useMemo, useRef, useState, ReactNode } from 'react';
import AnimatedModal from './AnimatedModal';

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
  // Элемент, у которого был фокус до открытия диалога (обычно поле ввода,
  // с которого пользователь и вызвал confirm/alert) — чтобы вернуть фокус
  // туда же при закрытии, а не оставлять его потерянным на теле документа.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const confirm = useCallback((message: string, options?: DialogOptions) => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    return new Promise<boolean>((resolve) => {
      setPending({ message, isAlert: false, confirmText: 'Да', cancelText: 'Отмена', ...options, resolve });
    });
  }, []);

  const alertFn = useCallback((message: string, options?: DialogOptions) => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    return new Promise<void>((resolve) => {
      setPending({ message, isAlert: true, confirmText: 'Ок', ...options, resolve: () => resolve() });
    });
  }, []);

  const close = (result: boolean) => {
    pending?.resolve(result);
    setPending(null);
    previouslyFocusedRef.current?.focus();
    previouslyFocusedRef.current = null;
  };

  const value = useMemo(() => ({ confirm, alert: alertFn }), [confirm, alertFn]);

  // AnimatedModal держит диалог смонтированным на время анимации закрытия,
  // а `pending` в этот момент уже null — без этого кеша содержимое успевало
  // бы мигнуть пустотой прямо во время затухания. Официальный React-паттерн
  // "adjusting state during rendering" — не useEffect, чтобы не ловить
  // лишний цикл рендера (см. react-hooks/set-state-in-effect).
  const [prevPending, setPrevPending] = useState(pending);
  const [displayedPending, setDisplayedPending] = useState(pending);
  if (pending !== prevPending) {
    setPrevPending(pending);
    if (pending) setDisplayedPending(pending);
  }

  return (
    <DialogContext.Provider value={value}>
      {children}

      <AnimatedModal
        open={!!pending}
        onClose={() => close(false)}
        boxClassName="modal-box bg-zinc-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl max-w-sm mx-4"
        onKeyDown={(e) => {
          if (e.key === 'Escape') close(false);
          if (e.key === 'Enter') close(true);
        }}
      >
        {displayedPending?.title && (
          <div className="px-6 pt-5 pb-3 border-b border-white/10 text-center">
            <h2 className="text-lg font-semibold text-white">{displayedPending.title}</h2>
          </div>
        )}

        <div className="px-6 pt-6 pb-5 text-center">
          <p className="text-sm font-bold text-white leading-relaxed whitespace-pre-line">{displayedPending?.message}</p>
        </div>

        {displayedPending?.isAlert ? (
          <div className="px-6 pb-6 flex justify-center">
            <button
              onClick={() => close(true)}
              autoFocus
              data-custom-focus
              className="px-8 py-2.5 bg-white/5 hover:bg-amber-400/10 border border-white/10 hover:border-amber-400 rounded-xl text-white text-sm font-medium hover:text-amber-300 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
            >
              {displayedPending?.confirmText}
            </button>
          </div>
        ) : (
          <div className="px-6 pb-6 flex gap-3">
            <button
              onClick={() => close(false)}
              data-custom-focus
              className="flex-1 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-white text-sm font-medium transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
            >
              {displayedPending?.cancelText}
            </button>
            <button
              onClick={() => close(true)}
              autoFocus
              data-custom-focus
              className={`flex-1 py-3.5 bg-white/5 border rounded-2xl text-sm font-medium transition-all cursor-pointer focus:outline-none focus-visible:ring-2 ${
                displayedPending?.danger
                  ? 'hover:bg-red-500/10 border-white/10 hover:border-red-400 text-white hover:text-red-400 focus-visible:ring-red-400/40'
                  : 'hover:bg-amber-400/10 border-white/10 hover:border-amber-400 text-white hover:text-amber-300 focus-visible:ring-amber-400/40'
              }`}
            >
              {displayedPending?.confirmText}
            </button>
          </div>
        )}
      </AnimatedModal>
    </DialogContext.Provider>
  );
}
