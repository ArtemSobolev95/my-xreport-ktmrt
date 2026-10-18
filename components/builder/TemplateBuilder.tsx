'use client';
import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import pb from '../../lib/pocketbase';
pb.autoCancellation(false);
import {
  Trash2, ChevronRight, ChevronDown, ClipboardCheck,
  Heading, Type, List, Calculator,
  Plus, Minus, ImagePlus, Link, Copy, Circle, CircleDot, ArrowLeft, ArrowRight, Save,
  LayoutList, MousePointerClick, Globe,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  pointerWithin,
  type CollisionDetection,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import type { BuilderField, FieldType, QuickButtonGroup } from '../../types/builder';

import { motion, AnimatePresence } from 'framer-motion';
import withAuth from '../../components/withAuth';
import UserHeader from '../../components/UserHeader';
import dynamic from 'next/dynamic';
import { migrateQuickButtons } from '../../lib/migrateQuickButtons';
import { migrateLegacyField } from '../../lib/migrateFieldTypes';
import { LABELS_UPPERCASE_KEY, LABEL_CHIP_PADDING_PX, labelColumnWidth, measureLabelPx, measureTextPx, sectionLabelWidths } from '../../lib/fieldLabels';
import { DOCK_BUTTON_CLASS, DOCK_COLUMN_CLASS, DOCK_PANEL_CLASS, PAGE_COLUMNS_CLASS, SIDE_PANEL_TOP_CLASS } from '../../lib/pageLayout';
import { evaluateFormula } from '../../lib/evaluateFormula';
import { useDialog } from '../DialogProvider';
import CollapseRow from '../CollapseRow';
import AnimatedModal, { ModalBody, ModalButton, ModalFooter, ModalHeader, MODAL_INPUT_CLASS } from '../AnimatedModal';



// Правая панель конструктора шире, чем на странице заполнения: здесь
// группы быстрых кнопок редактируются, а не только выбираются.
const RIGHT_COLUMN_CLASS = 'w-96 shrink-0';

// Должен создаваться один раз на уровне модуля, а не внутри тела
// компонента: dynamic() возвращает НОВЫЙ компонент при каждом вызове, и
// вызов его на каждом рендере (как было раньше) заставлял React считать
// хедер каждый раз другим типом компонента — он размонтировался и
// монтировался заново при любом изменении fields (добавление/удаление/
// дублирование поля), на мгновение схлопываясь в высоту 0 и тут же
// раскрываясь обратно. Из-за этого сдвигалось всё, что ниже хедера —
// и левая панель инструментов, и центральная колонка с полями (сама по
// себе никак не связанная с высотой списка полей) — то самое "моргание
// всей страницы". Подтверждено через PerformanceObserver({type:
// 'layout-shift'}): source-элементом сдвига оказывался именно
// .flex.flex-1.overflow-hidden — контейнер, оборачивавший обе панели (в
// прежней раскладке).
const DynamicUserHeader = dynamic(() => import('../../components/UserHeader'), { ssr: false });

// Иконки — один набор (lucide), один размер и толщина линий. Раньше здесь
// были смешаны heroicons, lucide и самодельная залитая SVG у "Шкала",
// заметно тяжелее остальных.
const TOOL_ICON_CLASS = 'w-[18px] h-[18px]';
// «Число», «Чекбокс» и «Шкала» больше не создаются — их заменяет текстовое
// поле с быстрыми кнопками (старые шаблоны преобразуются при загрузке).
const availableFields = [
  { type: 'header' as FieldType, label: 'Заголовок', icon: <Heading className={TOOL_ICON_CLASS} strokeWidth={1.75} /> },
  { type: 'text' as FieldType, label: 'Текст', icon: <Type className={TOOL_ICON_CLASS} strokeWidth={1.75} /> },
  { type: 'select' as FieldType, label: 'Список', icon: <List className={TOOL_ICON_CLASS} strokeWidth={1.75} /> },
  { type: 'formula' as FieldType, label: 'Формула', icon: <Calculator className={TOOL_ICON_CLASS} strokeWidth={1.75} /> },
  { type: 'conclusion' as FieldType, label: 'Заключение', icon: <ClipboardCheck className={TOOL_ICON_CLASS} strokeWidth={1.75} /> },
];

// "1 фраза / 2 фразы / 5 фраз"
function pluralRu(n: number, forms: [string, string, string]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

// Небольшие кнопки с иконкой и подписью (заметки: "Ссылка", "Изображение").
const NOTES_ACTION_CLASS = 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs text-zinc-300 bg-white/5 hover:bg-white/10 hover:text-white transition-colors cursor-pointer';

// Кнопки-иконки, которые видны только при наведении/фокусе на свою строку
// (группа Tailwind "row") — вместо постоянных +/− у каждой строки.
// Шрифт и отступы содержимого строки — как у строк страницы заполнения
// (CONTENT_TEXT_CLASS в pages/filler.tsx); общие у поля и его прозрачного
// зеркала, иначе разойдутся переносы и «]» встанет не туда.
const ROW_TEXT_BASE_CLASS = 'py-0.5 text-sm leading-tight';
const ROW_TEXT_CLASS = `pl-[8px] pr-1 ${ROW_TEXT_BASE_CLASS}`;
const ROW_ACTION_CLASS = 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 transition-[opacity,color]';

// Одна перетаскиваемая строка варианта в инструменте "Список" — своя ручка
// (DragDot) слева вместо кнопок вверх/вниз: перетаскивание мышью проще
// и выглядит аккуратнее, чем стрелки, упирающиеся в правый край карточки.
function SortableOption({
  id,
  option,
  isDefault,
  onToggleDefault,
  onChange,
  onRemove,
}: {
  id: string;
  option: string;
  isDefault: boolean;
  onToggleDefault: () => void;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, transition: SORTABLE_TRANSITION });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="group/row flex items-center gap-2">
      <div {...attributes} {...listeners} className="w-4 h-4 flex items-center justify-center shrink-0 cursor-grab active:cursor-grabbing text-zinc-500 hover:text-white transition-colors">
        <DragDot />
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleDefault();
        }}
        className={`flex-shrink-0 transition-colors cursor-pointer ${isDefault ? 'text-amber-400' : 'text-zinc-500 hover:text-white'}`}
        aria-label="По умолчанию"
        aria-pressed={isDefault}
      >
        {/* Выбор значения по умолчанию — как радиокнопка: один вариант */}
        {isDefault ? <CircleDot className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
      </button>

      {/* На всю ширину редактора — длинные варианты не обрезаются. */}
      <input
        type="text"
        value={option}
        onChange={e => onChange(e.target.value)}
        className="flex-1 min-w-0 bg-transparent border-0 rounded-md px-1 py-0.5 text-white placeholder:text-zinc-400 focus:outline-none focus:bg-white/5 transition-colors text-sm"
        placeholder="Введите значение"
      />

      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className={`text-zinc-500 hover:text-red-400 cursor-pointer ml-1 ${ROW_ACTION_CLASS}`}
        aria-label="Удалить вариант"
      >
        <Minus className="w-4 h-4" />
      </button>
    </div>
  );
}

// Одна перетаскиваемая ссылка в инструменте "Заметки" — та же строка, что
// SortableOption в "Список" (ручка DragDot слева, удаление справа при
// наведении), вместо прежних шевронов вверх/вниз.
function SortableNoteLink({
  id,
  text,
  url,
  onRemove,
}: {
  id: string;
  text: string;
  url: string;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, transition: SORTABLE_TRANSITION });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="group/row flex items-center gap-2">
      <div {...attributes} {...listeners} className="w-4 h-4 flex items-center justify-center shrink-0 cursor-grab active:cursor-grabbing text-zinc-500 hover:text-white transition-colors">
        <DragDot />
      </div>

      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 truncate px-1 py-0.5 text-sm text-white hover:text-amber-400 underline underline-offset-2 decoration-white/30 transition-colors"
      >
        {text}
      </a>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className={`shrink-0 text-zinc-500 hover:text-red-400 cursor-pointer ml-1 ${ROW_ACTION_CLASS}`}
        aria-label="Удалить ссылку"
      >
        <Minus className="w-4 h-4" />
      </button>
    </div>
  );
}


