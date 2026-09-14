'use client';
import { AnimatePresence, motion } from 'framer-motion';
import type { KeyboardEvent, ReactNode } from 'react';

// Единая обёртка анимации для всех модалок приложения (framer-motion).
// Свой CSS-transition daisyUI на .modal/.modal-box отключён отдельным
// правилом в globals.css — иначе он играет параллельно с этой анимацией
// и даёт "моргание" в момент своего завершения (см. комментарий там).
// `layout` на боксе дополнительно плавно анимирует изменение размера
// самого бокса при изменении контента (например, когда в модалке
// сравнения добавляются даты) — framer сам считает разницу и анимирует её.
export default function AnimatedModal({
  open,
  onClose,
  onKeyDown,
  boxClassName,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDialogElement>) => void;
  boxClassName: string;
  children: ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.dialog
          className="modal modal-open"
          onKeyDown={onKeyDown}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        >
          <motion.div
            layout
            className={boxClassName}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            {children}
          </motion.div>

          <form method="dialog" className="modal-backdrop">
            <button onClick={onClose}>close</button>
          </form>
        </motion.dialog>
      )}
    </AnimatePresence>
  );
}
