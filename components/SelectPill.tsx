import { forwardRef, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import { measureTextPx } from '../lib/fieldLabels';

// Поле «Список» на странице заполнения — «таблетка» и свой выпадающий
// список в стиле приложения вместо системного (у нативного select список
// рисует ОС, и он выбивался из тёмной темы).
//
// Клавиатура — как у select: Enter / пробел / ↓ открывают список, ↑↓ —
// выбор, Enter — выбрать, Esc — закрыть, буква — к варианту на эту букву.
// Tab закрывает список и уходит дальше обычной навигацией страницы
// (onKeyDown родителя). Фокус всё время на кнопке: клики по списку его не
// забирают (preventDefault на mousedown).

interface SelectPillProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  // Навигация страницы (Tab между полями) — когда список закрыт.
  onKeyDown?: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
  tabIndex?: number;
  placeholder?: string;
}

const SelectPill = forwardRef<HTMLButtonElement, SelectPillProps>(function SelectPill(
  { value, options, onChange, onFocus, onBlur, onKeyDown, tabIndex, placeholder = 'выберите вариант…' },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeaheadRef = useRef({ text: '', at: 0 });

  // Первая строка — «не выбрано», чтобы выбор можно было снять.
  const items = ['', ...options];
  const shown = value || placeholder;

  const openList = () => {
    setHighlight(Math.max(0, items.indexOf(value)));
    setOpen(true);
  };

  const choose = (index: number) => {
    const next = items[index];
    if (next !== undefined && next !== value) onChange(next);
    setOpen(false);
  };

  // Клик мимо — закрыть.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Подсвеченный вариант — в видимой части списка.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight]);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.ctrlKey || e.metaKey) {
      onKeyDown?.(e);
      return;
    }
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openList();
        return;
      }
      onKeyDown?.(e);
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlight(h => Math.min(items.length - 1, h + 1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        setHighlight(h => Math.max(0, h - 1));
        return;
      case 'Home':
        e.preventDefault();
        setHighlight(0);
        return;
      case 'End':
        e.preventDefault();
        setHighlight(items.length - 1);
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(highlight);
        return;
      case 'Escape':
        // Только закрыть список — не трогать другие обработчики Esc.
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        return;
      case 'Tab':
        setOpen(false);
        onKeyDown?.(e);
        return;
    }
    // Буквы — к варианту, который начинается с набранного (как в select).
    if (e.key.length === 1 && !e.altKey) {
      const now = Date.now();
      const ta = typeaheadRef.current;
      ta.text = now - ta.at < 700 ? ta.text + e.key.toLowerCase() : e.key.toLowerCase();
      ta.at = now;
      const found = items.findIndex((o, i) => i > 0 && o.toLowerCase().startsWith(ta.text));
      if (found !== -1) setHighlight(found);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-flex max-w-full align-top">
      <button
        ref={ref}
        type="button"
        data-custom-focus
        aria-haspopup="listbox"
        aria-expanded={open}
        tabIndex={tabIndex}
        title={value || undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onFocus={onFocus}
        onBlur={() => {
          setOpen(false);
          onBlur?.();
        }}
        onKeyDown={handleKeyDown}
        // текст + px-2.5 слева + место под шеврон справа + рамки
        style={{ width: measureTextPx(shown, value ? 500 : 400) + 42 }}
        className={`relative max-w-full truncate text-left cursor-pointer rounded-lg border pl-2.5 pr-7 py-0.5 text-sm leading-tight transition-colors focus:outline-none ${
          value
            ? 'border-amber-400/40 bg-amber-400/10 font-medium text-amber-400 hover:bg-amber-400/15'
            : 'border-white/10 bg-white/[0.06] text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
        } ${open ? (value ? 'bg-amber-400/15' : 'bg-white/10 text-zinc-200') : ''}`}
      >
        {shown}
        <ChevronDown
          aria-hidden="true"
          className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''} ${value ? 'text-amber-400' : 'text-zinc-500'}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            ref={listRef}
            role="listbox"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            onMouseDown={e => e.preventDefault()}
            className="absolute left-0 top-full mt-1 z-40 min-w-full w-max max-w-[min(28rem,80vw)] max-h-64 overflow-y-auto rounded-xl bg-zinc-900 border border-white/10 shadow-2xl p-1 origin-top"
          >
            {items.map((opt, i) => {
              const isSelected = opt === value;
              return (
                <li
                  key={i}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => choose(i)}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm cursor-pointer ${
                    i === highlight ? 'bg-white/10' : ''
                  } ${opt ? (isSelected ? 'text-amber-400' : 'text-zinc-200') : 'text-zinc-500'}`}
                >
                  <span className="flex-1 min-w-0 break-words">{opt || 'не выбрано'}</span>
                  {isSelected && opt && <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
});

export default SelectPill;