// Заметки шаблона — ссылки и изображения, общие для всего шаблона (на
// странице заполнения они открываются одним окном по кнопке "Заметки").
// Раньше это был отдельный тип поля в центральной колонке, хотя его
// положение среди полей ничего не значило; теперь — постоянный блок внизу
// правой панели. Формат хранения прежний: строки "[текст](url)".
function NotesPanel({
  notes,
  onChange,
  onAddLink,
  onAddImage,
}: {
  notes: string;
  onChange: (notes: string) => void;
  onAddLink: () => void;
  onAddImage: () => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // id для drag-and-drop строится из самой строки (плюс номер повтора —
  // одинаковые строки допустимы), а не хранится отдельно: ссылки
  // добавляются снаружи (окно "Добавить ссылку" в TemplateBuilder), и
  // отдельный массив id разъезжался бы с notes. При перестановке id строки
  // не меняется — dnd-kit видит тот же элемент.
  const lines = notes.split('\n').filter(Boolean);
  const links = (() => {
    const seen = new Map<string, number>();
    return lines.flatMap((line, index) => {
      const n = seen.get(line) ?? 0;
      seen.set(line, n + 1);
      const match = line.match(/\[(.*?)\]\((.*?)\)/);
      if (!match) return [];
      return [{ id: `${n}:${line}`, index, text: match[1], url: match[2] }];
    });
  })();

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = links.find(l => l.id === active.id)?.index;
    const to = links.find(l => l.id === over.id)?.index;
    if (from === undefined || to === undefined) return;
    onChange(arrayMove(lines, from, to).join('\n'));
  };

  const removeLine = (index: number) => {
    onChange(lines.filter((_, i) => i !== index).join('\n'));
  };

  return (
    <div className="shrink-0 max-h-[45%] flex flex-col border-t border-white/10">
      <div className="px-4 pt-4 pb-3">
        <h3 className="font-semibold tracking-tight">Заметки</h3>
        <p className="text-xs text-zinc-500">Общие для шаблона — при заполнении откроются по кнопке «Заметки»</p>
        <div className="mt-2 flex items-center gap-2">
          <button onClick={onAddLink} className={`shrink-0 ${NOTES_ACTION_CLASS}`}>
            <Link className="w-3.5 h-3.5" />
            Ссылка
          </button>
          <button onClick={onAddImage} className={`shrink-0 ${NOTES_ACTION_CLASS}`}>
            <ImagePlus className="w-3.5 h-3.5" />
            Изображение
          </button>
        </div>
      </div>

      {/* Перетаскивание — так же, как варианты в "Список": ручка DragDot,
          строки в CollapseRow (плавное появление/удаление), отступы — py
          внутри строки. Своя прокрутка: список может быть длинным, а блок
          ограничен по высоте, чтобы не вытеснять быстрые кнопки. */}
      <div className="min-h-0 overflow-auto px-4 pb-4 [scrollbar-gutter:stable]">
        {/* Список в разметке всегда, а подсказка — отдельно: иначе при
            удалении последней ссылки список размонтировался бы вместе с
            ней, и она пропадала без анимации. */}
        {links.length === 0 && (
          <p className="py-1 text-sm text-zinc-500">Ссылок и изображений пока нет.</p>
        )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={links.map(l => l.id)} strategy={verticalListSortingStrategy}>
              <div>
                <AnimatePresence initial={false}>
                  {links.map(link => (
                    <CollapseRow key={link.id}>
                      <div className="py-1">
                        <SortableNoteLink
                          id={link.id}
                          text={link.text}
                          url={link.url}
                          onRemove={() => removeLine(link.index)}
                        />
                      </div>
                    </CollapseRow>
                  ))}
                </AnimatePresence>
              </div>
            </SortableContext>
          </DndContext>
      </div>
    </div>
  );
}

// Пустое состояние: иконка в плашке, заголовок и короткая подсказка,
// что делать дальше — вместо одной строки серого текста.
function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center text-center py-16 px-6">
      <div className="w-11 h-11 mb-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400">
        {icon}
      </div>
      <div className="text-sm font-medium text-zinc-200">{title}</div>
      <div className="mt-1 max-w-xs text-sm leading-relaxed text-zinc-500">{text}</div>
    </div>
  );
}

// Ручка перетаскивания — одна точка по центру высоты строки (вместо
// шести точек GripVertical). Сама точка маленькая, поэтому зона захвата —
// обёртка вокруг неё (w-6 h-6 / w-4 h-4 у вызывающего кода).
function DragDot() {
  return <span aria-hidden="true" className="block w-[5px] h-[5px] rounded-full bg-current" />;
}

// Цель при перетаскивании групп — карточка под курсором. closestCenter
// сравнивает центры, а группы сильно разной высоты: чтобы поменять местами
// с длинной группой, пришлось бы тянуть до её середины. Курсор в промежутке
// между карточками — запасной вариант, ближайший центр.
const groupCollisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : closestCenter(args);
};

// Кривая для сдвига соседей при перетаскивании (dnd-kit) — "ease-out
// quint": быстрый старт и мягкое торможение вместо стандартной ease.
const SORTABLE_TRANSITION = { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };

// Максимум групп быстрых кнопок у поля — на странице заполнения группы
// вызываются горячими клавишами Ctrl+1..9, десятой клавиши нет.
const MAX_QUICK_BUTTON_GROUPS = 9;

