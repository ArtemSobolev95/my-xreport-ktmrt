'use client';
import { useEffect } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { X } from 'lucide-react';

// Единый каркас всех модалок приложения (framer-motion).
//
// Свой, а не daisyUI .modal/.modal-box: у .modal-box собственный padding
// (из-за него разделители под заголовком не доходили до краёв окна, а
// сверху был двойной отступ) и собственные CSS-переходы, которые
// приходилось отключать отдельным правилом.
//
// Анимация: затемнение фона и окно анимируются раздельно. Раньше
// прозрачность меняли и у всего диалога, и у окна внутри него — две
// прозрачности перемножались, и на середине открытия/закрытия окно было
// почти прозрачным, сквозь него читалась страница.
//
// Пока окно доигрывает закрытие, слой не принимает клики (useIsPresent) —
// иначе клик по кнопке на странице в эти ~200 мс попадал в уходящий фон.

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';
const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-4xl',
};

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

// Страница под открытой модалкой не прокручивается (раньше это делал
// daisyUI через .modal-open). Счётчик — модалки бывают вложенными
// (подтверждение поверх "Автокоррекций").
let scrollLockCount = 0;
function useScrollLock() {
  useEffect(() => {
    scrollLockCount += 1;
    if (scrollLockCount === 1) document.documentElement.style.overflow = 'hidden';
    return () => {
      scrollLockCount -= 1;
      if (scrollLockCount === 0) document.documentElement.style.overflow = '';
    };
  }, []);
}

export default function AnimatedModal({
  open,
  onClose,
  onKeyDown,
  size = 'md',
  className = '',
  children,
}: {
  open: boolean;
  onClose: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  size?: ModalSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <ModalLayer onClose={onClose} onKeyDown={onKeyDown} size={size} className={className}>
          {children}
        </ModalLayer>
      )}
    </AnimatePresence>
  );
}

function ModalLayer({
  onClose,
  onKeyDown,
  size,
  className,
  children,
}: {
  onClose: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  size: ModalSize;
  className: string;
  children: ReactNode;
}) {
  const isPresent = useIsPresent();
  useScrollLock();
  return (
    <div
      role="dialog"
      aria-modal="true"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[999] grid place-items-center p-4"
      style={{ pointerEvents: isPresent ? 'auto' : 'none' }}
    >
      <motion.div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      />
      <motion.div
        className={`relative w-full ${SIZE_CLASS[size]} max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden bg-zinc-900 border border-white/10 shadow-2xl rounded-3xl text-white ${className}`}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 4 }}
        transition={{ duration: 0.2, ease: EASE_OUT }}
      >
        {children}
      </motion.div>
    </div>
  );
}

// Шапка: заголовок, необязательные действия справа и кнопка закрытия.
// Разделитель — на всю ширину окна.
export function ModalHeader({
  title,
  subtitle,
  actions,
  onClose,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10 shrink-0">
      <div className="flex-1 min-w-0">
        <h2 className="text-base font-semibold text-white truncate">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-zinc-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="w-8 h-8 -mr-2 shrink-0 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export function ModalBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-6 py-5 overflow-y-auto ${className}`}>{children}</div>;
}

// Нижний ряд кнопок — справа, главная кнопка последней.
export function ModalFooter({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-end gap-2 px-6 py-4 border-t border-white/10 shrink-0 ${className}`}>
      {children}
    </div>
  );
}

type ModalButtonVariant = 'primary' | 'secondary' | 'danger';
const BUTTON_VARIANT_CLASS: Record<ModalButtonVariant, string> = {
  primary: 'bg-amber-400 text-zinc-950 hover:bg-amber-300',
  secondary: 'bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white',
  danger: 'bg-red-500 text-white hover:bg-red-400',
};

// Кнопки модалок — тот же размер и стиль, что у кнопок билдера (h-9,
// rounded-lg): главная залита акцентом, опасная — красным сразу, а не
// только при наведении.
export function ModalButton({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ModalButtonVariant }) {
  return (
    <button
      type="button"
      {...props}
      className={`h-9 px-4 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none ${BUTTON_VARIANT_CLASS[variant]} ${className}`}
    />
  );
}

// Поле ввода в модалках — единый вид (раньше в каждой модалке свой
// padding/скругление).
export const MODAL_INPUT_CLASS =
  'w-full h-10 bg-white/5 border border-white/10 rounded-xl px-3.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/20 transition-colors';
