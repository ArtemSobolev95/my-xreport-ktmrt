'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import pb from '../../lib/pocketbase';
pb.autoCancellation(false);
import {
  Trash2, ChevronUp, ChevronDown, ChevronRight, Paperclip, ClipboardCheck,
  Heading, Type, Hash, SquareCheck, List, ChartNoAxesColumnIncreasing, Calculator,
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
import { evaluateFormula } from '../../lib/evaluateFormula';
import { useDialog } from '../DialogProvider';
import CollapseRow from '../CollapseRow';
import AnimatedModal, { ModalBody, ModalButton, ModalFooter, ModalHeader, MODAL_INPUT_CLASS } from '../AnimatedModal';



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
// .flex.flex-1.overflow-hidden — контейнер, оборачивающий обе панели.
// Ширина боковой панели кнопок у карточек полей (разделитель + колонка
// кнопок) — та же, что FIELD_ACTIONS_RAIL_WIDTH в pages/filler.tsx. Название
// шаблона и заголовки разделов получают "фантомный" отступ такой ширины,
// чтобы центрироваться по той же оси, что и названия полей.
const FIELD_ACTIONS_RAIL_WIDTH = 46;

// Ширина карточек полей — как у колонки полей на странице заполнения
// (col-span-5 из 12 в max-w-7xl с lg:px-12 и gap-8 = 475px).
const FIELDS_COLUMN_WIDTH = 475;

const DynamicUserHeader = dynamic(() => import('../../components/UserHeader'), { ssr: false });

// Иконки — один набор (lucide), один размер и толщина линий. Раньше здесь
// были смешаны heroicons, lucide и самодельная залитая SVG у "Шкала",
// заметно тяжелее остальных.
const TOOL_ICON_CLASS = 'w-[18px] h-[18px]';
const availableFields = [
  { type: 'header' as FieldType, label: 'Заголовок', icon: <Heading className={TOOL_ICON_CLASS} strokeWidth={1.75} /> },
  { type: 'text' as FieldType, label: 'Текст', icon: <Type className={TOOL_ICON_CLASS} strokeWidth={1.75} /> },
  { type: 'number' as FieldType, label: 'Число', icon: <Hash className={TOOL_ICON_CLASS} strokeWidth={1.75} /> },
  { type: 'checkbox' as FieldType, label: 'Чекбокс', icon: <SquareCheck className={TOOL_ICON_CLASS} strokeWidth={1.75} /> },
  { type: 'select' as FieldType, label: 'Список', icon: <List className={TOOL_ICON_CLASS} strokeWidth={1.75} /> },
  { type: 'rating' as FieldType, label: 'Шкала', icon: <ChartNoAxesColumnIncreasing className={TOOL_ICON_CLASS} strokeWidth={1.75} /> },
  { type: 'notes' as FieldType, label: 'Заметки', icon: <Paperclip className={TOOL_ICON_CLASS} strokeWidth={1.75} /> },
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

      {/* Ширина по содержимому, а не w-full — иначе кнопка удаления
          утыкается в правый край карточки, далеко от текста. */}
      <input
        type="text"
        value={option}
        onChange={e => onChange(e.target.value)}
        style={{ width: `${Math.max((option || 'Введите значение').length + 2, 12)}ch` }}
        className="max-w-full bg-transparent border-0 rounded-md px-1 py-0.5 text-white placeholder:text-zinc-400 focus:outline-none focus:bg-white/5 transition-colors text-sm"
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

function SortableField({
  field,
  isSelected,
  disableLayoutAnimation,
  onSelect,
  onRemove,
  onUpdate,
  onDuplicate,
  // Пропсы ниже используются ТОЛЬКО в блоке notes
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  showAddLinkModal,
  setShowAddLinkModal,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tempLinkText,
  setTempLinkText,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tempLinkUrl,
  setTempLinkUrl,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handleAddLink
}: {
  field: BuilderField;
  isSelected: boolean;
  disableLayoutAnimation: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<BuilderField>) => void;
  onDuplicate: (id: string) => void; 
  showAddLinkModal: boolean;
  setShowAddLinkModal: (open: boolean) => void;
  tempLinkText: string;
  setTempLinkText: (text: string) => void;
  tempLinkUrl: string;
  setTempLinkUrl: (url: string) => void;
  handleAddLink: (fieldId: string) => void;
}) {
  // Перетаскивается сама карточка (без DragOverlay-копии) — как группы
  // быстрых кнопок. animateLayoutChanges по умолчанию у dnd-kit срабатывает
  // только сразу после drop (доводит брошенную карточку до нового места);
  // layout-анимацию framer на это время выключает disableLayoutAnimation
  // (см. isDraggingField в TemplateBuilder), чтобы сдвиг не шёл дважды.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
    transition: SORTABLE_TRANSITION,
  });
  // Инлайн, не className: opacity/transition у dnd-kit приходят как
  // инлайн-стиль (transform — для drag), а инлайн-стиль всегда побеждает
  // className по каскаду. Translate, не Transform: у карточек разная
  // высота, и scaleY из CSS.Transform растягивал бы перетаскиваемую
  // карточку под размер той, на место которой она встаёт.
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const dialog = useDialog();

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

  const [checked, setChecked] = useState(false);
  const [selectedRating, setSelectedRating] = useState<number | null>(null);

  
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
      return isNaN(result) ? 'Ошибка' : Number(result).toFixed(2);
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

  

  const handleAddImage = async () => {
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

     
      const publicUrl = pb.files.getURL(record, record.file);

      setTempLinkText('Изображение');
      setTempLinkUrl(publicUrl);
      setShowAddLinkModal(true);
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        dialog.alert('Ошибка загрузки изображения: ' + errorMessage);
    }
  };
  input.click();
};

  const deleteLink = (index: number) => {
    const lines = (field.notes || '').split('\n').filter(Boolean);
    lines.splice(index, 1);
    onUpdate(field.id, { notes: lines.join('\n') });
  };

  const moveLinkUp = (index: number) => {
    if (index <= 0) return;
    const lines = (field.notes || '').split('\n').filter(Boolean);
    [lines[index], lines[index - 1]] = [lines[index - 1], lines[index]];
    onUpdate(field.id, { notes: lines.join('\n') });
  };

  const moveLinkDown = (index: number) => {
    const lines = (field.notes || '').split('\n').filter(Boolean);
    if (index >= lines.length - 1) return;
    [lines[index], lines[index + 1]] = [lines[index + 1], lines[index]];
    onUpdate(field.id, { notes: lines.join('\n') });
  };

  return (
    // Раньше исчезновение карточки и сдвиг соседей были двумя отдельными
    // React-рендерами (сначала CSS collapse через grid-template-rows,
    // потом — через 220мс в setTimeout — реальный filter() из fields), и
    // layout="position" пересчитывал FLIP дважды, на каждом рендере отдельно
    // — читалось как "два этапа, две маленькие остановки", сколько ни
    // подгоняй тайминги CSS. AnimatePresence с mode="popLayout" (см. список
    // ниже) убирает саму причину: удаление карточки из fields происходит
    // сразу, одним рендером.
    //
    // Два вложенных motion.div, а не один — намеренно: если явный
    // animate={{opacity, scale}} и layout="position" висят на ОДНОМ и том же
    // motion.div, framer иногда не может согласовать layout-проекцию
    // (transform под FLIP) с ручной scale/opacity-анимацией — на практике
    // это приводило к тому, что exit молча зависал на полпути (opacity уже
    // 1, scale так и остаётся 0.95 — ни enter, ни exit не доигрывают до
    // конца, карточка-призрак не убирается из DOM). Внешний motion.div
    // отвечает только за layout="position" (сдвиг соседей, transform),
    // внутренний — только за initial/animate/exit (fade + scale-95), у
    // каждого своя, не пересекающаяся часть transform.
    <motion.div
      layout={disableLayoutAnimation ? false : 'position'}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className={isDragging ? 'relative z-10' : ''}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
      >
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        onClick={() => onSelect(field.id)}
        className={`card transition-[border-color,box-shadow,background-color] duration-200 ease-out relative group mb-4 ${
          field.type === 'header'
            ? `border-0 shadow-none rounded-xl ${isSelected ? 'bg-white/10 ring-2 ring-amber-400/40 ring-inset' : 'bg-transparent'}`
            : `bg-zinc-900/75 border border-white/10 shadow-2xl rounded-3xl ${
                isSelected ? 'border-amber-400 shadow-[0_0_0_4px_rgba(245,158,11,0.3)]' : 'hover:border-white/20'
              }`
        } ${isDragging ? 'shadow-2xl' : ''}`}
      >
      {/* Раскладка повторяет карточки страницы заполнения (pages/filler.tsx):
          заголовок раздела — прозрачная строка с крупным текстом по центру,
          поля — колонка контента + боковая панель кнопок за вертикальным
          разделителем. У заголовка вместо разделителя — панель той же
          ширины (FIELD_ACTIONS_RAIL_WIDTH), видимая по наведению, чтобы
          текст центрировался по той же оси, что и названия полей. */}
      {field.type === 'header' ? (
        <div className="py-2 px-2 flex items-center">
          <input
            type="text"
            value={field.label || ''}
            onChange={e => onUpdate(field.id, { label: e.target.value })}
            className={`flex-1 min-w-0 bg-transparent outline-none text-2xl font-bold tracking-tight text-center placeholder:text-zinc-500 transition-colors ${
              isSelected ? 'text-amber-400' : 'text-white'
            }`}
            placeholder="Заголовок"
          />
          <div
            style={{ width: FIELD_ACTIONS_RAIL_WIDTH }}
            className={`shrink-0 flex items-center justify-end gap-1 transition-opacity ${
              isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
            }`}
          >
            <div {...listeners} className="w-6 h-6 flex items-center justify-center cursor-grab active:cursor-grabbing text-zinc-500 hover:text-white transition-colors">
              <DragDot />
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(field.id);
              }}
              className="text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
              aria-label="Удалить"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      ) : (
      <div className="flex min-w-0">
      <div className="flex-1 min-w-0 flex flex-col">
      <div className="card-body justify-center px-4 pt-3 pb-3">
        {/* Название поля — чипом по центру, как на странице заполнения.
            У "Заметки" своего label нет — статичный чип с иконкой. */}
        {(field.type === 'text' || field.type === 'number' || field.type === 'checkbox' || field.type === 'select' || field.type === 'rating' || field.type === 'formula' || field.type === 'conclusion') && (
          <div className="flex justify-center mb-1">
            <input
              type="text"
              value={field.label || ''}
              onChange={e => onUpdate(field.id, { label: e.target.value })}
              placeholder="Название поля"
              style={{ width: `${Math.max((field.label || 'Название поля').length + 2, 10)}ch` }}
              className="max-w-full text-center bg-white/10 rounded-lg px-2 py-0.5 text-sm font-medium text-white placeholder:text-zinc-500 focus:outline-none transition-colors"
            />
          </div>
        )}
        {field.type === 'notes' && (
          <div className="flex justify-center mb-1">
            <div className="flex items-center gap-1.5 bg-white/10 rounded-lg px-2 py-0.5 text-sm font-medium text-white">
              <Paperclip className="w-3.5 h-3.5" />
              Заметки
            </div>
          </div>
        )}

      <div>
        {field.type === 'text' || field.type === 'conclusion' ? (
          <div>
            {/* Placeholder — редактируется прямо внутри карточки. Без mb-4
                (лишний хвостовой отступ снизу карточки, которого нет у
                остальных типов — только у своего инпута свой py-0.5). */}
            <input
              type="text"
              value={field.placeholder || ''}
              onChange={e => onUpdate(field.id, { placeholder: e.target.value })}
              className="w-full bg-transparent rounded-md border-0 px-1 py-0.5 leading-tight text-white placeholder:text-zinc-400 focus:outline-none focus:bg-white/5 transition-colors text-sm"
              placeholder="Введите значение"
            />
          </div>
        ) : field.type === 'number' ? (
  <div className="space-y-2">

    {/* Значение + единица измерения */}
    <div className="flex gap-4">
      <div className="flex-none">
        
        <input 
          type="number" 
          step="any" 
          value={field.defaultValue || ''} 
          onChange={e => onUpdate(field.id, { defaultValue: e.target.value })} 
          className="w-10 text-center text-sm bg-transparent rounded-md border-0 px-0 py-0.5 text-white placeholder:text-zinc-400 focus:outline-none focus:bg-white/5 transition-colors" 
          placeholder="0" 
        />
      </div>

      <div className="w-28">
      
        <input 
          type="text" 
          value={field.unit || ''} 
          onChange={e => onUpdate(field.id, { unit: e.target.value })} 
          className="w-10 text-sm bg-transparent rounded-md border-0 px-1 py-0.5 text-white placeholder:text-zinc-400 focus:outline-none focus:bg-white/5 transition-colors text-center" 
          placeholder="ед" 
        />
      </div>
    </div>

  </div>

        ) : field.type === 'checkbox' ? (
          <div>
            <div className="flex items-center gap-3">
              <label className="relative inline-flex shrink-0 cursor-pointer">
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="peer sr-only" />
                <span className="w-5 h-5 rounded-md border-2 border-white/40 bg-transparent peer-checked:bg-amber-400 peer-checked:border-amber-400 peer-focus-visible:ring-2 peer-focus-visible:ring-amber-400/40 transition-colors flex items-center justify-center">
                  {checked && (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-black">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
              </label>
              <input type="text" value={field.checkedPhrase || ''} onChange={e => onUpdate(field.id, { checkedPhrase: e.target.value })} className="flex-1 bg-transparent outline-none text-white text-sm" placeholder="Введите значение при галочке" />
            </div>
            <div className="flex items-center gap-3 mt-2">
              <span className="relative inline-flex shrink-0 opacity-40">
                <span className="w-5 h-5 rounded-md border-2 border-white/40 bg-transparent flex items-center justify-center" />
              </span>
              <input type="text" value={field.uncheckedPhrase || ''} onChange={e => onUpdate(field.id, { uncheckedPhrase: e.target.value })} className="flex-1 bg-transparent outline-none text-white text-sm" placeholder="Введите значение при пустом чекбоксе" />
            </div>
          </div>
        ) : field.type === 'select' ? (
          <div>
            <DndContext
              sensors={optionSensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleOptionDragEnd}
            >
              <SortableContext items={optionIds} strategy={verticalListSortingStrategy}>
                <div>
                  {/* Отступы между строками — py внутри строки, а не
                      space-y: margin у анимируемой по высоте строки прыгал
                      бы скачком в начале/конце анимации. */}
                  <AnimatePresence initial={false}>
                    {(field.options || []).map((option, index) => (
                      <CollapseRow key={optionIds[index] ?? index}>
                        <div className="py-1">
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

                  {/* Кнопка добавления — не на всю ширину строки: иначе
                      клик по пустому месту рядом с "+" тоже добавляет
                      вариант. */}
                  <div className="flex justify-center pt-1 pb-0.5">
                    <button onClick={handleAddOption} className="text-zinc-400 hover:text-amber-400 transition-colors cursor-pointer" aria-label="Добавить вариант">
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </SortableContext>
            </DndContext>
          </div>
        ) : field.type === 'rating' ? (
  <div>

    {/* Количество баллов */}
    <div className="flex items-center gap-3">
      <label className="text-sm font-medium text-zinc-400">Количество категорий</label>
      <input
        type="number"
        value={field.max || 5}
        onChange={e => onUpdate(field.id, { max: parseInt(e.target.value) || 5 })}
        min={2}
        max={10}
        className="w-20 px-4 py-1 bg-white/5 border border-white/10 rounded-2xl text-white text-center focus:outline-none transition-colors"
      />
    </div>

    {/* Включить пояснения — тот же чекбокс, что у поля "Чекбокс" (peer
        + sr-only + своя SVG-галочка), чтобы оба выглядели одинаково —
        нативный checkbox с accent-amber-400 визуально отличается. */}
    <label className="flex items-center gap-3 cursor-pointer text-sm text-zinc-300 mt-2">
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          checked={field.showExplanations || false}
          onChange={e => onUpdate(field.id, { showExplanations: e.target.checked })}
          className="peer sr-only"
        />
        <span className="w-5 h-5 rounded-md border-2 border-white/40 bg-transparent peer-checked:bg-amber-400 peer-checked:border-amber-400 peer-focus-visible:ring-2 peer-focus-visible:ring-amber-400/40 transition-colors flex items-center justify-center">
          {field.showExplanations && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-black">
              <path d="M5 13l4 4L19 7" />
            </svg>
          )}
        </span>
      </span>
      <span className="font-medium">Текст для каждой категории</span>
    </label>

    {/* Пояснения — отступы (gap-2) и размер шрифта цифры (text-sm) как в
        "Список", чтобы строки в обоих инструментах выглядели одинаково;
        цифра в колонке шириной w-6 (как иконка в "Список") и text-left —
        иначе при right-align короткие "1-9" смещались правее иконки. */}
    <AnimatePresence initial={false}>
    {field.showExplanations && (
      <CollapseRow key="explanations">
      <div className="pt-1">
        <AnimatePresence initial={false}>
        {Array.from({ length: field.max || 5 }, (_, i) => (
          <CollapseRow key={i}>
          <div className="flex items-center gap-2 py-1">
            <div className="w-6 text-left text-sm text-white">{i + 1}</div>
            <input
              type="text"
              value={field.explanations?.[i] || ''}
              onChange={e => {
  const newExps = [...(field.explanations || Array(field.max || 5).fill(''))];
  newExps[i] = e.target.value;
  onUpdate(field.id, { explanations: newExps });
              }}
              className="flex-1 bg-transparent rounded-md border-0 px-1 py-0.5 text-white placeholder:text-zinc-400 focus:outline-none focus:bg-white/5 transition-colors text-sm"
              placeholder={`Введите значение`}
            />
          </div>
          </CollapseRow>
        ))}
        </AnimatePresence>
      </div>
      </CollapseRow>
    )}
    </AnimatePresence>
  </div>
        ) : field.type === 'notes' ? (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(field.id);           // ← важно!
                  setShowAddLinkModal(true);
                }}
                className={NOTES_ACTION_CLASS}
              >
                <Link className="w-3.5 h-3.5" />
                Ссылка
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(field.id);           // ← важно!
                  handleAddImage();
                }}
                className={NOTES_ACTION_CLASS}
              >
                <ImagePlus className="w-3.5 h-3.5" />
                Изображение
              </button>
            </div>

            {field.notes && (
              <div className="space-y-0.5">
                {field.notes.split('\n').filter(Boolean).map((line, index) => {
                  const match = line.match(/\[(.*?)\]\((.*?)\)/);
                  if (!match) return null;
                  const [, text, url] = match;
                  return (
                    <div key={index} className="group/row flex items-center gap-1 py-0.5">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white hover:text-amber-400 underline underline-offset-2 decoration-white/30 text-sm flex-1 min-w-0 truncate transition-colors"
                      >
                        {text}
                      </a>
                      <button
                        onClick={(e) => { e.stopPropagation(); moveLinkUp(index); }}
                        className={`text-zinc-500 hover:text-white cursor-pointer ${ROW_ACTION_CLASS}`}
                        aria-label="Выше"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); moveLinkDown(index); }}
                        className={`text-zinc-500 hover:text-white cursor-pointer ${ROW_ACTION_CLASS}`}
                        aria-label="Ниже"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteLink(index); }}
                        className={`text-zinc-500 hover:text-red-400 cursor-pointer ml-1 ${ROW_ACTION_CLASS}`}
                        aria-label="Удалить ссылку"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : field.type === 'formula' ? (
          <div className="space-y-3">
            <input type="text" value={field.formula || ''} onChange={e => onUpdate(field.id, { formula: e.target.value })} className="w-full bg-transparent rounded-md border-0 px-1 py-0.5 text-white placeholder:text-zinc-400 focus:outline-none focus:bg-white/5 transition-colors text-sm" />
            <div className="flex items-center justify-between text-sm text-white">
              <span>Переменные</span>
            </div>
            <div>
              <AnimatePresence initial={false}>
              {(field.variables || []).map((v, i) => (
              <CollapseRow key={variableIds[i] ?? i}>
              <div className="group/row flex items-center gap-2 w-full bg-transparent px-0 py-0.5 text-white text-sm">
                  <input type="text" value={v.name} onChange={e => updateVariableName(i, e.target.value)} className="w-9 text-center bg-transparent rounded-md border-0 px-0 py-0.5 text-white text-sm focus:outline-none focus:bg-white/5 transition-colors" />
                  <span className="text-zinc-400 font-medium">=</span>
                  <input type="text" value={v.value || ''} onChange={e => updateVariableValue(i, e.target.value)} className="w-9 text-center bg-transparent rounded-md border-0 px-0 py-0.5 text-white text-sm focus:outline-none focus:bg-white/5 transition-colors" />
                  {/* Кнопка удаления — тот же Minus, что в "Список" */}
                  <button onClick={() => removeVariable(i)} className={`text-zinc-500 hover:text-red-400 cursor-pointer ml-1 ${ROW_ACTION_CLASS}`} aria-label="Удалить переменную">
                    <Minus className="w-4 h-4" />
                  </button>
                </div>
              </CollapseRow>
              ))}
              </AnimatePresence>

              {/* Кнопка добавления — тот же Plus, что в "Список".
                  Не на всю ширину строки: иначе клик по пустому месту
                  рядом с "+" тоже добавляет переменную. */}
              <div className="flex justify-center py-0.5">
                <button onClick={addVariable} className="text-zinc-400 hover:text-amber-400 transition-colors cursor-pointer" aria-label="Добавить переменную">
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-white text-sm mt-1">Результат:</span>
              <span className="text-white text-sm mt-1">{field.formula ? evaluateFormulaPreview(field.formula) : '—'}</span>
              <input type="text" value={field.unit || ''} onChange={e => onUpdate(field.id, { unit: e.target.value })} className="w-9 text-center mt-1 bg-transparent rounded-md border-0 px-0 py-0.5 text-white text-sm focus:outline-none focus:bg-white/5 transition-colors" />
            </div>
          </div>
        
          ) : null}

      </div>
      </div>
      </div>

      <div className="w-px bg-white/10 my-3 shrink-0" />
      {/* Кнопки видны при наведении на карточку, фокусе внутри неё или
          когда она выбрана — постоянно видимые у каждой карточки они
          забивали колонку визуальным шумом. */}
      <div className={`flex flex-col items-center gap-1 pt-3 pb-3 pl-2 pr-3 shrink-0 transition-opacity ${
        isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
      }`}>
        <div
          {...listeners}
          className="w-6 h-6 flex items-center justify-center cursor-grab active:cursor-grabbing text-zinc-500 hover:text-white rounded-md hover:bg-white/10 transition-colors"
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
            <Copy className="w-4 h-4" />
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
          <Trash2 size={16} />
        </button>
      </div>
      </div>
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
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify({ title: 'Новый шаблон', fields: [], isPublic: false }));
  const isDirty = useMemo(
    () => JSON.stringify({ title: templateTitle, fields, isPublic }) !== savedSnapshot,
    [templateTitle, fields, isPublic, savedSnapshot]
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

  const handleAddLink = (fieldId: string) => {
    if (!tempLinkUrl) {
      setShowAddLinkModal(false);
      return;
    }
    const current = fields.find(f => f.id === fieldId)?.notes || '';
    const link = `[${tempLinkText || tempLinkUrl}](${tempLinkUrl})`;
    updateField(fieldId, { notes: current ? current + '\n' + link : link });
    setTempLinkText('');
    setTempLinkUrl('');
    setShowAddLinkModal(false);
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

const migratedFields = (record.fields || []).map((f: BuilderField) => ({
  ...f,
  quickButtons: migrateQuickButtons(f.quickButtons),
}));

setFields(migratedFields);
setFieldsLoadKey(k => k + 1);
// Флаг публичности — только у своего шаблона: копия чужого публичного
// сохраняется личной.
const loadedIsPublic = record.user === user?.id ? !!record.isPublic : false;
setOwnerId(record.user || null);
setIsPublic(loadedIsPublic);
setSavedSnapshot(JSON.stringify({ title: record.title || "Новый шаблон", fields: migratedFields, isPublic: loadedIsPublic }));
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
      label: '',
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
      notes: type === 'notes' ? '' : undefined,
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
        fields: JSON.parse(JSON.stringify(fields)),
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
        setSavedSnapshot(JSON.stringify({ title, fields, isPublic: willBePublic }));
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

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white">

      <div className="sticky top-0 z-50 bg-zinc-900 border-b border-white/10">
  <DynamicUserHeader />
</div>

      <div className="flex flex-1 overflow-hidden">


      {/* ЛЕВАЯ ПАНЕЛЬ — инструменты. Фон и рамки панелей одни на всю
          страницу: zinc-900 + border-white/10 (центр — zinc-950). */}
      <div className="w-60 bg-zinc-900 border-r border-white/10 px-3 pt-6 pb-4 overflow-auto flex flex-col">
        <div className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          Добавить поле
        </div>
        <div className="space-y-0.5">
          {availableFields.map(item => (
            <button
              key={item.type}
              onClick={() => addField(item.type)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-zinc-300 hover:text-amber-400 hover:bg-white/5 transition-colors cursor-pointer"
            >
              {item.icon}
              <span className="text-sm font-medium tracking-tight text-white">{item.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-auto px-3 pt-6 text-xs leading-relaxed text-zinc-500">
          Новое поле появится сразу после выбранного, а если ничего не выбрано — в конце шаблона.
        </p>
      </div>

      {/* Центральная колонка по ширине контента — FIELDS_COLUMN_WIDTH, как
          колонка полей на странице заполнения, чтобы карточки выглядели так
          же. Всё оставшееся место — правой панели быстрых кнопок (flex-1). */}
      <div className="shrink-0 px-8 pt-5 pb-40 overflow-auto [scrollbar-gutter:stable]">
        {/* Действия с подписями вместо трёх иконок без подсказок внизу
            правой панели. "Сохранить" — единственная заметная кнопка. */}
        <div style={{ width: FIELDS_COLUMN_WIDTH }} className="flex items-center justify-between mb-5">
          <button
            onClick={goToList}
            className="h-8 -ml-2.5 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-sm text-zinc-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Шаблоны
          </button>
          <div className="flex items-center gap-2">
            {isDirty && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-zinc-500">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Не сохранено
              </span>
            )}
            <button
              onClick={goToFiller}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm text-zinc-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            >
              Заполнить
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={handleSaveClick}
              disabled={isSaving}
              className="h-8 px-3.5 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium bg-amber-400 text-zinc-950 hover:bg-amber-300 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {isOwner ? 'Сохранить' : 'Сохранить копию'}
            </button>
          </div>
        </div>
        {!isOwner && (
          <div style={{ width: FIELDS_COLUMN_WIDTH }} className="mb-5 px-3 py-2 flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 text-xs text-zinc-400">
            <Globe className="w-4 h-4 shrink-0 text-zinc-500" strokeWidth={1.75} />
            Публичный шаблон другого автора — изменения можно сохранить только как новый шаблон в вашем списке.
          </div>
        )}
        <div style={{ width: FIELDS_COLUMN_WIDTH }} className="flex items-center mb-6">
          <input
            type="text"
            value={templateTitle}
            onChange={(e) => setTemplateTitle(e.target.value)}
            className="flex-1 min-w-0 text-3xl font-bold bg-transparent outline-none text-center tracking-tight transition-colors"
            placeholder="Название шаблона"
          />
          {/* Переключатель публичности — в колонке справа от названия (та же
              ширина, что у боковой панели кнопок полей, поэтому название
              по-прежнему по центру): это свойство самого шаблона, а в
              верхней панели действий он уже не помещался в ширину колонки.
              Только у своего шаблона; применяется при сохранении, как и
              остальные правки. */}
          <div style={{ width: FIELD_ACTIONS_RAIL_WIDTH }} className="shrink-0 flex justify-end">
            {isOwner && (
              <button
                onClick={() => setIsPublic(v => !v)}
                aria-pressed={isPublic}
                aria-label={isPublic ? 'Публичный шаблон' : 'Личный шаблон'}
                className={`tooltip tooltip-bottom w-8 h-8 inline-flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
                  isPublic
                    ? 'text-amber-400 bg-amber-400/10 hover:bg-amber-400/15'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
                data-tip={isPublic ? 'Публичный — виден всем. Нажмите, чтобы сделать личным' : 'Личный — виден только вам. Нажмите, чтобы сделать публичным'}
              >
                <Globe className="w-4 h-4" strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setIsDraggingField(false)}
        >
          <SortableContext items={fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
            <div style={{ width: FIELDS_COLUMN_WIDTH }} className="flex flex-col">
              {fields.length === 0 && (
                // Отступ справа — та же ось центрирования, что у названия
                // шаблона (фантомная колонка FIELD_ACTIONS_RAIL_WIDTH).
                <div style={{ paddingRight: FIELD_ACTIONS_RAIL_WIDTH }}>
                <EmptyState
                  icon={<LayoutList className="w-5 h-5" />}
                  title="Шаблон пока пуст"
                  text="Добавьте первое поле из панели слева — например, «Заголовок» раздела или «Текст»."
                />
                </div>
              )}
              {/* mode="popLayout": уходящая карточка сразу вынимается из
                  потока (position: absolute) и доигрывает exit сама по себе
                  вместо того, чтобы держать соседей на месте до своего
                  исчезновения — иначе сдвиг соседей стартует отдельным,
                  рассинхронизированным рендером. См. комментарий в
                  SortableField. */}
              {/* initial={false} — при открытии шаблона карточки не
                  "проявляются" все разом, анимируются только добавленные. */}
              <AnimatePresence key={fieldsLoadKey} mode="popLayout" initial={false}>
                {fields.map(field => (
                  <SortableField
    key={field.id}
    field={field}
    isSelected={selectedFieldId === field.id}
    disableLayoutAnimation={isDraggingField}
    onSelect={setSelectedFieldId}
    onRemove={removeField}
    onUpdate={updateField}
    onDuplicate={duplicateField}
    showAddLinkModal={showAddLinkModal}
    setShowAddLinkModal={setShowAddLinkModal}
    tempLinkText={tempLinkText}
    setTempLinkText={setTempLinkText}
    tempLinkUrl={tempLinkUrl}
    setTempLinkUrl={setTempLinkUrl}
    handleAddLink={handleAddLink}
  />
                ))}
              </AnimatePresence>
            </div>
          </SortableContext>

        </DndContext>
      </div>

      {/* ПРАВАЯ ПАНЕЛЬ */}
      <div className="flex-1 min-w-[360px] bg-zinc-900 border-l border-white/10 flex flex-col">
        {selectedFieldId && ['text', 'conclusion'].includes(fields.find(f => f.id === selectedFieldId)?.type || '') ? (
  <div className="flex-1 overflow-auto p-6 [scrollbar-gutter:stable]">
    {(() => {
      const selectedField = fields.find(f => f.id === selectedFieldId);
      const groups = selectedField?.quickButtons || [];
      const limitReached = groups.length >= MAX_QUICK_BUTTON_GROUPS;
      return (
        <>
    {/* Заголовок по центру панели; "+" — справа, абсолютно, чтобы не
        сдвигать центр. */}
    <div className="relative flex flex-col items-center mb-5 px-36">
      <h3 className="font-semibold text-lg tracking-tight">Быстрые кнопки</h3>
      <span className="text-sm text-zinc-400 truncate max-w-full">
        {selectedField?.label || 'Без названия'}
      </span>
      <button
        onClick={addQuickButtonGroup}
        disabled={limitReached}
        className="absolute right-0 top-0 h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm text-zinc-300 bg-white/5 hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:hover:bg-white/5 disabled:hover:text-zinc-300 disabled:cursor-not-allowed cursor-pointer transition-colors"
      >
        <Plus className="w-4 h-4" />
        Группа
        <span className="text-zinc-500 tabular-nums">{groups.length}/{MAX_QUICK_BUTTON_GROUPS}</span>
      </button>
    </div>

    {/* Группы — карточками в адаптивной сетке. Порядок меняется
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
        <div className="relative grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 items-start">
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
  <div className="h-[300px] flex-shrink-0"></div>
  </div>
) : (
  <div className="flex-1 flex items-center justify-center px-6">
    <EmptyState
      icon={<MousePointerClick className="w-5 h-5" />}
      title="Быстрые кнопки"
      text="Выберите поле «Текст» или «Заключение» — здесь появятся его группы готовых фраз."
    />
  </div>
)}
      </div>
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
          if (e.key === 'Enter') handleAddLink(selectedFieldId!);
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
          <ModalButton variant="primary" onClick={() => handleAddLink(selectedFieldId!)} disabled={!tempLinkUrl.trim()}>
            Добавить
          </ModalButton>
        </ModalFooter>
      </AnimatedModal>

    </div>
  );
}
export default withAuth(TemplateBuilder);