// Одна карточка группы быстрых кнопок в правой панели — перетаскиваемая
// (сортировка групп по сетке, номер = позиция = горячая клавиша Ctrl+N в
// заполнении). Вынесена в компонент ради стабильных id фраз: phrases —
// обычный string[] без id, а анимировать появление/исчезновение
// конкретной строки (AnimatePresence) можно только по стабильному key —
// индекс при удалении из середины "переезжает" на соседнюю строку. id
// живут в локальном state и меняются ТОЛЬКО вместе с phrases этими же
// хендлерами (как optionIds у "Список").
function SortableQuickButtonGroup({
  group,
  index,
  disableLayoutAnimation,
  onChange,
  onRemove,
}: {
  group: QuickButtonGroup;
  index: number;
  disableLayoutAnimation: boolean;
  onChange: (mutate: (group: QuickButtonGroup) => void) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.id, transition: SORTABLE_TRANSITION });
  // Translate, не Transform: у карточек разная высота, и scaleY из
  // CSS.Transform растягивал бы перетаскиваемую карточку под размер той,
  // на место которой она встаёт.
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const phrases = group.phrases || [];
  const [phraseIds, setPhraseIds] = useState<string[]>(() => phrases.map(() => crypto.randomUUID()));
  // Страховка на случай, если фразы поменялись не через хендлеры ниже:
  // "adjusting state during rendering", не useEffect (как deleteConfirm в
  // filler.tsx) — иначе один рендер прошёл бы с несовпадающими key.
  if (phraseIds.length !== phrases.length) {
    setPhraseIds(phrases.map(() => crypto.randomUUID()));
  }
  // Только что добавленная фраза получает фокус — чтобы сразу печатать.
  const [focusPhraseId, setFocusPhraseId] = useState<string | null>(null);

  const addPhraseAfter = (pIndex: number) => {
    const newId = crypto.randomUUID();
    onChange(g => { g.phrases.splice(pIndex + 1, 0, ''); });
    setPhraseIds(ids => [...ids.slice(0, pIndex + 1), newId, ...ids.slice(pIndex + 1)]);
    setFocusPhraseId(newId);
  };

  const removePhrase = (pIndex: number) => {
    onChange(g => { g.phrases.splice(pIndex, 1); });
    setPhraseIds(ids => ids.filter((_, i) => i !== pIndex));
  };

  return (
    // Та же схема из двух motion.div, что у карточек полей (SortableField):
    // внешний — только layout (плавный сдвиг соседей при добавлении/
    // удалении групп), внутренний — только появление/исчезновение, а
    // dnd-kit — на самом внутреннем div, у каждого своя часть transform.
    <motion.div
      layout={disableLayoutAnimation ? false : 'position'}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className={isDragging ? 'relative z-10' : ''}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
      <div
        ref={setNodeRef}
        style={style}
        className={`bg-white/[0.03] border border-white/10 rounded-3xl px-4 py-3 transition-shadow ${isDragging ? 'shadow-2xl' : ''}`}
      >
      {/* Группа */}
      <div className="flex items-center gap-2">
        <div
          {...attributes}
          {...listeners}
          className="w-4 h-4 flex items-center justify-center shrink-0 cursor-grab active:cursor-grabbing text-zinc-400 hover:text-white transition-colors"
        >
          <DragDot />
        </div>
        <button
          onClick={() => onChange(g => { g.isExpanded = !g.isExpanded; })}
          className="text-zinc-400 hover:text-white transition-[color,transform] cursor-pointer shrink-0"
          style={{ transform: group.isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <ChevronRight size={16} />
        </button>
        <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-medium rounded bg-white/10 text-zinc-300 shrink-0">
          {index + 1}
        </span>
        <input
          type="text"
          value={group.label}
          onChange={e => {
            const value = e.target.value;
            onChange(g => { g.label = value; });
          }}
          className="flex-1 min-w-0 bg-transparent text-sm font-semibold outline-none"
          placeholder="Название группы"
        />
        <span className="text-xs text-zinc-500 shrink-0">
          {phrases.filter(Boolean).length} {pluralRu(phrases.filter(Boolean).length, ['фраза', 'фразы', 'фраз'])}
        </span>
        <button
          onClick={onRemove}
          className="text-zinc-500 hover:text-red-400 transition-colors cursor-pointer shrink-0"
          aria-label="Удалить группу"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* Фразы */}
      <AnimatePresence initial={false}>
        {group.isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="mt-2 pt-2 border-t border-white/10">
            {/* Каждая строка сама анимирует высоту 0 ↔ auto — за счёт
                этого и вся карточка плавно растёт/сжимается при добавлении
                и удалении фраз. Отступы между строками — py внутри строки,
                а не space-y: margin у анимируемого по высоте элемента
                прыгал бы скачком в начале/конце анимации. */}
            <AnimatePresence initial={false}>
            {phrases.map((phrase, pIndex) => (
              <CollapseRow key={phraseIds[pIndex] ?? pIndex}>
              <div className="group/row flex items-center gap-1 py-px">
                <input
                  type="text"
                  value={phrase}
                  autoFocus={phraseIds[pIndex] === focusPhraseId}
                  onChange={e => {
                    const value = e.target.value;
                    onChange(g => { g.phrases[pIndex] = value; });
                  }}
                  onKeyDown={e => {
                    // Enter в строке — новая фраза сразу под ней.
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addPhraseAfter(pIndex);
                    }
                  }}
                  className="flex-1 min-w-0 bg-transparent border-0 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:bg-white/5 transition-colors"
                  placeholder="Фраза"
                />
                <button
                  onClick={() => addPhraseAfter(pIndex)}
                  className={`text-zinc-400 hover:text-amber-400 cursor-pointer shrink-0 ${ROW_ACTION_CLASS}`}
                  aria-label="Добавить фразу ниже"
                >
                  <Plus className="w-4 h-4" />
                </button>
                {/* Фантомная ячейка той же ширины у первой фразы — чтобы "+"
                    у всех строк стоял в одной колонке. */}
                {pIndex > 0 ? (
                  <button
                    onClick={() => removePhrase(pIndex)}
                    className={`text-zinc-400 hover:text-red-400 cursor-pointer shrink-0 ${ROW_ACTION_CLASS}`}
                    aria-label="Удалить фразу"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                ) : (
                  <span className="w-4 h-4 shrink-0" aria-hidden="true" />
                )}
              </div>
              </CollapseRow>
            ))}
            </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
      </motion.div>
    </motion.div>
  );
}

