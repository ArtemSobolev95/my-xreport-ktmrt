'use client';
import { createContext, useCallback, useContext, useMemo, useRef, useState, ReactNode } from 'react';
import AnimatedModal, { ModalBody, ModalButton, ModalFooter, ModalHeader } from './AnimatedModal';

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

  // Между вызовом confirm/alert и тем моментом, когда autoFocus реально
  // переносит фокус на кнопку модалки, есть окно в один-два кадра (модалка
  // ещё не смонтирована/не отыграла autoFocus). Если пользователь в этот
  // момент жмёт Enter привычным рефлексом — событие уходит туда, где фокус
  // был ДО открытия (например, textarea, из которой и вызвали confirm), и
  // Enter просто вставляет перенос строки вместо подтверждения. Модалка
  // получает Enter только со следующего нажатия — на практике это как раз
  // тот самый баг "открой любой сброс и сразу жми Enter": работает через
  // раз, эффект отличается от клика мышью. blur() сразу после сохранения
  // previouslyFocusedRef убирает фокус с исходного поля синхронно, пока
  // browser не переключил его на кнопку — окна для лишнего Enter больше нет.
  const confirm = useCallback((message: string, options?: DialogOptions) => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    previouslyFocusedRef.current?.blur();
    return new Promise<boolean>((resolve) => {
      setPending({ message, isAlert: false, confirmText: 'Да', cancelText: 'Отмена', ...options, resolve });
    });
  }, []);

  const alertFn = useCallback((message: string, options?: DialogOptions) => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    previouslyFocusedRef.current?.blur();
    return new Promise<void>((resolve) => {
      setPending({ message, isAlert: true, confirmText: 'Ок', ...options, resolve: () => resolve() });
    });
  }, []);

  const close = (result: boolean) => {
    pending?.resolve(result);
    setPending(null);
    // Подтверждение по Enter вызывает close() ИЗ ОБРАБОТЧИКА этого самого
    // keydown — если вернуть фокус на исходное поле синхронно прямо здесь,
    // браузер после наших слушателей ещё доигрывает действие по умолчанию
    // для той же клавиши Enter, и оно достаётся уже ПЕРЕФОКУСНУТОМУ полю:
    // для textarea это перенос строки, вставленный в только что закрытую
    // модалку задним числом. setTimeout переносит возврат фокуса в новую
    // задачу, уже после того как браузер полностью обработал это нажатие.
    const target = previouslyFocusedRef.current;
    previouslyFocusedRef.current = null;
    setTimeout(() => target?.focus(), 0);
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

      {/* Единственное окно подтверждения во всём приложении (удаление в
          "Автокоррекциях" тоже идёт через него). Escape/Enter не
          всплывают дальше (stopPropagation): иначе глобальный обработчик
          Escape страницы заполнения закрыл бы заодно и модалку под этим
          окном. */}
      <AnimatedModal
        open={!!pending}
        onClose={() => close(false)}
        size="sm"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close(false);
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            close(true);
          }
        }}
      >
        {displayedPending?.title && <ModalHeader title={displayedPending.title} />}

        <ModalBody>
          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-line">{displayedPending?.message}</p>
        </ModalBody>

        <ModalFooter>
          {!displayedPending?.isAlert && (
            <ModalButton onClick={() => close(false)}>
              {displayedPending?.cancelText}
            </ModalButton>
          )}
          <ModalButton
            onClick={() => close(true)}
            autoFocus
            variant={displayedPending?.danger ? 'danger' : 'primary'}
          >
            {displayedPending?.confirmText}
          </ModalButton>
        </ModalFooter>
      </AnimatedModal>
    </DialogContext.Provider>
  );
}