// Норма текстового поля в конструкторе — так же, как содержимое строки на
// странице заполнения: в [ ], растёт по тексту, закрывающая «]» сразу после
// последнего символа (прозрачное зеркало текста с теми же отступами).
function BracketTextarea({
  value,
  onChange,
  placeholder,
  unit,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  unit?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <div className="relative">
      <span aria-hidden="true" className={`pointer-events-none select-none absolute left-0 top-0 ${ROW_TEXT_BASE_CLASS} text-zinc-500`}>[</span>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`block w-full bg-transparent border-0 resize-none overflow-hidden focus:outline-none ${ROW_TEXT_CLASS} text-zinc-400 placeholder:text-zinc-600`}
      />
      <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 top-0 ${ROW_TEXT_CLASS} whitespace-pre-wrap break-words text-transparent`}>
        {value || placeholder}
        <span className="ml-[2px] text-zinc-500">]</span>
        {unit && <span className="ml-1.5 text-zinc-500">{unit}</span>}
      </div>
    </div>
  );
}

// Строка поля конструктора — как строка страницы заполнения (pages/filler.tsx):
// «Название: [норма]», колонка названий общая в разделе, заголовок раздела —
// строка с линией. Кнопки (перетащить / дублировать / удалить) — в конце
// строки при наведении или у выбранной. Варианты «Списка» и переменные
// «Формулы» редактируются под строкой, пока она выбрана.
function SortableField({
  field,
  isSelected,
  labelColumnPx,
  uppercase,
  disableLayoutAnimation,
  onSelect,
  onRemove,
  onUpdate,
  onDuplicate,
}: {
  field: BuilderField;
  isSelected: boolean;
  labelColumnPx: number;
  uppercase: boolean;
  disableLayoutAnimation: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<BuilderField>) => void;
  onDuplicate: (id: string) => void;
}) {
  // Перетаскивается сама строка (без DragOverlay-копии) — как группы
  // быстрых кнопок. animateLayoutChanges по умолчанию у dnd-kit срабатывает
  // только сразу после drop (доводит брошенную строку до нового места);
  // layout-анимацию framer на это время выключает disableLayoutAnimation
  // (см. isDraggingField в TemplateBuilder), чтобы сдвиг не шёл дважды.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
    transition: SORTABLE_TRANSITION,
  });
  // Инлайн, не className: opacity/transition у dnd-kit приходят как
  // инлайн-стиль (transform — для drag), а инлайн-стиль всегда побеждает
  // className по каскаду. Translate, не Transform: у строк разная высота, и
  // scaleY из CSS.Transform растягивал бы перетаскиваемую строку под размер
  // той, на место которой она встаёт.
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // Стабильные id вариантов "Список" для drag-and-drop — только для
  // useSortable, наружу (в БД/шаблон) не идут. field.options — обычный
  // string[] (см. types/builder.ts), в нём нет id, а по индексу/значению
  // dnd-kit различать элементы при перетаскивании нельзя (индекс меняется
  // при каждом свапе, значение может повторяться). Генерируются один раз
  // при монтировании поля и дальше держатся в ЛОКАЛЬНОМ state в связке с
  // add/remove/reorder-хендлерами ниже — никакой синхронизации с
  // field.options по длине не требуется, так как оба массива меняются
  // ТОЛЬКО вместе, этими же хендлерами.
  const [optionIds, setOptionIds] = useState<string[]>(() => (field.options || []).map(() => crypto.randomUUID()));
  const optionSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...(field.options || [])];
    newOptions[index] = value;
    onUpdate(field.id, { options: newOptions });
  };

  const handleAddOption = () => {
    onUpdate(field.id, { options: [...(field.options || []), ''] });
    setOptionIds(prev => [...prev, crypto.randomUUID()]);
  };

  const handleRemoveOption = (index: number) => {
    onUpdate(field.id, { options: (field.options || []).filter((_, i) => i !== index) });
    setOptionIds(prev => prev.filter((_, i) => i !== index));
  };

  const handleOptionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = optionIds.indexOf(active.id as string);
    const newIndex = optionIds.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    onUpdate(field.id, { options: arrayMove(field.options || [], oldIndex, newIndex) });
    setOptionIds(prev => arrayMove(prev, oldIndex, newIndex));
  };

  const formulaValues = useMemo(() => {
    const values: Record<string, number> = {};
    (field.variables || []).forEach(v => {
      values[v.name] = v.value ? parseFloat(v.value) || 0 : 0;
    });
    return values;
  }, [field.variables]);

  const evaluateFormulaPreview = (expr: string) => {
    if (!expr) return '—';
    try {
      const result = evaluateFormula(expr, formulaValues);
      // NaN/∞ обычно значит «примеры значений не заданы» (0/0) — не ошибка.
      return Number.isFinite(result) ? Number(result).toFixed(2) : '—';
    } catch {
      return 'Ошибка';
    }
  };

  // Стабильные id переменных формулы — только для key анимации строк
  // (CollapseRow): по индексу при удалении из середины исчезала бы
  // последняя строка, а не удалённая. Меняются только вместе с variables
  // в add/remove ниже (как optionIds у "Список").
  const [variableIds, setVariableIds] = useState<string[]>(() => (field.variables || []).map(() => crypto.randomUUID()));
  if (variableIds.length !== (field.variables || []).length) {
    setVariableIds((field.variables || []).map(() => crypto.randomUUID()));
  }

  const addVariable = () => {
    const currentVars = field.variables || [];
    const newVarName = String.fromCharCode(97 + currentVars.length);
    onUpdate(field.id, { variables: [...currentVars, { name: newVarName, value: '0' }] });
    setVariableIds(ids => [...ids, crypto.randomUUID()]);
  };

  const removeVariable = (index: number) => {
    const currentVars = field.variables || [];
    const newVars = [...currentVars];
    newVars.splice(index, 1);
    onUpdate(field.id, { variables: newVars });
    setVariableIds(ids => ids.filter((_, i) => i !== index));
  };

  const updateVariableName = (index: number, newName: string) => {
    const currentVars = field.variables || [];
    const newVars = [...currentVars];
    newVars[index].name = newName;
    onUpdate(field.id, { variables: newVars });
  };

  const updateVariableValue = (index: number, newValue: string) => {
    const currentVars = field.variables || [];
    const newVars = [...currentVars];
    newVars[index].value = newValue;
    onUpdate(field.id, { variables: newVars });
  };

  // Кнопки в конце строки: видны при наведении, фокусе внутри строки или у
  // выбранной — постоянно видимые у каждой строки были бы визуальным шумом.
  const actions = (
    <div className={`shrink-0 flex items-center gap-0.5 transition-opacity ${
      isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
    }`}>
      <div
        {...listeners}
        className="w-6 h-6 flex items-center justify-center cursor-grab active:cursor-grabbing text-zinc-500 hover:text-white rounded-md hover:bg-white/10 transition-colors"
        aria-label="Перетащить"
      >
        <DragDot />
      </div>
      {field.type === 'text' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate(field.id);
          }}
          className="w-6 h-6 flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/10 rounded-md transition-colors cursor-pointer"
          aria-label="Дублировать"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(field.id);
        }}
        className="w-6 h-6 flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-white/10 rounded-md transition-colors cursor-pointer"
        aria-label="Удалить"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );

  const labelWidth = labelColumnWidth(labelColumnPx);

  return (
    // Раньше исчезновение строки и сдвиг соседей были двумя отдельными
    // React-рендерами, и layout="position" пересчитывал FLIP дважды —
    // «два этапа, две маленькие остановки». AnimatePresence с
    // mode="popLayout" (см. список в TemplateBuilder) убирает саму причину:
    // удаление из fields происходит сразу, одним рендером.
    //
    // Два вложенных motion.div, а не один — намеренно: если явный
    // animate={{opacity, scale}} и layout="position" висят на ОДНОМ и том же
    // motion.div, framer иногда не может согласовать layout-проекцию с
    // ручной scale/opacity-анимацией — exit молча зависал на полпути.
    // Внешний отвечает только за layout="position" (сдвиг соседей),
    // внутренний — только за initial/animate/exit.
    <motion.div
      layout={disableLayoutAnimation ? false : 'position'}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className={isDragging ? 'relative z-10' : ''}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
      >
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        onClick={() => onSelect(field.id)}
        className={`group relative rounded-lg px-2 transition-colors ${
          field.type === 'header' ? 'mt-5 mb-1 py-1.5' : 'py-1'
        } ${
          isSelected ? 'bg-white/[0.05] ring-1 ring-inset ring-amber-400/40' : 'hover:bg-white/[0.02]'
        } ${isDragging ? 'bg-zinc-900 shadow-2xl' : ''}`}
      >
      {field.type === 'header' ? (
        // Заголовок раздела — как на странице заполнения: шеврон, название,
        // линия до конца строки.
        <div className="flex items-center gap-2">
          <ChevronDown size={18} className="shrink-0 text-zinc-500" aria-hidden="true" />
          <input
            type="text"
            value={field.label || ''}
            onChange={e => onUpdate(field.id, { label: e.target.value })}
            // Ширина по тексту (16px полужирный ≈ 14px × 16/14), чтобы линия
            // раздела начиналась сразу после названия.
            style={{ width: Math.ceil(measureTextPx(field.label || 'Заголовок раздела', 600) * 16 / 14) + 8 }}
            className={`min-w-0 max-w-[70%] bg-transparent outline-none text-base font-semibold tracking-wide placeholder:text-zinc-500 transition-colors ${
              isSelected ? 'text-amber-400' : 'text-white'
            }`}
            placeholder="Заголовок раздела"
          />
          <div className="flex-1 h-px bg-white/10" aria-hidden="true" />
          {actions}
        </div>
      ) : (
        <>
        <div className="flex items-start gap-2">
          {/* Название поля — редактируемая плашка; колонка общая в разделе */}
          <div className="shrink-0 flex items-start gap-1 pt-px" style={{ width: labelWidth }}>
            <input
              type="text"
              value={field.label || ''}
              onChange={e => onUpdate(field.id, { label: e.target.value })}
              placeholder="Название поля"
              title={field.label || ''}
              style={{ width: measureLabelPx(field.label || 'Название поля', uppercase) + LABEL_CHIP_PADDING_PX }}
              className={`min-w-0 max-w-full bg-white/10 rounded-md px-2 py-0.5 text-sm font-medium text-white placeholder:text-zinc-500 focus:outline-none focus:bg-white/15 transition-colors ${
                uppercase ? 'uppercase tracking-wide' : ''
              }`}
            />
            <span className="py-0.5 text-sm text-zinc-500 select-none">:</span>
          </div>

          <div className="flex-1 min-w-0">
            {(field.type === 'text' || field.type === 'conclusion') && (
              <BracketTextarea
                value={field.placeholder || ''}
                onChange={value => onUpdate(field.id, { placeholder: value })}
                placeholder={field.type === 'conclusion' ? 'заключение по умолчанию не задано' : 'норма не задана'}
                unit={field.unit}
              />
            )}

            {field.type === 'select' && (
              <div className={`${ROW_TEXT_BASE_CLASS} text-zinc-400`}>
                <span className="text-zinc-500">[</span>
                {(field.options || []).filter(o => o.trim()).length > 0
                  ? (field.options || []).filter(o => o.trim()).map((o, i, arr) => (
                    <span key={i}>
                      <span className={field.defaultValue === o ? 'text-amber-400' : ''}>{o}</span>
                      {i < arr.length - 1 && <span className="text-zinc-600"> / </span>}
                    </span>
                  ))
                  : <span className="text-zinc-600">варианты не заданы</span>}
                <span className="ml-[2px] text-zinc-500">]</span>
              </div>
            )}

            {field.type === 'formula' && (
              <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 ${ROW_TEXT_BASE_CLASS}`}>
                <span className="inline-flex items-baseline">
                  <span className="text-zinc-500">[</span>
                  <input
                    type="text"
                    value={field.formula || ''}
                    onChange={e => onUpdate(field.id, { formula: e.target.value })}
                    placeholder="формула, например a / b"
                    style={{ width: measureTextPx(field.formula || 'формула, например a / b', 400) + 2 }}
                    className="max-w-[60vw] bg-transparent border-0 p-0 text-zinc-300 placeholder:text-zinc-600 focus:outline-none"
                  />
                  <span className="ml-[2px] text-zinc-500">]</span>
                </span>
                <span className="text-zinc-500">→</span>
                <span className="text-zinc-300">{field.formula ? evaluateFormulaPreview(field.formula) : '—'}</span>
                {field.unit && <span className="text-zinc-500">{field.unit}</span>}
              </div>
            )}
          </div>

          {actions}
        </div>

        {/* Редактор «Списка» / «Формулы» — под строкой, пока она выбрана. */}
        <AnimatePresence initial={false}>
          {isSelected && (field.type === 'select' || field.type === 'formula') && (
            <CollapseRow key="editor">
              <div className="pt-1.5 pb-1" style={{ paddingLeft: labelWidth }}>
                <div className="ml-2 rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2">
                  {field.type === 'select' ? (
                    <DndContext
                      sensors={optionSensors}
                      collisionDetection={closestCenter}
                      modifiers={[restrictToVerticalAxis]}
                      onDragEnd={handleOptionDragEnd}
                    >
                      <SortableContext items={optionIds} strategy={verticalListSortingStrategy}>
                        <div>
                          <div className="pb-1 text-[11px] text-zinc-500">Варианты · <CircleDot className="inline w-3 h-3 -mt-px" /> — по умолчанию</div>
                          {/* Отступы между строками — py внутри строки, а не
                              space-y: margin у анимируемой по высоте строки
                              прыгал бы скачком в начале/конце анимации. */}
                          <AnimatePresence initial={false}>
                            {(field.options || []).map((option, index) => (
                              <CollapseRow key={optionIds[index] ?? index}>
                                <div className="py-0.5">
                                  <SortableOption
                                    id={optionIds[index] ?? String(index)}
                                    option={option}
                                    isDefault={field.defaultValue === option}
                                    onToggleDefault={() => onUpdate(field.id, { defaultValue: field.defaultValue === option ? '' : option })}
                                    onChange={value => handleOptionChange(index, value)}
                                    onRemove={() => handleRemoveOption(index)}
                                  />
                                </div>
                              </CollapseRow>
                            ))}
                          </AnimatePresence>
                          <button onClick={handleAddOption} className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-amber-400 transition-colors cursor-pointer">
                            <Plus className="w-3.5 h-3.5" />
                            Вариант
                          </button>
                        </div>
                      </SortableContext>
                    </DndContext>
                  ) : (
                    <div>
                      <div className="pb-1 text-[11px] text-zinc-500">Переменные и пример значений для предпросмотра</div>
                      <AnimatePresence initial={false}>
                        {(field.variables || []).map((v, i) => (
                          <CollapseRow key={variableIds[i] ?? i}>
                            <div className="group/row flex items-center gap-2 py-0.5 text-sm">
                              <input type="text" value={v.name} onChange={e => updateVariableName(i, e.target.value)} className="w-10 text-center bg-white/5 rounded-md border-0 px-0 py-0.5 text-white focus:outline-none focus:bg-white/10 transition-colors" aria-label="Имя переменной" />
                              <span className="text-zinc-500">=</span>
                              <input type="text" value={v.value || ''} onChange={e => updateVariableValue(i, e.target.value)} className="w-14 text-center bg-transparent rounded-md border-0 px-0 py-0.5 text-zinc-300 focus:outline-none focus:bg-white/5 transition-colors" aria-label="Пример значения" />
                              <button onClick={() => removeVariable(i)} className={`text-zinc-500 hover:text-red-400 cursor-pointer ${ROW_ACTION_CLASS}`} aria-label="Удалить переменную">
                                <Minus className="w-4 h-4" />
                              </button>
                            </div>
                          </CollapseRow>
                        ))}
                      </AnimatePresence>
                      <div className="mt-1 flex items-center gap-4">
                        <button onClick={addVariable} className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-amber-400 transition-colors cursor-pointer">
                          <Plus className="w-3.5 h-3.5" />
                          Переменная
                        </button>
                        <label className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                          Единица
                          <input type="text" value={field.unit || ''} onChange={e => onUpdate(field.id, { unit: e.target.value })} placeholder="мм" className="w-14 bg-white/5 rounded-md border-0 px-1.5 py-0.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:bg-white/10 transition-colors" />
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CollapseRow>
          )}
        </AnimatePresence>
        </>
      )}
      </div>
      </motion.div>
    </motion.div>
  );
}

function TemplateBuilder() {
  const router = useRouter();
  const dialog = useDialog();
  const user = pb.authStore.record;
  const { edit } = router.query;
  const [templateTitle, setTemplateTitle] = useState("Новый шаблон");
  const [fields, setFields] = useState<BuilderField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Публичный шаблон виден всем вошедшим пользователям, но менять его может
  // только автор (это же проверяет updateRule коллекции на сервере). Чужой
  // публичный шаблон открывается здесь на просмотр/доработку, а сохранить
  // его можно только как новый — уже свой, личный.
  const [isPublic, setIsPublic] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const isOwner = !ownerId || ownerId === user?.id;

  
  const [showSaveModal, setShowSaveModal] = useState(false);

  // Меняется после загрузки шаблона — пересоздаёт AnimatePresence списка
  // полей: поля приходят асинхронно, уже после первого рендера, и без
  // этого считались бы "добавленными" и проявлялись бы все разом.
  const [fieldsLoadKey, setFieldsLoadKey] = useState(0);

  // Снимок последнего загруженного/сохранённого состояния — для метки
  // "Не сохранено" рядом с кнопкой "Сохранить".
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify({ title: 'Новый шаблон', fields: [], isPublic: false, notes: '' }));

  // Заметки шаблона (строки "[текст](url)"), см. NotesPanel. В БД по-прежнему
  // хранятся полем type: 'notes' в fields — страница заполнения собирает
  // ссылки из таких полей и сама их не рендерит, поэтому ей и старым
  // шаблонам ничего менять не нужно. Здесь это поле из списка полей
  // вынимается при загрузке (splitNotes) и добавляется обратно при
  // сохранении (withNotesField). id сохраняется, чтобы не пересоздавать его.
  const [templateNotes, setTemplateNotes] = useState('');
  const notesFieldIdRef = useRef<string | null>(null);

  const isDirty = useMemo(
    () => JSON.stringify({ title: templateTitle, fields, isPublic, notes: templateNotes }) !== savedSnapshot,
    [templateTitle, fields, isPublic, templateNotes, savedSnapshot]
  );

  const updateQuickButtons = (
    fieldId: string,
    updater: (draft: QuickButtonGroup[]) => QuickButtonGroup[]
  ) => {
    const fieldIndex = fields.findIndex(f => f.id === fieldId);
    if (fieldIndex === -1) return;

    const current = fields[fieldIndex].quickButtons || [];
    const cloned = structuredClone(current) as QuickButtonGroup[];
    const updated = updater(cloned);

    updateField(fieldId, { quickButtons: updated });
  };
  
  const addQuickButtonGroup = () => {
    if (!selectedFieldId) return;

    updateQuickButtons(selectedFieldId, (draft) => {
      if (draft.length >= MAX_QUICK_BUTTON_GROUPS) return draft;

      // Вставляем сразу после последней раскрытой группы (никто не
      // раскрыт — в конец), остальные сворачиваем.
      let insertAfterIndex = -1;
      for (let i = 0; i < draft.length; i++) {
        if (draft[i].isExpanded) insertAfterIndex = i;
      }

      const newGroup: QuickButtonGroup = {
        id: crypto.randomUUID(),
        label: '',
        isExpanded: true,
        phrases: [''],
      };

      const newIndex = insertAfterIndex === -1 ? draft.length : insertAfterIndex + 1;
      draft.splice(newIndex, 0, newGroup);
      draft.forEach((g, idx) => { g.isExpanded = idx === newIndex; });

      return draft;
    });
  };

  // Пока идёт перетаскивание группы (и в рендере, где dnd-kit фиксирует
  // новый порядок), layout-анимация framer у карточек групп выключена:
  // сдвиг на drop уже анимирует сам dnd-kit, а framer поверх начал бы
  // второй сдвиг — "отскок" брошенной карточки назад и снова вперёд.
  const [isDraggingGroup, setIsDraggingGroup] = useState(false);
  const handleGroupDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (selectedFieldId && over && active.id !== over.id) {
      updateQuickButtons(selectedFieldId, (draft) => {
        const from = draft.findIndex(g => g.id === active.id);
        const to = draft.findIndex(g => g.id === over.id);
        return from === -1 || to === -1 ? draft : arrayMove(draft, from, to);
      });
    }
    requestAnimationFrame(() => setIsDraggingGroup(false));
  };

  const [showAddLinkModal, setShowAddLinkModal] = useState(false);
  const [tempLinkText, setTempLinkText] = useState('');
  const [tempLinkUrl, setTempLinkUrl] = useState('');

  // Заметки шаблона — обратно одним полем type: 'notes' в конце списка
  // полей (порядок для страницы заполнения значения не имеет). Без
  // заметок поле не добавляется вовсе.
  const withNotesField = (list: BuilderField[]): BuilderField[] => {
    const notes = templateNotes.split('\n').filter(Boolean).join('\n');
    if (!notes) return list;
    if (!notesFieldIdRef.current) notesFieldIdRef.current = crypto.randomUUID();
    return [...list, { id: notesFieldIdRef.current, type: 'notes', label: 'Заметки', notes }];
  };

  const handleAddLink = () => {
    if (!tempLinkUrl) {
      setShowAddLinkModal(false);
      return;
    }
    const link = `[${tempLinkText || tempLinkUrl}](${tempLinkUrl})`;
    setTemplateNotes(current => (current ? current + '\n' + link : link));
    setTempLinkText('');
    setTempLinkUrl('');
    setShowAddLinkModal(false);
  };

  const openAddLinkModal = () => {
    setTempLinkText('');
    setTempLinkUrl('');
    setShowAddLinkModal(true);
  };

  // Изображение загружается в notes_images, а в заметки попадает ссылкой
  // на файл — через то же окно "Добавить ссылку" (можно поменять подпись).
  const handleAddImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('file', file);
      formData.append('user', pb.authStore.record?.id || '');

      try {
        const record = await pb.collection('notes_images').create(formData);
        setTempLinkText('Изображение');
        setTempLinkUrl(pb.files.getURL(record, record.file));
        setShowAddLinkModal(true);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        dialog.alert('Ошибка загрузки изображения: ' + errorMessage);
      }
    };
    input.click();
  };

  // Пока идёт перетаскивание поля (и в рендере drop) layout-анимация
  // framer у карточек выключена — см. комментарий в SortableField.
  const [isDraggingField, setIsDraggingField] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
  if (edit) {
    setEditingId(edit as string);

    const loadTemplate = async () => {
      try {
        const record = await pb.collection('templates').getOne(edit as string, { $autoCancel: false });

setTemplateTitle(record.title || "Новый шаблон");

// Поля «Число» / «Чекбокс» / «Шкала» → текстовые (lib/migrateFieldTypes.ts);
// в базе шаблон обновится при следующем сохранении.
const migratedFields = (record.fields || []).map((f: BuilderField) => migrateLegacyField({
  ...f,
  quickButtons: migrateQuickButtons(f.quickButtons),
}));

// Поля "Заметки" (их могло быть несколько — раньше это был обычный
// инструмент) вынимаем из списка полей и сливаем в заметки шаблона.
const notesFields = migratedFields.filter((f: BuilderField) => f.type === 'notes');
const regularFields = migratedFields.filter((f: BuilderField) => f.type !== 'notes');
const loadedNotes = notesFields
  .flatMap((f: BuilderField) => (f.notes || '').split('\n').filter(Boolean))
  .join('\n');
notesFieldIdRef.current = notesFields[0]?.id ?? null;

setFields(regularFields);
setTemplateNotes(loadedNotes);
setFieldsLoadKey(k => k + 1);
// Флаг публичности — только у своего шаблона: копия чужого публичного
// сохраняется личной.
const loadedIsPublic = record.user === user?.id ? !!record.isPublic : false;
setOwnerId(record.user || null);
setIsPublic(loadedIsPublic);
setSavedSnapshot(JSON.stringify({ title: record.title || "Новый шаблон", fields: regularFields, isPublic: loadedIsPublic, notes: loadedNotes }));
      } catch (err) {
        console.error("Ошибка загрузки шаблона в Builder:", err);
      }
    };

    loadTemplate();
  }
}, [edit, user?.id]);

  const addField = (type: FieldType) => {
    let newField: BuilderField = {
      // crypto.randomUUID(), не Date.now() — при быстрых повторных кликах
      // (например, двойной клик по "Добавить") Date.now() легко возвращает
      // одно и то же значение для двух полей подряд (разрешение — 1мс), из-за
      // чего два разных поля получали одинаковый id → React путал их как
      // один и тот же элемент по ключу, что выглядело как "дублирование
      // карточки со сдвигом" и ломало анимацию именно того поля.
      id: crypto.randomUUID(),
      type,
      // У "Заключения" название почти всегда одно и то же — сразу
      // подставляем его, остальные поля начинают с пустого названия.
      label: type === 'conclusion' ? 'Заключение' : '',
      defaultValue: type === 'checkbox' ? false : type === 'rating' ? 0 : '',
      placeholder: '',
      required: false,
      options: type === 'select' ? [''] : undefined,
      unit: type === 'number' ? 'см' : type === 'formula' ? '' : undefined,
      max: type === 'rating' ? 5 : undefined,
      checkedPhrase: type === 'checkbox' ? 'Да' : undefined,
      uncheckedPhrase: type === 'checkbox' ? 'Нет' : undefined,
      explanations: type === 'rating' ? Array(5).fill('') : undefined,
      showExplanations: false,
      formula: type === 'formula' ? 'a + b' : undefined,
      variables: type === 'formula' ? [{ name: 'a', value: '0' }, { name: 'b', value: '0' }] : undefined,
      
    };

    if (type === 'text' || type === 'conclusion') {
      newField = {
        ...newField,
        quickButtons: [],
        isQuickText: true,
      } as BuilderField;
    }

    if (selectedFieldId) {
      const index = fields.findIndex(f => f.id === selectedFieldId);
      if (index !== -1) {
        setFields([
          ...fields.slice(0, index + 1),
          newField,
          ...fields.slice(index + 1)
        ]);
        setSelectedFieldId(newField.id);
        return;
      }
    }

    setFields([...fields, newField]);
    setSelectedFieldId(newField.id);
  };

  const removeField = (id: string) => {
    // Убирается из fields сразу, одним рендером — AnimatePresence
    // (mode="popLayout" у списка ниже) сам доигрывает exit-анимацию
    // удаляемой карточки и тем же рендером сдвигает соседей через
    // layout="position", без второго, рассинхронизированного измерения
    // позиций (см. комментарий в SortableField).
    setFields(prev => prev.filter(f => f.id !== id));
    if (selectedFieldId === id) setSelectedFieldId(null);
  };

  const duplicateField = (id: string) => {
    const index = fields.findIndex(f => f.id === id);
    if (index === -1) return;

    const original = fields[index];
    if (original.type !== 'text') return;

    const newField: BuilderField = {
      ...JSON.parse(JSON.stringify(original)),
      // См. комментарий в addField — тот же риск коллизии id при частых кликах.
      id: 'text-' + crypto.randomUUID(),
    };

    const newFields = [
      ...fields.slice(0, index + 1),
      newField,
      ...fields.slice(index + 1)
    ];

    setFields(newFields);
    setSelectedFieldId(newField.id);   // сразу выделяем дублированное поле
  };

  const updateField = (id: string, updates: Partial<BuilderField>) => {
    setFields(fields.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setFields(items => arrayMove(items, items.findIndex(i => i.id === active.id), items.findIndex(i => i.id === over.id)));
    }
    requestAnimationFrame(() => setIsDraggingField(false));
  };

  const handleDragStart = () => {
    setIsDraggingField(true);
  };

    const performSave = async (asNew: boolean) => {
      const title = templateTitle.trim().replace(/\s+/g, ' ');
      if (!title) {
        setShowSaveModal(false);
        await dialog.alert('Укажите название шаблона.');
        return;
      }

      setIsSaving(true);

      // Чужой публичный шаблон перезаписать нельзя (сервер это тоже
      // запрещает) — только сохранить копию, и она всегда личная.
      const saveAsNew = asNew || !isOwner;
      const willBePublic = isOwner ? isPublic : false;

      // Название уникально среди СВОИХ шаблонов, а у публикуемого — ещё и
      // среди всех публичных (иначе в разделе "Публичные" появлялись бы
      // неотличимые дубликаты). Чужие публичные шаблоны не мешают сохранить
      // личный с тем же названием: иначе чужая публикация "занимала" бы
      // название и у вас. Сравнение без учёта регистра и лишних пробелов —
      // на клиенте: оператор ~ в фильтре PocketBase (SQLite LIKE) регистр
      // кириллицы не игнорирует. При обновлении самого себя совпадение не
      // считается.
      try {
        const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
        const existing = await pb.collection('templates').getFullList({
          filter: pb.filter('user = {:uid} || isPublic = true', { uid: user?.id }),
          fields: 'id,title,user,isPublic',
        });
        const duplicate = existing.find(t =>
          normalize(t.title || '') === normalize(title) &&
          (saveAsNew || t.id !== editingId) &&
          (t.user === user?.id || (willBePublic && t.isPublic))
        );
        if (duplicate) {
          setIsSaving(false);
          setShowSaveModal(false);
          await dialog.alert(
            duplicate.user === user?.id
              ? `Шаблон «${duplicate.title}» уже существует. Измените название, чтобы сохранить.`
              : `Публичный шаблон «${duplicate.title}» уже есть у другого автора. Измените название или сохраните шаблон личным.`,
            { title: 'Название занято' }
          );
          return;
        }
      } catch (err: unknown) {
        console.error("Ошибка проверки названия шаблона:", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        setIsSaving(false);
        setShowSaveModal(false);
        await dialog.alert("Не удалось проверить название шаблона: " + errorMessage);
        return;
      }

      const payload = {
        title,
        fields: JSON.parse(JSON.stringify(withNotesField(fields))),
        user: user?.id,
        // Раньше здесь было жёстко isPublic: false — любое сохранение
        // молча снимало шаблон с публикации.
        isPublic: willBePublic
      };

      try {
        if (editingId && !saveAsNew) {
          await pb.collection('templates').update(editingId, payload);
        } else {
          const newRecord = await pb.collection('templates').create(payload);
          setEditingId(newRecord.id);
          setOwnerId(user?.id ?? null);
        }
        setTemplateTitle(title);
        setIsPublic(willBePublic);
        setSavedSnapshot(JSON.stringify({ title, fields, isPublic: willBePublic, notes: templateNotes }));
        router.push('/');
      } catch (err: unknown) {
     console.error("Ошибка сохранения шаблона:", err);
     const errorMessage = err instanceof Error ? err.message : String(err);
     await dialog.alert("Ошибка при сохранении шаблона: " + errorMessage);
   } finally {
        setIsSaving(false);
        setShowSaveModal(false);
      }
    };

  const handleSaveClick = () => {
    setShowSaveModal(true);
  };

  const goToFiller = () => {
    if (editingId) router.push(`/filler?id=${editingId}`);
    else dialog.alert('Сначала сохраните шаблон');
  };

  const goToList = () => router.push('/');

  // Названия ЗАГЛАВНЫМИ — как настроено на странице заполнения (там
  // переключатель), чтобы строки выглядели так же.
  const [labelsUppercase, setLabelsUppercase] = useState(false);
  useEffect(() => {
    try {
      setLabelsUppercase(localStorage.getItem(LABELS_UPPERCASE_KEY) === '1');
    } catch {}
  }, []);
  // Колонка названий — общая в разделе (lib/fieldLabels.ts).
  const labelWidths = sectionLabelWidths(fields, labelsUppercase);

  return (
    // Раскладка — как у страницы заполнения (lib/pageLayout.ts): липкая шапка
    // со строкой действий, док инструментов слева, строки полей по центру,
    // справа — быстрые кнопки выбранного поля и заметки шаблона.
    // data-no-focus-ring — без колец фокуса на всей странице (styles/globals.css).
    <div data-no-focus-ring className="min-h-screen bg-zinc-950 text-white">
      <div className="sticky top-0 z-50 bg-zinc-950 border-b border-white/10">
        <DynamicUserHeader />
        <div className={PAGE_COLUMNS_CLASS}>
          <div className={DOCK_COLUMN_CLASS} aria-hidden="true" />
          <div className="flex-1 min-w-0 flex items-center gap-2 py-2">
            <button
              onClick={goToList}
              className="h-8 -ml-2.5 px-2.5 shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 rounded-lg text-sm text-zinc-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              Шаблоны
            </button>
            <div className="ml-auto flex items-center gap-2">
              {isDirty && (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-zinc-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  Не сохранено
                </span>
              )}
              {/* Публичность — свойство шаблона; применяется при сохранении,
                  как и остальные правки. Только у своего шаблона. */}
              {isOwner && (
                <button
                  onClick={() => setIsPublic(v => !v)}
                  aria-pressed={isPublic}
                  className={`h-8 px-3 shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                    isPublic
                      ? 'bg-amber-400/10 border-amber-400 text-amber-400'
                      : 'bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10 hover:text-white'
                  }`}
                  title={isPublic ? 'Виден всем пользователям. Нажмите, чтобы сделать личным' : 'Виден только вам. Нажмите, чтобы сделать публичным'}
                >
                  <Globe className="w-3.5 h-3.5" strokeWidth={1.75} />
                  {isPublic ? 'Публичный' : 'Личный'}
                </button>
              )}
              <button
                onClick={goToFiller}
                className="h-8 px-3 shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 rounded-lg text-sm text-zinc-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              >
                Заполнить
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={handleSaveClick}
                disabled={isSaving}
                className="h-8 px-3.5 shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 rounded-lg text-sm font-medium bg-amber-400 text-zinc-950 hover:bg-amber-300 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Save className="w-4 h-4" />
                {isOwner ? 'Сохранить' : 'Сохранить копию'}
              </button>
            </div>
          </div>
          <div className={RIGHT_COLUMN_CLASS} aria-hidden="true" />
        </div>
      </div>

      <div className={`${PAGE_COLUMNS_CLASS} pt-6 pb-40`}>
        {/* Док слева — добавление полей: новое поле встаёт сразу после
            выбранного, а если ничего не выбрано — в конец шаблона. */}
        <aside className={DOCK_COLUMN_CLASS}>
          <div className={`sticky ${SIDE_PANEL_TOP_CLASS} ${DOCK_PANEL_CLASS}`}>
            {availableFields.map(item => (
              <button
                key={item.type}
                onClick={() => addField(item.type)}
                className={`${DOCK_BUTTON_CLASS} text-zinc-400 hover:text-amber-400 hover:bg-white/10`}
                data-tip={`${item.label} — добавить`}
                aria-label={`Добавить: ${item.label}`}
              >
                {item.icon}
              </button>
            ))}
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          {!isOwner && (
            <div className="mb-5 px-3 py-2 flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 text-xs text-zinc-400">
              <Globe className="w-4 h-4 shrink-0 text-zinc-500" strokeWidth={1.75} />
              Публичный шаблон другого автора — изменения можно сохранить только как новый шаблон в вашем списке.
            </div>
          )}
          <input
            type="text"
            value={templateTitle}
            onChange={(e) => setTemplateTitle(e.target.value)}
            className="mb-6 w-full px-2 text-2xl font-bold bg-transparent outline-none tracking-tight placeholder:text-zinc-600"
            placeholder="Название шаблона"
          />

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setIsDraggingField(false)}
          >
            <SortableContext items={fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col">
                {fields.length === 0 && (
                  <EmptyState
                    icon={<LayoutList className="w-5 h-5" />}
                    title="Шаблон пока пуст"
                    text="Добавьте первое поле из панели слева — например, «Заголовок» раздела или «Текст»."
                  />
                )}
                {/* mode="popLayout": уходящая строка сразу вынимается из
                    потока (position: absolute) и доигрывает exit сама по
                    себе вместо того, чтобы держать соседей на месте до своего
                    исчезновения. initial={false} — при открытии шаблона
                    строки не «проявляются» все разом. */}
                <AnimatePresence key={fieldsLoadKey} mode="popLayout" initial={false}>
                  {fields.map(field => (
                    <SortableField
                      key={field.id}
                      field={field}
                      isSelected={selectedFieldId === field.id}
                      labelColumnPx={labelWidths.widths.get(labelWidths.sectionOf.get(field.id) ?? null) || 0}
                      uppercase={labelsUppercase}
                      disableLayoutAnimation={isDraggingField}
                      onSelect={setSelectedFieldId}
                      onRemove={removeField}
                      onUpdate={updateField}
                      onDuplicate={duplicateField}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </SortableContext>
          </DndContext>
        </main>

        {/* Справа: быстрые кнопки выбранного поля и заметки шаблона. Своя
            прокрутка — панель липкая и не выше экрана. */}
        <aside className={RIGHT_COLUMN_CLASS}>
          <div className={`sticky ${SIDE_PANEL_TOP_CLASS} max-h-[calc(100vh-8.5rem)] flex flex-col rounded-2xl bg-zinc-900/75 border border-white/10 shadow-2xl overflow-hidden`}>
        {selectedFieldId && ['text', 'conclusion'].includes(fields.find(f => f.id === selectedFieldId)?.type || '') ? (
  <div className="flex-1 min-h-0 overflow-auto p-4 [scrollbar-gutter:stable]">
    {(() => {
      const selectedField = fields.find(f => f.id === selectedFieldId);
      const groups = selectedField?.quickButtons || [];
      const limitReached = groups.length >= MAX_QUICK_BUTTON_GROUPS;
      return (
        <>
    <div className="flex items-center gap-3 mb-3">
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold tracking-tight">Быстрые кнопки</h3>
        <p className="text-xs text-zinc-500 truncate">{selectedField?.label || 'Без названия'} · в заполнении — Ctrl+номер</p>
      </div>
      <button
        onClick={addQuickButtonGroup}
        disabled={limitReached}
        className="shrink-0 h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm text-zinc-300 bg-white/5 hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:hover:bg-white/5 disabled:hover:text-zinc-300 disabled:cursor-not-allowed cursor-pointer transition-colors"
      >
        <Plus className="w-4 h-4" />
        Группа
        <span className="text-zinc-500 tabular-nums">{groups.length}/{MAX_QUICK_BUTTON_GROUPS}</span>
      </button>
    </div>

    {/* Группы — карточками одна под другой. Порядок меняется
        перетаскиванием за точку слева от номера; номер — позиция группы,
        он же горячая клавиша Ctrl+1..9 на странице заполнения. */}
    {groups.length === 0 && (
      <EmptyState
        icon={<Plus className="w-5 h-5" />}
        title="Групп пока нет"
        text="Добавьте группу кнопкой «Группа» — в заполнении она откроется по Ctrl+номер."
      />
    )}
    <DndContext
      sensors={sensors}
      collisionDetection={groupCollisionDetection}
      onDragStart={() => setIsDraggingGroup(true)}
      onDragEnd={handleGroupDragEnd}
      onDragCancel={() => setIsDraggingGroup(false)}
    >
      <SortableContext items={groups.map(g => g.id)} strategy={rectSortingStrategy}>
        {/* relative — для AnimatePresence popLayout: уходящая карточка
            вынимается из сетки (position: absolute) относительно неё. */}
        <div className="relative grid grid-cols-1 gap-3 items-start">
          {/* initial={false} — анимация появления только у добавленных
              групп, а не у всех разом при выборе поля. */}
          <AnimatePresence mode="popLayout" initial={false}>
            {groups.map((group, gIndex) => (
              <SortableQuickButtonGroup
                key={group.id}
                group={group}
                index={gIndex}
                disableLayoutAnimation={isDraggingGroup}
                onChange={(mutate) => {
                  updateQuickButtons(selectedFieldId!, (draft) => {
                    mutate(draft[gIndex]);
                    return draft;
                  });
                }}
                onRemove={() => {
                  updateQuickButtons(selectedFieldId!, (draft) => {
                    draft.splice(gIndex, 1);
                    return draft;
                  });
                }}
              />
            ))}
          </AnimatePresence>
        </div>
      </SortableContext>
    </DndContext>
        </>
      );
    })()}
  </div>
) : (
  <div className="flex-1 min-h-0 flex items-center justify-center px-4">
    <EmptyState
      icon={<MousePointerClick className="w-5 h-5" />}
      title="Быстрые кнопки"
      text="Выберите поле «Текст» или «Заключение» — здесь появятся его группы готовых фраз."
    />
  </div>
)}
        {/* Заметки шаблона — всегда внизу панели, независимо от выбранного
            поля; быстрые кнопки над ними прокручиваются отдельно. */}
        <NotesPanel
          notes={templateNotes}
          onChange={setTemplateNotes}
          onAddLink={openAddLinkModal}
          onAddImage={handleAddImage}
        />
          </div>
        </aside>
      </div>

      <AnimatedModal
        open={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        size="md"
        onKeyDown={(e) => {
          if (e.key === 'Escape') setShowSaveModal(false);
        }}
      >
        <ModalHeader title="Сохранение шаблона" onClose={() => setShowSaveModal(false)} />
        <ModalBody>
          <p className="text-sm text-zinc-400 leading-relaxed">
            {!isOwner
              ? 'Это публичный шаблон другого автора. Изменения сохранятся новым личным шаблоном в вашем списке — оригинал не изменится.'
              : editingId
                ? 'Обновить этот шаблон или сохранить изменения отдельной копией?'
                : 'Шаблон будет сохранён в вашем списке.'}
            {isOwner && isPublic && ' Шаблон публичный — его увидят все пользователи, но изменять сможете только вы.'}
          </p>
        </ModalBody>
        <ModalFooter>
          <ModalButton onClick={() => setShowSaveModal(false)}>Отмена</ModalButton>
          {isOwner && editingId && (
            <ModalButton onClick={() => performSave(true)} disabled={isSaving}>
              Сохранить как новый
            </ModalButton>
          )}
          <ModalButton variant="primary" autoFocus onClick={() => performSave(!isOwner)} disabled={isSaving}>
            {isOwner ? 'Сохранить' : 'Сохранить как новый'}
          </ModalButton>
        </ModalFooter>
      </AnimatedModal>


      <AnimatedModal
        open={showAddLinkModal}
        onClose={() => setShowAddLinkModal(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleAddLink();
          if (e.key === 'Escape') setShowAddLinkModal(false);
        }}
      >
        <ModalHeader title="Добавить ссылку" onClose={() => setShowAddLinkModal(false)} />
        <ModalBody className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Название</label>
            <input
              type="text"
              autoFocus
              value={tempLinkText}
              onChange={e => setTempLinkText(e.target.value)}
              className={MODAL_INPUT_CLASS}
              placeholder="Например, «Классификация Bosniak»"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">URL</label>
            <input
              type="text"
              value={tempLinkUrl}
              onChange={e => setTempLinkUrl(e.target.value)}
              className={MODAL_INPUT_CLASS}
              placeholder="https://"
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <ModalButton onClick={() => setShowAddLinkModal(false)}>Отмена</ModalButton>
          <ModalButton variant="primary" onClick={() => handleAddLink()} disabled={!tempLinkUrl.trim()}>
            Добавить
          </ModalButton>
        </ModalFooter>
      </AnimatedModal>

    </div>
  );
}
export default withAuth(TemplateBuilder);