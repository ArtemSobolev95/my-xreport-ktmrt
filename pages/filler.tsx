'use client';
import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter } from 'next/router';
import pb from '../lib/pocketbase';
pb.autoCancellation(false);
import { Copy, Download, Upload, ChevronDown, ChevronRight, Settings, Search, Trash2, Home, BookmarkIcon, RotateCcw, XCircle, Paperclip, Plus, Minus, Pencil, Link as LinkIcon, ExternalLink, Sparkles, SpellCheck, X } from 'lucide-react';
import type { BuilderField, QuickButtonGroup, Template } from '../types/builder';
import withAuth from '../components/withAuth';
import UserHeader from '../components/UserHeader';
import { migrateQuickButtons } from '../lib/migrateQuickButtons';
import { convertLegacyValue, isLegacyFieldType, migrateLegacyField } from '../lib/migrateFieldTypes';
import { DOCK_BUTTON_CLASS, DOCK_COLUMN_CLASS, DOCK_PANEL_CLASS, PAGE_COLUMNS_CLASS, SIDE_PANEL_TOP_CLASS } from '../lib/pageLayout';
import { LABELS_UPPERCASE_KEY, LABEL_CHIP_PADDING_PX, LABEL_COLON_PX, measureLabelPx, measureTextPx } from '../lib/fieldLabels';
import { evaluateFormula } from '../lib/evaluateFormula';
import { comparisonLine, formulaCommentKey, generateReport } from '../lib/generateReport';
import { useAbbreviations } from '../hooks/useAbbreviations';
import { usePhraseMemory } from '../hooks/usePhraseMemory';
import { firstWord, rankedPhrases, selectExamples, selectVocabulary, suggestedPhrase, sumStats, SLOT } from '../lib/phraseMemory';
import { toGhost } from '../lib/aiSuggest';
import { wordDiff } from '../lib/textDiff';
import { useDialog } from '../components/DialogProvider';
import CollapseRow from '../components/CollapseRow';
import SmoothHeight from '../components/SmoothHeight';
import AnimatedModal, { ModalBody, ModalButton, ModalFooter, ModalHeader, MODAL_INPUT_CLASS } from '../components/AnimatedModal';

// ====================== МОДУЛЬ РЕЙТИНГА ======================

const RatingField = ({
  field,
  value,
  onChange,
  onFocus,
  onKeyDown,
  disabled = false,
}: {
  field: BuilderField;
  value: number;
  onChange: (value: number) => void;
  onFocus: (fieldId: string, el: HTMLElement | null) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  disabled?: boolean;
}) => {
  const handleClick = (score: number) => {
    // Если уже выбрана эта оценка — сбрасываем в 0 (деактивируем)
    if (value === score) {
      onChange(0);
    } else {
      onChange(score);
    }
    onFocus(field.id, null);
  };

  return (
    // В строке поля — сразу после названия, внутри [ ].
    <div className="flex items-center gap-1">
      {Array.from({ length: field.max || 5 }, (_, i) => {
        const score = i + 1;
        const isActive = value === score;

        return (
          <button
              key={score}
              onClick={() => handleClick(score)}
              onKeyDown={onKeyDown}
              tabIndex={disabled ? -1 : 0}
              data-custom-focus
              className={`w-6 h-6 flex items-center justify-center text-xs font-medium rounded-md transition-all border cursor-pointer
                focus:outline-none focus-visible:border-amber-400 focus-visible:ring-2 focus-visible:ring-amber-400/40
                ${isActive
                  ? 'bg-amber-400/10 border-amber-400 text-amber-400'
                  : 'bg-transparent border-white/20 hover:border-amber-400 hover:bg-white/5 text-zinc-400'
                }
              `}
            >
              {score}
            </button>
        );
      })}
    </div>
  );
};
// ===========================================================================

// Ширина боковой панели кнопок (➕/➖/чип "в Заключение") у карточек полей —
// разделитель + колонка кнопок, измерено через getBoundingClientRect. Панель
// есть только у карточек (справа), а не у названия шаблона и заголовков
// разделов — из-за этого их центрирование давало бы другую ось. Чтобы все
// три уровня (название шаблона, заголовки, названия полей) были выровнены
// по одной вертикали, название шаблона и заголовки получают такой же
// "фантомный" отступ справа той же ширины.

// «Примечание» для ИИ-подсказок и памяти фраз — как отдельное текстовое
// поле шаблона с этим id (в phrase_memory у него своя память фраз).
const STATE_AFTER_FIELD_ID = '__state_after__';
const STATE_AFTER_FIELD: BuilderField = { id: STATE_AFTER_FIELD_ID, type: 'text', label: 'Примечание' };
// Отступы и шрифт поля «Примечания» — общие у textarea и слоя ИИ-подсказки.
const STATE_AFTER_TEXT_CLASS = 'px-3.5 py-2.5 text-sm';

// Пауза в наборе перед запросом ИИ-подсказки: меньше — чаще запросы на
// каждую букву, больше — подсказка заметно «опаздывает».
const AI_SUGGEST_DELAY_MS = 350;
// Пауза в наборе, после которой поле проверяется ИИ (опечатки, согласование):
// ~1 с — правка появляется быстро; совсем короткая всплывала бы в каждой
// паузе «на подумать».
const CORRECTION_IDLE_MS = 1000;
// Сколько выученных фраз поля нужно, чтобы перестать подмешивать в запрос
// модели фразы быстрых кнопок (см. запрос подсказки).
const COLD_START_PHRASES = 10;

// Раскладка страницы (док слева, строки по центру) — lib/pageLayout.ts;
// справа — панель быстрых кнопок.
const QUICK_COLUMN_CLASS = 'w-72 shrink-0';
const TOPBAR_BUTTON_CLASS = 'h-8 px-3 inline-flex items-center text-xs font-medium rounded-lg border transition-colors cursor-pointer';
const TOPBAR_BUTTON_ACTIVE_CLASS = 'bg-amber-400/10 border-amber-400 text-amber-400';
const TOPBAR_BUTTON_IDLE_CLASS = 'bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-white/20';
// Шрифт и отступы содержимого строки. Общие у textarea и её прозрачного
// зеркала (data-ghost-overlay) — иначе разойдутся переносы строк, и «]» с
// ИИ-подсказкой встанут не туда.
const CONTENT_TEXT_CLASS = 'pl-[8px] pr-1 py-0.5 text-sm leading-tight';
const BRACKET_OPEN_CLASS = 'pointer-events-none select-none absolute left-0 top-0 py-0.5 text-sm leading-tight text-zinc-500';
const BRACKET_CLOSE_CLASS = 'ml-[2px] text-zinc-500';

// Ширина числового поля по содержимому: цифры (tabular-nums) — по 1ch,
// точка/запятая/минус заметно уже; +0.3ch на курсор.
const numberInputWidth = (text: string): string => {
  const narrow = (text.match(/[.,\-\s]/g) || []).length;
  return `${Math.max(text.length - narrow + narrow * 0.4, 1.5) + 0.3}ch`;
};

// Маска ввода даты ДД-ММ-ГГГГ (цифры → "01-02-2025"). Один формат для
// всех дат страницы — раньше "Сравнение" ждало ДД-ММ-ГГГГ, а "Сохранить"
// — ДД.ММ.ГГГГ без маски.
const maskDateInput = (raw: string): string => {
  let value = raw.replace(/\D/g, '');
  if (value.length > 8) value = value.slice(0, 8);
  if (value.length >= 5) return `${value.slice(0, 2)}-${value.slice(2, 4)}-${value.slice(4)}`;
  if (value.length >= 3) return `${value.slice(0, 2)}-${value.slice(2)}`;
  return value;
};

// "1 сокращение / 2 сокращения / 5 сокращений"
const pluralRu = (n: number, forms: [string, string, string]) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
};

// Ссылки в заметках тоже приходят из шаблона — не даём вставить javascript:/data: URL.
const isSafeUrl = (url: string): boolean => {
  try {
    // Базовый URL нужен только для разбора относительных ссылок — на
    // проверку схемы (http/https/mailto) он не влияет.
    const parsed = new URL(url, 'http://localhost');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:';
  } catch {
    return false;
  }
};

// Должно совпадать с duration-200 на строках полей (см. className ниже,
// где рендерятся строки) — используется, чтобы не скроллить/фокусировать
// элемент, пока его ещё двигает CSS-анимация сворачивания/разворачивания.
const SECTION_TRANSITION_MS = 200;

function FillerPage() {
  const router = useRouter();
  const dialog = useDialog();
  const { id } = router.query;
  const user = pb.authStore.record; // openButtonId и newGroupName больше не используются —
  const [template, setTemplate] = useState<Template | null>(null);
  const [originalTemplate, setOriginalTemplate] = useState<Template | null>(null);
  // Значения полей разнотипны по природе (текст/число/bool/массив вариантов
  // формулы) в зависимости от BuilderField.type — единый строгий тип здесь
  // потребовал бы дискриминированного маппинга по каждому типу поля.
  const [fieldsData, setFieldsData] = useState<Record<string, any>>({});
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const activeFieldRef = useRef<string | null>(null);
  const activeInputRef = useRef<HTMLElement | null>(null);
  // Последний элемент поля/заголовка раздела, получивший фокус. В отличие
  // от activeInputRef, не сбрасывается в handleBlur — нужен, чтобы вернуть
  // фокус туда же после закрытия модалки (см. эффект рядом с закрытием
  // модалок по Escape).
  const lastFocusedFieldElRef = useRef<HTMLElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletedFieldIds, setDeletedFieldIds] = useState<string[]>([]);
  const {
    abbreviations,
    categories,
    saveData,
    addNewGroup: addNewGroupData,
    addNewAbbreviation: addNewAbbreviationData,
    deleteCategory: deleteCategoryData,
    deleteAbbreviation,
    recordUsage,
    exportAbbreviations,
    importAbbreviations: importAbbreviationsFile,
  } = useAbbreviations();
  // ИИ-подсказки при наборе (ghost-text, pb_hooks/suggest.pb.js). Память
  // фраз (lib/phraseMemory.ts) обучается на скопированных/сохранённых
  // протоколах и уходит в запрос как примеры формулировок пользователя —
  // так подсказки персонализируются. caret — позиция курсора в текстовом
  // поле (null — выделен фрагмент или фокуса нет).
  const phraseMemory = usePhraseMemory(typeof id === 'string' ? id : undefined);
  const [caret, setCaret] = useState<{ fieldId: string; pos: number } | null>(null);
  // Ответ модели для конкретного текста до курсора.
  const [aiGhost, setAiGhost] = useState<{ fieldId: string; textBefore: string; ghost: string; model: string } | null>(null);
  // Скрытые по Esc: id поля → тексты до курсора, где подсказку не показывать.
  const [dismissedGhosts, setDismissedGhosts] = useState<Record<string, Set<string>>>({});
  // ИИ-проверка поля (pb_hooks/correct.pb.js) при выходе из него: id поля →
  // исправленный вариант для конкретного текста. Показывается, пока текст
  // поля не изменился.
  const [corrections, setCorrections] = useState<Record<string, { original: string; corrected: string }>>({});
  const [phraseMemoryFieldId, setPhraseMemoryFieldId] = useState<string | null>(null);
  // Названия полей ЗАГЛАВНЫМИ (переключатель над полями) — настройка
  // внешнего вида, запоминается в этом браузере.
  const [labelsUppercase, setLabelsUppercase] = useState(false);
  useEffect(() => {
    try {
      setLabelsUppercase(localStorage.getItem(LABELS_UPPERCASE_KEY) === '1');
    } catch {}
  }, []);
  const toggleLabelsUppercase = () => {
    setLabelsUppercase(prev => {
      try { localStorage.setItem(LABELS_UPPERCASE_KEY, prev ? '0' : '1'); } catch {}
      return !prev;
    });
  };
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Все');
  const [newAbbrText, setNewAbbrText] = useState('');
  const [newFullText, setNewFullText] = useState('');
  const [editingAbbrKey, setEditingAbbrKey] = useState<string | null>(null);
  const [editingFullKey, setEditingFullKey] = useState<string | null>(null);
  const [variantSelector, setVariantSelector] = useState<{
  fieldId: string;
  variants: string[];
  prefix: string;
  trigger: string;
  startPos: number;
  position: { top: number; left: number };
  abbrKey: string;
  originalWord?: string;
  isAbove?: boolean;
} | null>(null);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>>({});
  const [initialized, setInitialized] = useState(false);
  const [newlyAddedId, setNewlyAddedId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isComparisonActive, setIsComparisonActive] = useState(false);
  const [comparisonDates, setComparisonDates] = useState<string[]>([]);
  // Стабильные id дат — только для key анимации строк в модалке
  // "Сравнение" (CollapseRow): по индексу при удалении даты из середины
  // исчезала бы последняя строка, а не удалённая. Добавление/удаление в
  // модалке меняют их вместе с датами; любое другое изменение количества
  // (черновик, сброс, "Применить") — пересоздаёт.
  const [comparisonDateIds, setComparisonDateIds] = useState<string[]>([]);
  if (comparisonDateIds.length !== comparisonDates.length) {
    setComparisonDateIds(comparisonDates.map(() => crypto.randomUUID()));
  }
  const [isMultipleComparison, setIsMultipleComparison] = useState(false);
  const [isStateAfterActive, setIsStateAfterActive] = useState(false);
  const stateAfterTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [pathNav, setPathNav] = useState<{
  groupIdx: number;
  phraseIdx: number;
} | null>(null);
  // Группа кнопок патологий, раскрытая кликом мыши (в отличие от pathNav,
  // который отвечает за раскрытие горячими клавишами/клавиатурой и не
  // должен меняться от наведения курсора) — раскрытие по hover убрано,
  // список раскрывается только по клику на группу.
  const [openQuickButtonGroupIdx, setOpenQuickButtonGroupIdx] = useState<number | null>(null);
  const quickButtonGroupRefs = useRef<Record<number, HTMLDivElement | null>>({});


  // === Валидация и форматирование даты ДД-ММ-ГГГГ ===
  const isValidDateDDMMYYYY = (dateStr: string): boolean => {
    if (!/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) return false;
    const [day, month, year] = dateStr.split('-').map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    if (year < 1900 || year > 2100) return false;
    const daysInMonth = new Date(year, month, 0).getDate();
    return day <= daysInMonth;
  };

  const formatDateToDDMMYYYY = (dateStr: string): string => {
    if (!dateStr) return '';
    if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) return dateStr;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split('-');
      return `${d}-${m}-${y}`;
    }
    return dateStr;
  };
  const [stateAfterText, setStateAfterText] = useState('');
  const [showComparisonModal, setShowComparisonModal] = useState(false);
  

const handleComparisonDateChange = (e: React.ChangeEvent<HTMLInputElement>, index: number = 0) => {
  const value = maskDateInput(e.target.value);

  const newDates = [...comparisonDates];
  newDates[index] = value;
  
  setComparisonDates(newDates);
};
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [showStateAfterModal, setShowStateAfterModal] = useState(false);
  const [showAbbrModal, setShowAbbrModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [fullName, setFullName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [history, setHistory] = useState<Array<{ 
    fieldsData: Record<string, any>; 
    deletedFieldIds: string[] 
  }>>([]);
  const MAX_HISTORY = 50;

  const typingSessionRef = useRef(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const endTypingSession = () => {
    typingSessionRef.current = false;
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
  };

    const fieldsDataRef = useRef(fieldsData);
  const deletedFieldIdsRef = useRef(deletedFieldIds);

  useEffect(() => {
    fieldsDataRef.current = fieldsData;
    deletedFieldIdsRef.current = deletedFieldIds;
  }, [fieldsData, deletedFieldIds]);

  // === Состояние сворачивания разделов (по заголовкам) ===
const [collapsedHeaders, setCollapsedHeaders] = useState<Set<string>>(new Set());
const [skipSectionTransition, setSkipSectionTransition] = useState(false);

  // === Работа с черновиком в localStorage ===
const DRAFT_KEY_PREFIX = 'filler_draft_';

const getDraftKey = (templateId: string) => `${DRAFT_KEY_PREFIX}${templateId}`;

const saveDraft = (
  templateId: string, 
  data: Record<string, any>, 
  deleted: string[],
  comparisonActive: boolean = false,
  compDates: string[] = [],
  multipleComparison: boolean = false,
  stateActive: boolean = false,
  stateText: string = ''
) => {
  if (!templateId) return;
  try {
    const draft = {
      fieldsData: data,
      deletedFieldIds: deleted,
      isComparisonActive: comparisonActive,
      comparisonDates: compDates,
      isMultipleComparison: multipleComparison,
      isStateAfterActive: stateActive,
      stateAfterText: stateText,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(getDraftKey(templateId), JSON.stringify(draft));
  } catch (e) {
    console.warn('Не удалось сохранить черновик в localStorage');
  }
};

const loadDraft = (templateId: string) => {
  if (!templateId) return null;
  try {
    const raw = localStorage.getItem(getDraftKey(templateId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const clearDraft = (templateId: string) => {
  if (!templateId) return;
  localStorage.removeItem(getDraftKey(templateId));
};

// Небольшое исчезающее уведомление в шапке (восстановление черновика,
// копирование в буфер и т.п.) — один общий тост вместо отдельного
// состояния на каждый случай.
const [toastMessage, setToastMessage] = useState<string | null>(null);
const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const showToast = (message: string, duration: number) => {
  if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  setToastMessage(message);
  toastTimerRef.current = setTimeout(() => setToastMessage(null), duration);
};

    const saveToHistory = () => {
    const snapshot = {
      fieldsData: { ...fieldsDataRef.current },
      deletedFieldIds: [...deletedFieldIdsRef.current],
    };

    setHistory(prev => {
      const last = prev[prev.length - 1];
      if (
        last &&
        JSON.stringify(last.fieldsData) === JSON.stringify(snapshot.fieldsData) &&
        JSON.stringify(last.deletedFieldIds) === JSON.stringify(snapshot.deletedFieldIds)
      ) {
        return prev;
      }
      return [...prev, snapshot].slice(-MAX_HISTORY);
    });
  };

    const undo = () => {
    if (history.length === 0) return;
    const lastState = history[history.length - 1];

    fieldsDataRef.current = lastState.fieldsData;
    deletedFieldIdsRef.current = lastState.deletedFieldIds;

    setFieldsData(lastState.fieldsData);
    setDeletedFieldIds([...lastState.deletedFieldIds]);
    setHistory(prev => prev.slice(0, -1));
    endTypingSession();
  };

  // === Логика сворачивания разделов ===
const initializeCollapsedState = (fields: BuilderField[]) => {
  const headerIds = fields
    .filter((f) => f.type === 'header')
    .map((f) => f.id);
  setCollapsedHeaders(new Set(headerIds));
};

const toggleSection = (headerId: string) => {
  setCollapsedHeaders(prev => {
    const newSet = new Set(prev);
    if (newSet.has(headerId)) {
      newSet.delete(headerId);
    } else {
      newSet.add(headerId);
    }
    return newSet;
  });
};

const toggleAllSections = () => {
  if (!template) return;

  const allHeaderIds = (template.fields || [])
    .filter((f: BuilderField) => f.type === 'header' && !deletedFieldIds.includes(f.id))
    .map((f: BuilderField) => f.id);

  if (allHeaderIds.length === 0) return;

  // 1) заголовок в фокусе
  let targetHeaderId: string | null = null;
  const focused = document.activeElement as HTMLElement | null;
  const focusedHeaderId = focused?.getAttribute?.('data-header-id');
  if (focusedHeaderId && allHeaderIds.includes(focusedHeaderId)) {
    targetHeaderId = focusedHeaderId;
  }

  // 2) иначе — раздел активного поля
  if (!targetHeaderId && activeFieldRef.current) {
    let currentHeader: string | null = null;
    for (const f of template.fields) {
      if (deletedFieldIds.includes(f.id)) continue;
      if (f.type === 'header') currentHeader = f.id;
      else if (f.id === activeFieldRef.current && currentHeader) {
        targetHeaderId = currentHeader;
        break;
      }
    }
  }

  // 3) иначе — первый открытый, потом первый в списке
  if (!targetHeaderId) {
    targetHeaderId =
      allHeaderIds.find((id: string) => !collapsedHeaders.has(id)) || allHeaderIds[0];
  }

  if (!targetHeaderId) return;
  openOnlySection(targetHeaderId);
};


// scroll=false — прокрутку уже сделал вызывающий код (glideHeaderIntoPlace),
// здесь только фокус.
const focusFieldElement = (fieldId: string, scroll = true) => {
  // обычные поля
  let el = inputRefs.current[fieldId] as HTMLElement | undefined;

  // formula — первая переменная
  if (!el) {
    el = inputRefs.current[`${fieldId}_var_0`] as HTMLElement | undefined;
  }

  // rating / fallback — любой focusable внутри карточки
  if (!el) {
    el = document.querySelector(
      `[data-field-id="${fieldId}"] button, [data-field-id="${fieldId}"] input, [data-field-id="${fieldId}"] select, [data-field-id="${fieldId}"] textarea`
    ) as HTMLElement | null || undefined;
  }

  if (el) {
    // preventScroll — свой scrollIntoView ниже плавный (behavior: 'smooth'),
    // а нативная прокрутка браузера при фокусе происходит мгновенно и
    // сбивала бы эту анимацию своим скачком в середине. Без явного
    // scrollIntoView прокрутки не было вообще — раздел, схлопываясь и
    // разворачиваясь, двигал контент под фиксированной точкой обзора сам
    // (через layout/scroll anchoring), что и выглядело как рывок вверх при
    // сворачивании прошлых разделов, а затем вниз при раскрытии текущего.
    el.focus({ preventScroll: true });
    if (scroll) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    setActiveFieldId(fieldId);
    activeFieldRef.current = fieldId;
  }
};

const openOnlySection = (headerId: string, instant = false) => {
  if (!template) return;

  const allHeaderIds = (template.fields || [])
    .filter((f: BuilderField) => f.type === 'header' && !deletedFieldIds.includes(f.id))
    .map((f: BuilderField) => f.id);

  const isCurrentlyOpen = !collapsedHeaders.has(headerId);

  // Если раздел уже открыт — закрываем и оставляем фокус на заголовке
    if (isCurrentlyOpen) {
    setCollapsedHeaders(prev => new Set([...prev, headerId]));
    setActiveFieldId(null);
    activeFieldRef.current = null;
    activeInputRef.current = null;

    // чуть позже, чем click/blur поля
    setTimeout(() => {
      const el = document.querySelector(
        `[data-header-id="${headerId}"]`
      ) as HTMLElement | null;
      el?.focus();
    }, 10);
    return;
  }

  // Открываем этот раздел, остальные закрываем — по умолчанию анимированно,
  // так же, как и закрытие (раньше здесь стоял setSkipSectionTransition(true),
  // из-за чего открытие происходило мгновенно, без анимации, а закрытие —
  // с анимацией; теперь оба случая по умолчанию ведут себя одинаково).
  //
  // instant=true — исключение для перехода Tab с последнего поля раздела
  // на следующий (см. handleFieldTabNavigation): там одновременно
  // схлопывается текущий (уже прочитанный пользователем, часто длинный)
  // раздел и разворачивается следующий. Пока это анимировано, схлопывание
  // раздела ВЫШЕ текущей позиции скролла убирает опору под ней раньше, чем
  // успевает вырасти новый раздел — браузер зажимает scrollY вниз, и это
  // выглядит как рывок вверх, а последующий scrollIntoView в
  // focusFieldElement лишь чуть довинчивает уже сбившееся положение (рывок
  // вниз). Мгновенное схлопывание/разворот (как и при обратном Shift+Tab)
  // убирает это окно рассинхронизации: DOM встаёт на место одним кадром,
  // и единственное движение экрана — один плавный scrollIntoView к цели.
  if (instant) setSkipSectionTransition(true);
  setCollapsedHeaders(new Set(allHeaderIds.filter((id: string) => id !== headerId)));

  // Ищем первое поле после этого заголовка
  let foundHeader = false;
  let firstFieldId: string | null = null;

  for (const f of template.fields) {
    if (deletedFieldIds.includes(f.id)) continue;

    if (f.id === headerId) {
      foundHeader = true;
      continue;
    }

    if (foundHeader) {
      if (f.type === 'header') break;
      if (f.type !== 'notes') {
        firstFieldId = f.id;
        break;
      }
    }
  }

  if (!firstFieldId) return;

  if (instant) {
    // Транзиция пропущена (duration-0) — DOM уже в конечном состоянии на
    // следующем кадре, ждать SECTION_TRANSITION_MS не нужно (см. Shift+Tab
    // назад чуть ниже, где используется тот же приём).
    requestAnimationFrame(() => focusFieldElement(firstFieldId!));
  } else {
    // Раньше здесь ждали конца CSS-анимации и затем делали scrollIntoView к
    // первому полю. Это давало два движения подряд: пока схлопывался
    // раздел ВЫШЕ кликнутого заголовка, заголовок вместе со всем контентом
    // уезжал вверх (выглядит как скролл вниз), а потом scrollIntoView
    // возвращал страницу обратно (скролл вверх) — "мини-скролл вниз, потом
    // вверх", особенно заметно на длинных разделах. Теперь на каждом кадре
    // анимации сами держим кликнутый заголовок в нужной точке экрана и
    // плавно ведём его от исходного положения к верху области просмотра —
    // одно непрерывное движение одновременно со схлопыванием/раскрытием.
    glideHeaderIntoPlace(headerId, () => focusFieldElement(firstFieldId!, false));
  }
};

// rAF-цикл текущего "ведения" заголовка — повторный клик по другому
// заголовку до окончания анимации отменяет предыдущий цикл.
const headerGlideRafRef = useRef<number | null>(null);
// До этого момента (performance.now()) авто-прокрутка к активному полю
// (эффект на activeFieldId/collapsedHeaders) отключена — см. там.
const manualScrollUntilRef = useRef(0);

const glideHeaderIntoPlace = (headerId: string, onDone: () => void) => {
  if (headerGlideRafRef.current !== null) cancelAnimationFrame(headerGlideRafRef.current);
  // С запасом: onDone (фокус первого поля) вызывается в конце цикла, а
  // эффект реагирует на него ещё через кадр.
  manualScrollUntilRef.current = performance.now() + SECTION_TRANSITION_MS + 500;

  const headerEl = document.querySelector(`[data-header-id="${headerId}"]`) as HTMLElement | null;
  if (!headerEl) {
    setTimeout(onDone, SECTION_TRANSITION_MS + 10);
    return;
  }

  // Целевое положение — сразу под липкой верхней панелью, с небольшим
  // отступом: так раскрытый раздел виден максимально.
  const topBar = document.querySelector('[data-filler-topbar]') as HTMLElement | null;
  const targetTop = (topBar?.getBoundingClientRect().bottom ?? 0) + 16;
  const startTop = headerEl.getBoundingClientRect().top;

  // Ведём заголовок чуть дольше самой CSS-транзиции: она стартует на кадр
  // позже (после коммита React), и последние кадры нужно тоже удержать.
  const glideMs = SECTION_TRANSITION_MS;
  const holdMs = SECTION_TRANSITION_MS + 80;
  const start = performance.now();

  const step = (now: number) => {
    const elapsed = now - start;
    const t = Math.min(1, elapsed / glideMs);
    const eased = 1 - Math.pow(1 - t, 3);
    const desired = startTop + (targetTop - startTop) * eased;
    const delta = headerEl.getBoundingClientRect().top - desired;
    // behavior: 'instant' обязателен — в globals.css у html стоит
    // scroll-behavior: smooth, и без этого каждая покадровая поправка
    // сама превращалась бы в отдельную плавную прокрутку.
    if (Math.abs(delta) > 0.5) {
      window.scrollTo({ top: window.scrollY + delta, behavior: 'instant' });
    }
    if (elapsed < holdMs) {
      headerGlideRafRef.current = requestAnimationFrame(step);
    } else {
      headerGlideRafRef.current = null;
      onDone();
    }
  };
  headerGlideRafRef.current = requestAnimationFrame(step);
};

// Переход фокуса между заголовками при Tab-навигации (см. onKeyDown у
// заголовка ниже). Раскрытие/закрытие раздела сюда НЕ входит — это
// отдельное действие по Enter/Space или Ctrl+E. Функция только переводит
// фокус на соседний заголовок и прокручивает его в область видимости —
// используется лишь когда текущий раздел свёрнут (внутри него нет
// табируемых полей, поэтому естественный порядок Tab через него
// "перепрыгнуть" не может); если раздел уже раскрыт, обработчик ниже
// вообще не вызывает эту функцию и отдаёт Tab браузеру, чтобы фокус ушёл
// в содержимое раздела.
const focusHeaderForNav = (headerId: string) => {
  const el = document.querySelector(`[data-header-id="${headerId}"]`) as HTMLElement | null;
  el?.focus({ preventScroll: true });
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

const handleFieldTabNavigation = (
  e: React.KeyboardEvent,
  fieldId: string,
  // Для formula-полей с несколькими переменными: индекс текущей переменной
  // и их общее количество. Без этого Tab с ЛЮБОЙ переменной формулы (не
  // только последней) считался переходом с "последнего поля раздела" и
  // сразу прыгал в следующий раздел, даже если у формулы ещё остались
  // незаполненные переменные.
  varInfo?: { index: number; total: number }
) => {
  if (e.key !== 'Tab' || !template) return;

  const sections: { headerId: string; fieldIds: string[] }[] = [];
  let current: { headerId: string; fieldIds: string[] } | null = null;

  for (const f of template.fields) {
    if (deletedFieldIds.includes(f.id)) continue;
    if (f.type === 'header') {
      current = { headerId: f.id, fieldIds: [] };
      sections.push(current);
    } else if (current && f.type !== 'notes') {
      current.fieldIds.push(f.id);
    }
  }

  const sectionIndex = sections.findIndex(s => s.fieldIds.includes(fieldId));
  if (sectionIndex === -1) return;

  const section = sections[sectionIndex];
  const pos = section.fieldIds.indexOf(fieldId);
  const isLastVar = !varInfo || varInfo.index === varInfo.total - 1;
  const isFirstVar = !varInfo || varInfo.index === 0;

  // Tab с последнего поля → следующий раздел
  if (!e.shiftKey && pos === section.fieldIds.length - 1 && isLastVar) {
    e.preventDefault();
    const next = sections[sectionIndex + 1];
    if (!next) return;
    openOnlySection(next.headerId, true);
    return;
  }

  // Shift+Tab с первого поля → предыдущий раздел, последнее поле
  if (e.shiftKey && pos === 0 && isFirstVar) {
    e.preventDefault();
    const prev = sections[sectionIndex - 1];
    if (!prev) {
      // Это самый первый раздел — предыдущего нет, возвращаем фокус
      // на заголовок текущего раздела (иначе Shift+Tab тут молча
      // ничего не делал бы, что выглядит как залипание фокуса).
      focusHeaderForNav(section.headerId);
      return;
    }

    const allHeaderIds = sections.map(s => s.headerId);
    setSkipSectionTransition(true);
    setCollapsedHeaders(new Set(allHeaderIds.filter(id => id !== prev.headerId)));

        const lastId = prev.fieldIds[prev.fieldIds.length - 1];
    requestAnimationFrame(() => {
      // для formula — последняя переменная, если есть
      const lastVarKey = Object.keys(inputRefs.current)
        .filter(k => k.startsWith(`${lastId}_var_`))
        .sort()
        .pop();
      if (lastVarKey && inputRefs.current[lastVarKey]) {
        inputRefs.current[lastVarKey].focus({ preventScroll: true });
      } else {
        focusFieldElement(lastId);
      }
    });
  }
};

  
  // === Автосохранение черновика ===
useEffect(() => {
  if (!id || !template) return;

  const timeout = setTimeout(() => {
    saveDraft(
      id as string, 
      fieldsData, 
      deletedFieldIds,
      isComparisonActive,
      comparisonDates,
      isMultipleComparison,
      isStateAfterActive,
      stateAfterText
    );
  }, 400);

  return () => clearTimeout(timeout);
}, [fieldsData, deletedFieldIds, id, template, isComparisonActive, comparisonDates, isMultipleComparison, isStateAfterActive, stateAfterText]);

  const autoResize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    // Подсказка фраз (ghost-text) может переноситься на строку ниже текста —
    // поле растягиваем и под неё, иначе она вылезала бы за его границы.
    const ghostOverlay = el.parentElement?.querySelector<HTMLElement>('[data-ghost-overlay]');
    const contentHeight = Math.max(el.scrollHeight, ghostOverlay?.scrollHeight ?? 0);
    el.style.height = Math.min(contentHeight, 400) + 'px';
  };

  const addTextFieldAfter = (currentId: string) => {
  if (!template) return;
  saveToHistory();

  // crypto.randomUUID(), не Date.now() — при быстрых повторных кликах
  // Date.now() легко возвращает одно и то же значение для двух полей
  // подряд (разрешение — 1мс), и React путает их как один элемент по ключу.
  const newId = 'text-' + crypto.randomUUID();
  const newField: BuilderField = { 
    id: newId, 
    type: 'text',
    label: '', 
    isQuickText: true 
  };

  const index = template.fields.findIndex((f: BuilderField) => f.id === currentId);
  if (index === -1) return;

  const newFields = [
    ...template.fields.slice(0, index + 1), 
    newField, 
    ...template.fields.slice(index + 1)
  ];

  setTemplate({ ...template, fields: newFields });
  setFieldsData(prev => ({ ...prev, [newId]: '' }));

  setNewlyAddedId(newId);
  setTimeout(() => {
    setNewlyAddedId(null);
  }, 20);
};

      const updateFieldLabel = (fieldId: string, newLabel: string) => {
    saveToHistory();
    setTemplate((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        fields: prev.fields.map((f) =>
          f.id === fieldId ? { ...f, label: newLabel } : f
        )
      };
    });
  };

    const removeField = (fieldId: string) => {
    saveToHistory();
    setRemovingId(fieldId);
    setTimeout(() => {
      setDeletedFieldIds(prev => [...prev, fieldId]);
      setFieldsData(prev => {
        const copy = { ...prev };
        delete copy[fieldId];
        return copy;
      });
      setRemovingId(null);
    }, 200);
  };

  const resetToDefault = async () => {
  if (!originalTemplate || !id) return;

  // Подтверждение перед сбросом
  const confirmed = await dialog.confirm(
    'Протокол вернётся к исходному состоянию шаблона — все введённые данные будут удалены.',
    { title: 'Сбросить протокол?', danger: true, confirmText: 'Сбросить' }
  );
  if (!confirmed) return;

  saveToHistory();

  // Очищаем черновик
  clearDraft(id as string);

  // Сброс шаблона
  setTemplate(JSON.parse(JSON.stringify(originalTemplate)));
  setDeletedFieldIds([]);

  // Сброс значений полей
  const init: Record<string, any> = {};
  originalTemplate.fields.forEach((f: BuilderField) => {
    if (f.defaultValue !== undefined) init[f.id] = f.defaultValue;
    else if (f.type === 'checkbox') init[f.id] = false;
    else if (f.type === 'rating') init[f.id] = 0;
    else init[f.id] = '';
  });

  setFieldsData(init);
  resetTextareaHeights(init);
  startNewReportPhrases();

  // Сброс дополнительных состояний
  setIsComparisonActive(false);
  setComparisonDates([]);
  setIsMultipleComparison(false);
  setIsStateAfterActive(false);
  setStateAfterText('');
  setToastMessage(null);
};

  // === Очистка черновика + сброс к дефолтным значениям ===
const handleClearDraft = async () => {
  if (!id || !template || !originalTemplate) return;

  const confirmed = await dialog.confirm('Все введённые данные будут удалены.', {
    title: 'Очистить черновик?',
    danger: true,
    confirmText: 'Очистить',
  });
  if (!confirmed) {
    return;
  }

  // Удаляем из localStorage
  clearDraft(id as string);

  // Сбрасываем к исходному состоянию шаблона
  setTemplate(JSON.parse(JSON.stringify(originalTemplate)));
  setDeletedFieldIds([]);

  // Создаём чистые значения полей
  const init: Record<string, any> = {};
  originalTemplate.fields.forEach((f: BuilderField) => {
    if (f.defaultValue !== undefined) init[f.id] = f.defaultValue;
    else if (f.type === 'checkbox') init[f.id] = false;
    else if (f.type === 'rating') init[f.id] = 0;
    else init[f.id] = '';
  });

  setFieldsData(init);
  resetTextareaHeights(init);
  startNewReportPhrases();
  setIsComparisonActive(false);
  setComparisonDates([]);
  setIsMultipleComparison(false);
  setIsStateAfterActive(false);
  setStateAfterText('');
  setToastMessage(null);
  initializeCollapsedState(originalTemplate.fields);
};
 
  const anyModalOpen =
    showComparisonModal ||
    showStateAfterModal ||
    showAbbrModal ||
    showNotesModal ||
    showSaveModal ||
    phraseMemoryFieldId !== null;

  // === ИИ-ПОДСКАЗКИ (ghost-text) ===
  // Где подсказка уместна: активное текстовое поле / «Заключение», курсор в
  // конце текста (дальше — лишь пробелы), без выделения. Не показываем,
  // пока открыт выбор вариантов сокращения, список быстрых кнопок или
  // модалка — у них свои стрелки/Enter/Esc.
  // Поле «Примечания» (в его окне) работает как ещё одно текстовое поле со
  // своей памятью фраз: условие показа — открыто его окно, а не фокус в
  // строке шаблона.
  const ghostContext = useMemo(() => {
    if (!caret) return null;
    const isStateAfter = caret.fieldId === STATE_AFTER_FIELD_ID;
    if (isStateAfter) {
      const otherModalOpen = anyModalOpen && !(showStateAfterModal && !showComparisonModal && !showAbbrModal && !showNotesModal && !showSaveModal && phraseMemoryFieldId === null);
      if (!showStateAfterModal || otherModalOpen) return null;
    } else {
      if (caret.fieldId !== activeFieldId) return null;
      if (variantSelector || pathNav || openQuickButtonGroupIdx !== null || anyModalOpen) return null;
    }
    const field = isStateAfter ? STATE_AFTER_FIELD : template?.fields.find(f => f.id === caret.fieldId);
    if (!field || (field.type !== 'text' && field.type !== 'conclusion')) return null;

    const value: string = isStateAfter ? stateAfterText : (fieldsData[field.id] || '');
    if (caret.pos > value.length || value.slice(caret.pos).trim() !== '') return null;
    // В пустом поле с placeholder'ом тот и так подставится в протокол —
    // подсказка поверх него только мешала бы.
    if (!value.trim() && field.placeholder) return null;

    const textBefore = value.slice(0, caret.pos);
    if (dismissedGhosts[field.id]?.has(textBefore)) return null;
    return { field, fieldId: field.id, pos: caret.pos, textBefore };
  }, [caret, activeFieldId, variantSelector, pathNav, openQuickButtonGroupIdx, anyModalOpen, template, fieldsData, dismissedGhosts,
      stateAfterText, showStateAfterModal, showComparisonModal, showAbbrModal, showNotesModal, showSaveModal, phraseMemoryFieldId]);

  // Показываем ответ модели, только если он получен ровно для текущего
  // текста до курсора. Если пользователь печатает то, что подсказано,
  // подсказка «сужается» без нового запроса — как в Google.
  const ghost = useMemo(() => {
    if (!ghostContext || !aiGhost || aiGhost.fieldId !== ghostContext.fieldId) return null;
    const { textBefore } = ghostContext;
    if (!textBefore.startsWith(aiGhost.textBefore)) return null;
    const typed = textBefore.slice(aiGhost.textBefore.length);
    if (!aiGhost.ghost.toLowerCase().startsWith(typed.toLowerCase())) return null;
    const rest = aiGhost.ghost.slice(typed.length);
    return rest.trim() ? { fieldId: ghostContext.fieldId, pos: ghostContext.pos, ghost: rest } : null;
  }, [ghostContext, aiGhost]);

  // Подсказка появилась/исчезла — пересчитываем высоту поля (autoResize
  // учитывает и строки подсказки).
  const prevGhostFieldRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const ids = new Set([prevGhostFieldRef.current, ghost?.fieldId].filter(Boolean) as string[]);
    prevGhostFieldRef.current = ghost?.fieldId ?? null;
    ids.forEach(fieldId => {
      if (fieldId === STATE_AFTER_FIELD_ID) return; // свой эффект высоты
      const ta = inputRefs.current[fieldId] as HTMLTextAreaElement | undefined;
      if (ta?.tagName === 'TEXTAREA') autoResize(ta);
    });
  }, [ghost]);

  // Вставка подсказки (целиком или первым словом) в позицию курсора.
  // Неявный отказ: подсказка была видна, а пользователь напечатал другое
  // (текст продлился, но не так, как предлагалось). Не считается отказом:
  // удаление текста, уход из поля, напечатанная вручную та же подсказка.
  const rejectedAiGhostRef = useRef<typeof aiGhost>(null);
  const visibleGhostRef = useRef<{ fieldId: string; textBefore: string; ghost: string; source: typeof aiGhost } | null>(null);
  useEffect(() => {
    const prev = visibleGhostRef.current;
    if (ghost && ghostContext) {
      if (!prev || prev.source !== aiGhost) {
        visibleGhostRef.current = { fieldId: ghost.fieldId, textBefore: ghostContext.textBefore, ghost: ghost.ghost, source: aiGhost };
      }
      return;
    }
    visibleGhostRef.current = null;
    if (!prev || !ghostContext || ghostContext.fieldId !== prev.fieldId) return;
    if (prev.source === acceptedAiGhostRef.current || prev.source === rejectedAiGhostRef.current) return;
    const now = ghostContext.textBefore.toLowerCase();
    const before = prev.textBefore.toLowerCase();
    if (now.length <= before.length || !now.startsWith(before)) return;
    if (now.startsWith(before + prev.ghost.toLowerCase().trimEnd())) return;
    if (prev.ghost.trim().length < 3) return;
    rejectedAiGhostRef.current = prev.source;
    phraseMemory.recordRejected(prev.fieldId, suggestedPhrase(prev.textBefore, prev.ghost));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghost, ghostContext]);

  // Подсказка (ответ модели) засчитывается принятой один раз — даже если
  // её принимали по слову несколькими нажатиями.
  const acceptedAiGhostRef = useRef<typeof aiGhost>(null);
  // После принятия продолжение запрашивается сразу, без паузы в наборе.
  // Окно по времени, а не флаг «один раз»: сразу после вставки браузер
  // переставляет курсор, эффект запроса перезапускается — флаг успевал
  // сброситься, и запрос уходил с обычной паузой.
  const justAcceptedAtRef = useRef(0);
  const acceptGhost = (wordOnly: boolean) => {
    if (!ghost) return;
    const { fieldId, pos } = ghost;
    justAcceptedAtRef.current = performance.now();
    if (aiGhost && acceptedAiGhostRef.current !== aiGhost) {
      acceptedAiGhostRef.current = aiGhost;
      phraseMemory.recordSuggestStat(fieldId, aiGhost.model, { accepted: 1 });
    }
    const insert = wordOnly ? firstWord(ghost.ghost) : ghost.ghost;
    const isStateAfter = fieldId === STATE_AFTER_FIELD_ID;
    const value: string = isStateAfter ? stateAfterText : (fieldsData[fieldId] || '');
    const newText = value.slice(0, pos) + insert + value.slice(pos);
    const newPos = pos + insert.length;

    if (isStateAfter) setStateAfterText(newText);
    else updateField(fieldId, newText);
    setCaret({ fieldId, pos: newPos });

    requestAnimationFrame(() => {
      const el = inputRefs.current[fieldId] as HTMLTextAreaElement | undefined;
      if (el) {
        el.setSelectionRange(newPos, newPos);
        // Высоту поля «Примечания» ведёт его собственный эффект (с анимацией).
        if (!isStateAfter) autoResize(el);
      }
    });
  };

  // Клавиши подсказки. true — событие обработано (дальше не передаём).
  // → — принять целиком, Ctrl/Alt+→ — одно слово (Tab занят переходом
  // между полями), Esc — скрыть подсказку для этого места.
  const handleGhostKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, fieldId: string): boolean => {
    if (!ghost || ghost.fieldId !== fieldId || e.nativeEvent.isComposing) return false;

    if (e.key === 'ArrowRight' && !e.shiftKey && !e.metaKey) {
      e.preventDefault();
      acceptGhost(e.ctrlKey || e.altKey);
      return true;
    }
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && ghostContext) {
      e.preventDefault();
      const { textBefore } = ghostContext;
      if (aiGhost) rejectedAiGhostRef.current = aiGhost;
      phraseMemory.recordRejected(fieldId, suggestedPhrase(textBefore, ghost.ghost));
      setDismissedGhosts(prev => ({ ...prev, [fieldId]: new Set([...(prev[fieldId] || []), textBefore]) }));
      return true;
    }
    return false;
  };

  // Поля, на которых учатся подсказки: текстовые и «Заключение» шаблона —
  // как он загружен (originalTemplate). Поля, добавленные прямо в этом
  // протоколе, одноразовые: их id не повторится, учиться на них
  // бессмысленно. По флагу isQuickText их не отличить — он остаётся и у
  // полей, которые потом сохранили в шаблон насовсем.
  const learnPhrasesFromReport = () => {
    if (!template || !originalTemplate) return;
    const templateFieldIds = new Set(originalTemplate.fields.map(f => f.id));
    phraseMemory.learnFromReport([
      ...template.fields
        .filter(f => (f.type === 'text' || f.type === 'conclusion') && templateFieldIds.has(f.id) && !deletedFieldIds.includes(f.id))
        .map(f => ({ id: f.id, text: typeof fieldsData[f.id] === 'string' ? fieldsData[f.id] : '' })),
      // «Примечание» — учится, только если оно включено в протокол.
      { id: STATE_AFTER_FIELD_ID, text: isStateAfterActive ? stateAfterText : '' },
    ]);
  };

  // Окно «Выученные фразы» — для текстового поля, где последним стоял
  // курсор (кнопка в нижней панели; в боковой панели поля она удлиняла
  // карточки). lastFocusedFieldElRef, а не activeFieldRef: тот сбрасывается
  // по таймеру после потери фокуса.
  const openPhraseMemory = () => {
    const fieldId = lastFocusedFieldElRef.current?.closest('[data-field-id]')?.getAttribute('data-field-id');
    const field = fieldId ? template?.fields.find(f => f.id === fieldId) : null;
    if (!field || (field.type !== 'text' && field.type !== 'conclusion')) {
      dialog.alert('Поставьте курсор в текстовое поле или «Заключение», чтобы посмотреть его выученные фразы');
      return;
    }
    setPhraseMemoryFieldId(field.id);
  };

  const startNewReportPhrases = () => {
    phraseMemory.startNewReport();
    setDismissedGhosts({});
    setAiGhost(null);
    setCorrections({});
  };

  // === ИИ-ПРОВЕРКА ПОЛЯ (опечатки, род/число/падеж) ===
  // Запускается сама после паузы в наборе (CORRECTION_IDLE_MS) в активном
  // текстовом поле / «Заключении». Ничего не заменяет: справа от строки
  // всплывает исправленный вариант с подсвеченными правками — Alt+Enter /
  // «Исправить» или Esc / «Не исправлять». Продолжили печатать — попап
  // исчезает (текст уже не тот, что проверяли) и после новой паузы
  // проверяется заново. Ответы кэшируются по тексту; отклонённая правка для
  // того же текста больше не предлагается.
  const correctionCacheRef = useRef<Map<string, string>>(new Map());
  const dismissedCorrectionsRef = useRef<Set<string>>(new Set());
  const correctionDisabledRef = useRef(false);

  const setCorrection = (fieldId: string, original: string, corrected: string) => {
    setCorrections(prev => {
      const next = { ...prev };
      if (corrected !== original && !dismissedCorrectionsRef.current.has(fieldId + '\u0000' + original)) {
        next[fieldId] = { original, corrected };
      } else {
        delete next[fieldId];
      }
      return next;
    });
  };

  const checkFieldGrammar = async (fieldId: string) => {
    if (correctionDisabledRef.current) return;
    const field = template?.fields.find(f => f.id === fieldId);
    if (!field || (field.type !== 'text' && field.type !== 'conclusion')) return;
    const text: string = typeof fieldsDataRef.current[fieldId] === 'string' ? fieldsDataRef.current[fieldId] : '';
    if (!text.trim()) return;

    const cached = correctionCacheRef.current.get(text);
    if (cached !== undefined) {
      setCorrection(fieldId, text, cached);
      return;
    }
    try {
      const res = await pb.send<{ corrected: string }>('/api/correct', {
        method: 'POST',
        body: { text, fieldLabel: field.label || (field.type === 'conclusion' ? 'Заключение' : '') },
      });
      const corrected = typeof res.corrected === 'string' ? res.corrected : text;
      correctionCacheRef.current.set(text, corrected);
      if (correctionCacheRef.current.size > 200) {
        correctionCacheRef.current.delete(correctionCacheRef.current.keys().next().value!);
      }
      setCorrection(fieldId, text, corrected);
    } catch (err: unknown) {
      if ((err as { status?: number })?.status === 503) correctionDisabledRef.current = true;
      else console.warn('[correct] проверка не выполнена:', err);
    }
  };

  // Пауза в наборе в активном поле → проверка. Любое изменение текста
  // перезапускает ожидание.
  const activeFieldText: string = activeFieldId && typeof fieldsData[activeFieldId] === 'string' ? fieldsData[activeFieldId] : '';
  useEffect(() => {
    if (!activeFieldId || !activeFieldText.trim()) return;
    const fieldId = activeFieldId;
    const timer = setTimeout(() => checkFieldGrammar(fieldId), CORRECTION_IDLE_MS);
    return () => clearTimeout(timer);
    // checkFieldGrammar читает актуальный текст из fieldsDataRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFieldId, activeFieldText]);

  // Попап — только у активной строки и только пока её текст тот же, что
  // проверяли (начали печатать — исчез).
  const visibleCorrection = (() => {
    if (!activeFieldId) return null;
    const c = corrections[activeFieldId];
    if (!c || (fieldsData[activeFieldId] || '') !== c.original) return null;
    return { fieldId: activeFieldId, ...c };
  })();

  // Клавиши попапа проверки. true — событие обработано.
  const handleCorrectionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, fieldId: string): boolean => {
    if (visibleCorrection?.fieldId !== fieldId || e.nativeEvent.isComposing) return false;
    if (e.key === 'Enter' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      applyCorrection(fieldId);
      return true;
    }
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      dismissCorrection(fieldId);
      return true;
    }
    return false;
  };

  const applyCorrection = (fieldId: string) => {
    const c = corrections[fieldId];
    if (!c || (fieldsData[fieldId] || '') !== c.original) return;
    updateField(fieldId, c.corrected);
    setCorrections(prev => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
    requestAnimationFrame(() => autoResize(inputRefs.current[fieldId] as HTMLTextAreaElement | null));
  };

  const dismissCorrection = (fieldId: string) => {
    const c = corrections[fieldId];
    if (c) dismissedCorrectionsRef.current.add(fieldId + '\u0000' + c.original);
    setCorrections(prev => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  };

  // Возврат фокуса в поле, которое было активно до открытия модалки
  // (Заметки / Сравнение / Примечание / ...). Модалки — не нативный
  // showModal(), поэтому браузер сам фокус не восстанавливает. Цель берётся
  // из lastFocusedFieldElRef (focusin, а не activeFieldRef: тот handleBlur
  // сбрасывает по таймеру, и при медленном клике по кнопке модалки он
  // успевал обнулиться ещё до открытия).
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      if (el instanceof HTMLElement && el.closest('[data-field-id], [data-header-id]')) {
        lastFocusedFieldElRef.current = el;
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  const modalFocusRestoreRef = useRef<HTMLElement | null>(null);
  const wasAnyModalOpenRef = useRef(false);
  useEffect(() => {
    if (anyModalOpen) {
      if (!wasAnyModalOpenRef.current) {
        wasAnyModalOpenRef.current = true;
        modalFocusRestoreRef.current = lastFocusedFieldElRef.current;
      }
      return;
    }
    if (!wasAnyModalOpenRef.current) return;
    wasAnyModalOpenRef.current = false;

    const target = modalFocusRestoreRef.current;
    modalFocusRestoreRef.current = null;
    // Не синхронно: модалка часто закрывается прямо в keydown (Enter), и
    // React выполняет этот эффект ещё внутри того же события — тогда
    // действие Enter по умолчанию (перевод строки) доставалось бы уже полю,
    // в которое вернули фокус. setTimeout — после завершения события.
    const timer = setTimeout(() => {
      if (target?.isConnected) target.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(timer);
  }, [anyModalOpen]);

    // Закрытие модалок по Escape (работает независимо от фокуса)
  useEffect(() => {
    if (!anyModalOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Esc уже обработан внутри окна (например, поле «Примечания» скрыло
      // ИИ-подсказку) — окно не закрываем.
      if (e.defaultPrevented) return;
      e.preventDefault();

      if (showComparisonModal) setShowComparisonModal(false);
      if (showStateAfterModal) setShowStateAfterModal(false);
      if (showAbbrModal) setShowAbbrModal(false);
      if (showNotesModal) setShowNotesModal(false);
      if (showSaveModal) setShowSaveModal(false);
      if (phraseMemoryFieldId !== null) setPhraseMemoryFieldId(null);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    anyModalOpen,
    showComparisonModal,
    showStateAfterModal,
    showAbbrModal,
    showNotesModal,
    showSaveModal,
    phraseMemoryFieldId,
  ]);
  
  useEffect(() => {
  if (!variantSelector) return;

  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    // Закрываем, если кликнули не по попапу
    if (!target.closest('.fixed')) {
      setVariantSelector(null);
      setSelectedVariantIndex(0);
    }
  };

  const handleBlur = () => {
    endTypingSession(); //
    // Закрываем при потере фокуса
    setTimeout(() => {
      setVariantSelector(null);
      setSelectedVariantIndex(0);
    }, 100);
  };

  document.addEventListener('mousedown', handleClickOutside);
  
  // Закрываем при потере фокуса активного поля
  const activeTextarea = inputRefs.current[variantSelector.fieldId];
  activeTextarea?.addEventListener('blur', handleBlur);

  return () => {
    document.removeEventListener('mousedown', handleClickOutside);
    activeTextarea?.removeEventListener('blur', handleBlur);
  };
}, [variantSelector]);


  useEffect(() => {
  if (!variantSelector) return;

  const handleGlobalKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    setVariantSelector(null);
    setSelectedVariantIndex(0);
    return;
  }

  if (e.key === 'Backspace') {
      e.preventDefault();
      setVariantSelector(null);
      setSelectedVariantIndex(0);
      return;
    }


  if (e.key === 'ArrowUp') {
    e.preventDefault();
    setSelectedVariantIndex(prev => Math.max(0, prev - 1));
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setSelectedVariantIndex(prev => 
      Math.min(variantSelector.variants.length - 1, prev + 1)
    );
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    selectVariant(selectedVariantIndex);
  }
};

  window.addEventListener('keydown', handleGlobalKeyDown);
  return () => window.removeEventListener('keydown', handleGlobalKeyDown);
}, [variantSelector, selectedVariantIndex]);

      // === FLIP-ЛОГИКА + ПРИЛИПАНИЕ ПОПАПА К ПОЛЮ ===
  useEffect(() => {
    if (!variantSelector) return;

    const updatePosition = () => {
      const textarea = inputRefs.current[variantSelector.fieldId] as HTMLTextAreaElement | undefined;
      if (!textarea) return;

      const rect = textarea.getBoundingClientRect();
      const popupHeight = 280; // приблизительная высота попапа (можно подкорректировать)

      const spaceBelow = window.innerHeight - rect.bottom;
      const shouldOpenAbove = spaceBelow < popupHeight;

      setVariantSelector(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          position: {
            top: shouldOpenAbove ? rect.top - 8 : rect.bottom + 4,
            left: rect.left,
          },
          isAbove: shouldOpenAbove,
        };
      });
    };

    updatePosition(); // сразу при открытии

    window.addEventListener('scroll', updatePosition, { passive: true });
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
    };
  }, [variantSelector?.fieldId]);


  // Применить «Примечание»: точка в конце, если её нет, — и в протокол.
  const applyStateAfter = () => {
    let text = stateAfterText.trim();
    if (!text) return;
    if (!/[.!?…]$/.test(text)) text += '.';
    setStateAfterText(text);
    setIsStateAfterActive(true);
    setShowStateAfterModal(false);
  };

  // Поле "Примечание" растёт вместе с текстом (от 3 строк до 240px, дальше
  // — прокрутка), и высота меняется плавно (transition на height): новая
  // высота задаётся явно в px от старой в px — из 'auto' CSS-переход не
  // анимирует. Окно модалки плавно тянется вслед за полем.
  useLayoutEffect(() => {
    const el = stateAfterTextareaRef.current;
    if (!el || !showStateAfterModal) return;
    const startHeight = el.offsetHeight;
    el.style.transition = 'none';
    el.style.height = 'auto';
    const minHeight = el.offsetHeight; // высота по rows={3}
    const border = el.offsetHeight - el.clientHeight;
    // ИИ-подсказка может переноситься на строки ниже текста — поле растёт и под неё.
    const ghostOverlay = el.parentElement?.querySelector<HTMLElement>('[data-ghost-overlay]');
    const content = Math.max(el.scrollHeight + border, ghostOverlay?.offsetHeight ?? 0);
    const target = Math.min(240, Math.max(minHeight, content));
    el.style.height = `${startHeight}px`;
    void el.offsetHeight; // зафиксировать стартовую высоту перед переходом
    el.style.transition = '';
    el.style.height = `${target}px`;
    el.style.overflowY = el.scrollHeight + border > 240 ? 'auto' : 'hidden';
  }, [stateAfterText, showStateAfterModal, ghost]);

    const notesLinks = useMemo(() => {
    if (!template?.fields) return [];
    const links: { text: string; url: string }[] = [];

    for (const f of template.fields) {
      if (f.type !== 'notes' || !f.notes) continue;
      if (deletedFieldIds.includes(f.id)) continue;

      f.notes.split('\n').filter(Boolean).forEach((line: string) => {
        const match = line.match(/\[(.*?)\]\((.*?)\)/);
        if (match) {
          links.push({ text: match[1], url: match[2] });
        }
      });
    }
    return links;
  }, [template, deletedFieldIds]);

  const filteredAbbreviations = Object.entries(abbreviations)
    .filter(([abbr, info]) => {
      const matchesSearch = !searchTerm || abbr.toLowerCase().includes(searchTerm.toLowerCase()) || info.full.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === 'Все' || info.category === selectedCategory;
      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => (b[1].usage || 0) - (a[1].usage || 0));

        useEffect(() => {
  if (!id) return;
  setLoading(true);
  setToastMessage(null);




  const loadTemplate = async () => {
    try {
      const record = await pb.collection('templates').getOne(id as string, { 
        $autoCancel: false 
      });

      // Проверка доступа
      const ownerId = typeof record.user === 'string' ? record.user : record.user?.id || '';
      if (ownerId !== pb.authStore.record?.id && !record.isPublic) {
        await dialog.alert('У вас нет доступа к этому шаблону');
        router.push('/');
        return;
      }
      
      // Миграция quickButtons: старый формат (subgroups) → новый (phrases);
      // поля «Число» / «Чекбокс» / «Шкала» → текстовые (lib/migrateFieldTypes.ts).
      // Исходные поля старых типов запоминаем — для значений из черновика.
      const legacyFields = new Map<string, BuilderField>();
if (Array.isArray(record.fields)) {
  record.fields = record.fields.map((f: BuilderField) => {
    if (isLegacyFieldType(f.type)) legacyFields.set(f.id, f);
    return migrateLegacyField({
      ...f,
      quickButtons: migrateQuickButtons(f.quickButtons),
    });
  });
}

      const typedRecord = record as unknown as Template;
      setOriginalTemplate(JSON.parse(JSON.stringify(typedRecord)));
      setTemplate(typedRecord);

    

      // Инициализируем все разделы как свёрнутые (по умолчанию при загрузке страницы)
initializeCollapsedState(record.fields);

      // === УМНАЯ ИНИЦИАЛИЗАЦИЯ + ВОССТАНОВЛЕНИЕ ЧЕРНОВИКА ===
      const draft = loadDraft(id as string);

      setFieldsData(prev => {
        const newData: Record<string, any> = { ...(draft?.fieldsData || prev) };

        record.fields.forEach((f: BuilderField) => {
          // Инициализируем только новые поля
          if (newData[f.id] === undefined) {
            if (f.defaultValue !== undefined) newData[f.id] = f.defaultValue;
            else if (f.type === 'checkbox') newData[f.id] = false;
            else if (f.type === 'rating') newData[f.id] = 0;
            else newData[f.id] = '';
          }
        });

        // Значения полей старых типов из черновика (true/false, число) — в текст.
        legacyFields.forEach((original, fieldId) => {
          if (newData[fieldId] !== undefined) newData[fieldId] = convertLegacyValue(original, newData[fieldId]);
        });

        // Удаляем данные удалённых полей. Составные ключи поля (переменные
        // формулы `${id}_var_${i}`, комментарий `${id}_comment`) — тоже его:
        // раньше они удалялись, и после перезагрузки формулы пустели.
        const currentIds = new Set(record.fields.map((f: BuilderField) => f.id));
        Object.keys(newData).forEach(key => {
          const ownerId = key.replace(/_(var_\d+|comment)$/, '');
          if (!currentIds.has(key) && !currentIds.has(ownerId)) delete newData[key];
        });

        return newData;
      });

            // Восстанавливаем удалённые поля из черновика
            if (draft?.deletedFieldIds) {
        setDeletedFieldIds(draft.deletedFieldIds);
      }

      if (draft) {
        if (typeof draft.isComparisonActive === 'boolean') {
          setIsComparisonActive(draft.isComparisonActive);
        }
        if (Array.isArray(draft.comparisonDates)) {
          setComparisonDates(draft.comparisonDates);
        } else if (typeof draft.comparisonDate === 'string' && draft.comparisonDate) {
          setComparisonDates([draft.comparisonDate]);
        }
        if (typeof draft.isMultipleComparison === 'boolean') {
          setIsMultipleComparison(draft.isMultipleComparison);
        }
        if (typeof draft.isStateAfterActive === 'boolean') {
          setIsStateAfterActive(draft.isStateAfterActive);
        }
        if (typeof draft.stateAfterText === 'string') {
          setStateAfterText(draft.stateAfterText);
        }

        showToast('Шаблон восстановлен', 3800);
      }

    } catch (err) {
      console.error("Ошибка загрузки шаблона:", err);
      await dialog.alert("Шаблон не найден или у вас нет доступа");
      router.push('/');
    } finally {
      setLoading(false);
    }
  };

  loadTemplate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [id]);

  useEffect(() => {
    if (template && Object.keys(fieldsData).length > 0 && !initialized) {
      const firstField = template.fields.find((f: BuilderField) => f.type !== 'header');
      if (firstField) {
        setTimeout(() => {
          const input = inputRefs.current[firstField.id];
          if (input) {
            input.focus();
            setActiveFieldId(firstField.id);
            activeFieldRef.current = firstField.id;
          }
        }, 100);
      }
      setInitialized(true);
    }
  }, [template, fieldsData, initialized]);

  useEffect(() => {
    if (!template || Object.keys(fieldsData).length === 0) return;

    const timer = setTimeout(() => {
      Object.entries(inputRefs.current).forEach(([id, el]) => {
        if (el && el.tagName === 'TEXTAREA') {
          autoResize(el as HTMLTextAreaElement);
        }
      });
    }, 80);

    return () => clearTimeout(timer);
  }, [fieldsData, template]);

  useEffect(() => {
  if (!template) return;

  const newData = { ...fieldsData };
  let changed = false;

  template.fields.forEach((f: BuilderField) => {
    if (f.type === 'formula' && f.formula && f.variables) {
      try {
        // Проверяем, все ли переменные заполнены
        const allFilled = f.variables.every((v, i: number) => {
          const val = fieldsData[`${f.id}_var_${i}`] || v.value || '';
          return String(val).trim() !== '';
        });

        if (!allFilled) {
          if (newData[f.id] !== '') {
            newData[f.id] = '';
            changed = true;
          }
          return;
        }

        const varMap: Record<string, number> = Object.fromEntries(
          f.variables.map((v, i: number) => {
            const raw = fieldsData[`${f.id}_var_${i}`] || v.value || '';
            return [v.name, parseFloat(raw) || 0];
          })
        );

        const result = evaluateFormula(f.formula, varMap);

        const finalResult = Number.isNaN(result) ? '' : Number(result).toFixed(2);

        if (newData[f.id] !== finalResult) {
          newData[f.id] = finalResult;
          changed = true;
        }
      } catch {
        if (newData[f.id] !== '') {
          newData[f.id] = '';
          changed = true;
        }
      }
    }
  });

  if (changed) setFieldsData(newData);
}, [fieldsData, template]);

      // ====================== ГЕНЕРАЦИЯ ОТЧЁТА (useMemo) ======================
  // Готовый протокол — только для копирования/сохранения (карточки с
  // превью на странице больше нет); HTML-вариант generateReport не нужен.
  const { finalPlainText } = useMemo(
    () => generateReport({
      template,
      fieldsData,
      deletedFieldIds,
      isComparisonActive,
      comparisonDates,
      isStateAfterActive,
      stateAfterText,
      uppercaseLabels: labelsUppercase,
    }),
    [
      fieldsData,
      template,
      deletedFieldIds,
      isComparisonActive,
      comparisonDates,
      isStateAfterActive,
      stateAfterText,
      labelsUppercase,
    ]
  );

  // Уже заполненные пользователем поля протокола (кроме fieldId) — контекст
  // для ИИ-подсказки. Только введённые значения: нормы-placeholder'ы в
  // пустых полях модель только запутали бы.
  const reportContextFor = (fieldId: string): string => {
    if (!template) return '';
    const lines: string[] = [];
    for (const f of template.fields) {
      if (f.id === fieldId || deletedFieldIds.includes(f.id)) continue;
      const v = fieldsData[f.id];
      const label = f.label || '';
      if ((f.type === 'text' || f.type === 'conclusion' || f.type === 'select') && typeof v === 'string' && v.trim()) {
        lines.push(`${label}: ${v.trim()}`);
      } else if (f.type === 'number' && v !== undefined && v !== null && String(v).trim()) {
        lines.push(`${label}: ${v}${f.unit ? ' ' + f.unit : ''}`);
      } else if (f.type === 'checkbox' && v === true && f.checkedPhrase) {
        lines.push(`${label}: ${f.checkedPhrase}`);
      }
    }
    return lines.join('\n');
  };

  // Запрос подсказки у модели: после паузы в наборе (AI_SUGGEST_DELAY_MS),
  // с кэшем по «поле + текст до курсора» и отбрасыванием устаревших ответов.
  // 503 (ключ не настроен на сервере) — выключаем подсказки до перезагрузки.
  const aiCacheRef = useRef<Map<string, { ghost: string; model: string }>>(new Map());
  const aiRequestSeqRef = useRef(0);
  const aiDisabledRef = useRef(false);
  useEffect(() => {
    const immediate = performance.now() - justAcceptedAtRef.current < 300;
    if (!ghostContext || aiDisabledRef.current || ghost) return;
    const { field, fieldId, textBefore } = ghostContext;

    const cacheKey = fieldId + '\u0000' + textBefore;
    const cached = aiCacheRef.current.get(cacheKey);
    if (cached !== undefined) {
      setAiGhost({ fieldId, textBefore, ...cached });
      if (cached.ghost) phraseMemory.recordSuggestStat(fieldId, cached.model, { shown: 1 });
      return;
    }

    const seq = ++aiRequestSeqRef.current;
    const timer = setTimeout(async () => {
      justAcceptedAtRef.current = 0;
      // Контекст для персонализации: фразы пользователя, отобранные под
      // набранный текст; последние целые тексты поля; заготовки шаблона.
      // Норма (placeholder) — всегда. Фразы быстрых кнопок — только пока у
      // поля мало выученных фраз (холодный старт): потом это дублирование —
      // кнопки быстрее вставить хоткеем, чем ждать их в подсказке, а те,
      // что пользователь реально вставляет, и так попадают в память фраз.
      const isColdStart = Object.keys(phraseMemory.memory[fieldId] || {}).length < COLD_START_PHRASES;
      const vocabulary = [
        ...(field.placeholder ? [field.placeholder] : []),
        ...(isColdStart
          ? selectVocabulary((field.quickButtons || []).flatMap(g => g.phrases || []).filter(Boolean), textBefore, 15)
          : []),
      ];
      const startedAt = performance.now();
      try {
        const res = await pb.send<{ text: string; model?: string }>('/api/suggest', {
          method: 'POST',
          body: {
            textBefore,
            fieldLabel: field.label || '',
            templateTitle: template?.title || '',
            isConclusion: field.type === 'conclusion',
            examples: selectExamples(phraseMemory.memory[fieldId], textBefore, 30),
            recent: (phraseMemory.recent[fieldId] || []).slice(0, 6),
            vocabulary,
            avoid: (phraseMemory.rejected[fieldId] || []).slice(0, 10),
            // «Заключению» нужен весь протокол (findings), остальным — уже
            // заполненные соседние поля, чтобы им не противоречить.
            context: field.type === 'conclusion' ? '' : reportContextFor(fieldId),
            findings: field.type === 'conclusion' ? finalPlainText : '',
          },
        });
        const model = res.model || 'unknown';
        const ghostText = toGhost(textBefore, res.text || '');
        aiCacheRef.current.set(cacheKey, { ghost: ghostText, model });
        if (aiCacheRef.current.size > 300) {
          aiCacheRef.current.delete(aiCacheRef.current.keys().next().value!);
        }
        const isCurrent = seq === aiRequestSeqRef.current;
        phraseMemory.recordSuggestStat(fieldId, model, {
          requests: 1,
          ms: Math.round(performance.now() - startedAt),
          shown: isCurrent && ghostText ? 1 : 0,
        });
        if (isCurrent) setAiGhost({ fieldId, textBefore, ghost: ghostText, model });
      } catch (err: unknown) {
        if ((err as { status?: number })?.status === 503) aiDisabledRef.current = true;
        else console.warn('[suggest] подсказка не получена:', err);
      }
    }, immediate ? 0 : AI_SUGGEST_DELAY_MS);

    return () => clearTimeout(timer);
    // phraseMemory.memory/finalPlainText читаются в момент запроса, но
    // перезапускать ожидание из-за их изменения не нужно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghostContext, ghost === null]);

  const updateField = (
  fieldId: string,
  value: any,
  options?: { groupTyping?: boolean }
) => {
  const groupTyping = options?.groupTyping === true;

  if (groupTyping) {
    if (!typingSessionRef.current) {
      saveToHistory();
      typingSessionRef.current = true;
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      typingSessionRef.current = false;
      typingTimerRef.current = null;
    }, 600);
  } else {
    endTypingSession();
    saveToHistory();
  }

    setFieldsData(prev => {
    const next = { ...prev, [fieldId]: value };
    fieldsDataRef.current = next;
    return next;
  });
};

          const handleFocus = (fieldId: string, el: HTMLElement | null) => {
    let mainId = fieldId;
    if (fieldId.includes('_')) {
      mainId = fieldId.split('_')[0];
    }

    setActiveFieldId(mainId);
    activeFieldRef.current = mainId;
    activeInputRef.current = el;

    // Сворачиваем все разделы, кроме активного
    if (template) {
      const allHeaderIds: string[] = [];
      let currentHeader: string | null = null;
      let found = false;

      for (const f of template.fields) {
        if (deletedFieldIds.includes(f.id)) continue;

        if (f.type === 'header') {
          allHeaderIds.push(f.id);
          if (!found) currentHeader = f.id;
        } else if (f.id === mainId) {
          found = true;
        }
      }

      if (currentHeader && found) {
        setSkipSectionTransition(true);
        setCollapsedHeaders(new Set(allHeaderIds.filter(id => id !== currentHeader)));
      }
    }   // ← эта скобка должна быть
  };

const handleBlur = () => {
  setTimeout(() => {
    // Проверяем, где сейчас фокус
    const currentElement = document.activeElement;

    if (currentElement && activeFieldRef.current) {
      // Если фокус всё ещё внутри той же карточки — не сбрасываем подсветку
      const isSameCard = 
        currentElement.closest && 
        currentElement.closest(`[data-field-id="${activeFieldRef.current}"]`);

      if (isSameCard) {
        return;
      }
    }

    // Если фокус ушёл совсем за пределы карточки — сбрасываем
    setActiveFieldId(null);
    activeFieldRef.current = null;
    activeInputRef.current = null;
  }, 180); // увеличил задержку
};

// Клик по-настоящему "пустому" месту (не по интерактивному элементу) не
// должен снимать фокус с активного поля — иначе, например, чтобы просто
// закрыть кликом открытый dropdown кнопок патологий, приходится потом
// кликать по полю заново, чтобы продолжить печатать. Клик по другому полю,
// кнопке или ссылке по-прежнему переключает фокус как обычно — здесь
// глушится только "промах" по фону/пустоте.
useEffect(() => {
  const handleGlobalMouseDown = (e: MouseEvent) => {
    if (!activeFieldRef.current) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, button, a, [role="button"], [contenteditable="true"]')) {
      return;
    }
    e.preventDefault();
  };
  window.addEventListener('mousedown', handleGlobalMouseDown);
  return () => window.removeEventListener('mousedown', handleGlobalMouseDown);
}, []);

      useEffect(() => {
    if (!activeFieldId) return;

    const raf = requestAnimationFrame(() => {
      const el =
        inputRefs.current[activeFieldId] ||
        (document.querySelector(`[data-field-id="${activeFieldId}"]`) as HTMLElement | null);

      // Пока прокруткой управляет glideHeaderIntoPlace (клик по заголовку
      // раздела), не вмешиваемся: иначе эффект срабатывал дважды — сразу
      // при смене collapsedHeaders (ехал к старому, схлопывающемуся полю) и
      // в конце, при фокусе первого поля нового раздела (центрировал его и
      // стягивал только что доведённый наверх заголовок обратно вниз).
      if (el && performance.now() >= manualScrollUntilRef.current) {
        el.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }

      // возвращаем анимацию разделов после скролла
      setTimeout(() => setSkipSectionTransition(false), 50);
    });

    return () => cancelAnimationFrame(raf);
  }, [activeFieldId, collapsedHeaders]);

useEffect(() => {
    setPathNav(null);
    setOpenQuickButtonGroupIdx(null);
  }, [activeFieldId]);

  const handleInputChange = (fieldId: string, value: string) => {
  updateField(fieldId, value, { groupTyping: true });
};

// Поле «Заключение» шаблона (первое, если их несколько) — в нём фраза
// быстрой кнопки в начале поля пишется с заглавной (см. insertPhrase).
const conclusionField = useMemo(
  () => template?.fields.find(f => f.type === 'conclusion' && !deletedFieldIds.includes(f.id)) || null,
  [template, deletedFieldIds]
);

// Находки — поля, которые пользователь изменил: значение отличается от
// исходного (defaultValue шаблона или пустого). Показываются попапом, пока
// курсор в «Заключении», — чтобы составлять его, глядя на находки.
// Нормы-placeholder в находки не попадают: их не трогали. Группируются по
// разделам (заголовкам), в порядке полей шаблона.
type Finding = { id: string; section: string; label: string; value: string };
const findings: Finding[] = useMemo(() => {
  if (!template) return [];
  const original = new Map((originalTemplate?.fields || []).map(f => [f.id, f]));
  const initial = (f: BuilderField) =>
    original.get(f.id)?.defaultValue ?? (f.type === 'checkbox' ? false : f.type === 'rating' ? 0 : '');
  const result: Finding[] = [];
  let section = '';
  for (const f of template.fields) {
    if (deletedFieldIds.includes(f.id)) continue;
    if (f.type === 'header') { section = f.label || ''; continue; }
    if (f.type === 'conclusion' || f.type === 'notes') continue;
    const v = fieldsData[f.id];
    let value = '';
    if (f.type === 'text' || f.type === 'select') {
      if (typeof v === 'string' && v.trim() && v !== initial(f)) {
        value = v.trim();
        if (f.unit && !value.endsWith(f.unit)) value += ` ${f.unit}`;
      }
    } else if (f.type === 'number') {
      if (v !== undefined && v !== null && String(v).trim() && v !== initial(f)) value = `${v}${f.unit ? ' ' + f.unit : ''}`;
    } else if (f.type === 'checkbox') {
      if (!!v !== !!initial(f)) value = v ? (f.checkedPhrase || 'Да') : (f.uncheckedPhrase || 'Нет');
    } else if (f.type === 'rating') {
      if (v && v !== initial(f)) {
        const expl = f.showExplanations && f.explanations ? f.explanations[v - 1] : '';
        value = expl ? `${v} — ${expl}` : String(v);
      }
    } else if (f.type === 'formula') {
      const anyVar = (f.variables || []).some((_x, i) => String(fieldsData[`${f.id}_var_${i}`] ?? '').trim());
      const comment = String(fieldsData[formulaCommentKey(f.id)] ?? '').trim();
      if (anyVar && v && v !== 'NaN') value = `${v}${f.unit ? ' ' + f.unit : ''}${comment ? ` (${comment})` : ''}`;
    }
    if (value) result.push({ id: f.id, section, label: f.label || '', value });
  }
  return result;
}, [template, originalTemplate, fieldsData, deletedFieldIds]);

// Горячие клавиши: Alt+C / Alt+P — переключить "Сравнение" / "Примечание"
// (та же логика, что в onClick этих кнопок). Слушатель на window, а не на
// конкретном элементе — они не привязаны к какому-то одному полю.
useEffect(() => {
  const handleGlobalKeyDown = (e: KeyboardEvent) => {

    // e.code (физическая позиция клавиши), а не e.key — на macOS Option
    // подменяет символ (Option+C -> "ç", Option+P -> "π" на US-раскладке),
    // из-за чего e.key.toLowerCase() === 'c' никогда не сработает при
    // зажатом Option, хотя e.altKey для Option на Mac уже верно = true.
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyC') {
      e.preventDefault();
      if (isComparisonActive) {
        setIsComparisonActive(false);
      } else {
        if (comparisonDates.length === 0) setComparisonDates(['']);
        if (comparisonDates.length > 1) setIsMultipleComparison(true);
        setShowComparisonModal(true);
      }
      return;
    }

    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyP') {
      e.preventDefault();
      if (isStateAfterActive) {
        setIsStateAfterActive(false);
      } else {
        setShowStateAfterModal(true);
      }
    }
  };

  window.addEventListener('keydown', handleGlobalKeyDown);
  return () => window.removeEventListener('keydown', handleGlobalKeyDown);
}, [template, isComparisonActive, comparisonDates, isStateAfterActive]);

// Плавная прокрутка списка фраз быстрых кнопок: на каждом кадре проходим
// долю оставшегося пути до цели. Если цель сдвигается во время анимации
// (следующее нажатие стрелки), цикл не перезапускается — просто догоняет
// новую цель, поэтому при зажатой стрелке движение остаётся непрерывным.
const phraseScrollAnimRef = useRef<{ el: HTMLElement; target: number; raf: number } | null>(null);

// Было ли последнее событие mousemove настоящим движением курсора, а не
// синтетическим (Chrome шлёт mousemove без движения мыши, когда под
// курсором прокручивается или появляется контент) — см. onMouseMove у ряда
// быстрых кнопок. Слушатель в фазе захвата на window срабатывает раньше
// обработчиков React, поэтому флаг всегда актуален для текущего события.
const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);
const mouseMoveIsRealRef = useRef(false);
useEffect(() => {
  const onMove = (e: MouseEvent) => {
    const last = lastMousePosRef.current;
    mouseMoveIsRealRef.current = !!last && (last.x !== e.screenX || last.y !== e.screenY);
    lastMousePosRef.current = { x: e.screenX, y: e.screenY };
  };
  window.addEventListener('mousemove', onMove, true);
  return () => window.removeEventListener('mousemove', onMove, true);
}, []);

const smoothScrollPhraseList = (el: HTMLElement, target: number) => {
  const anim = phraseScrollAnimRef.current;
  if (anim && anim.el === el) {
    anim.target = target;
    return;
  }
  if (anim) cancelAnimationFrame(anim.raf);
  if (Math.abs(el.scrollTop - target) < 1) {
    phraseScrollAnimRef.current = null;
    return;
  }

  const step = () => {
    const a = phraseScrollAnimRef.current;
    if (!a) return;
    const diff = a.target - a.el.scrollTop;
    if (Math.abs(diff) < 1 || !a.el.isConnected) {
      if (a.el.isConnected) a.el.scrollTop = a.target;
      phraseScrollAnimRef.current = null;
      return;
    }
    // Не меньше 1px за кадр: scrollTop округляется, и на последних
    // пикселях доля пути могла бы округляться в ноль — цикл бы завис.
    const move = diff * 0.3;
    a.el.scrollTop += Math.abs(move) < 1 ? Math.sign(diff) : move;
    a.raf = requestAnimationFrame(step);
  };
  phraseScrollAnimRef.current = { el, target, raf: requestAnimationFrame(step) };
};

// Автоскролл выбранной фразы при навигации стрелками. useLayoutEffect, а
// не useEffect + requestAnimationFrame: DOM с новой подсветкой уже
// закоммичен, и прокрутка применяется в том же кадре — без отставания на
// кадр (и без "залипания", когда rAF троттлится в неактивной вкладке).
useLayoutEffect(() => {
  if (!pathNav) return;

  const el = document.querySelector(
    `[data-path-group="${pathNav.groupIdx}"][data-path-phrase="${pathNav.phraseIdx}"]`
  ) as HTMLElement | null;
  if (!el) return;
  // Прокручиваем только сам контейнер списка: scrollIntoView двигал ещё и
  // страницу (список лежит в sticky-панели внизу), а behavior: 'smooth' при
  // зажатой стрелке каждый раз обрывал предыдущую анимацию — прокрутка
  // отставала от подсветки и дёргалась. Поэтому своя плавная прокрутка
  // (smoothScrollPhraseList): новое нажатие не перезапускает анимацию, а
  // лишь сдвигает её цель, и текущее движение просто её догоняет.
  const container = el.closest('.overflow-y-auto') as HTMLElement | null;
  if (!container) return;
  const maxScroll = container.scrollHeight - container.clientHeight;
  // Крайние фразы — до упора, чтобы был виден и вертикальный padding списка.
  if (!el.closest('li')?.previousElementSibling) {
    smoothScrollPhraseList(container, 0);
    return;
  }
  if (!el.closest('li')?.nextElementSibling) {
    smoothScrollPhraseList(container, maxScroll);
    return;
  }
  // Считаем от ЦЕЛЕВОЙ прокрутки (если анимация ещё идёт), а не от текущей:
  // иначе при быстрых нажатиях каждое новое вычисление опиралось бы на
  // недокрученное положение, и выделенная фраза уезжала бы за край.
  const anim = phraseScrollAnimRef.current;
  const base = anim && anim.el === container ? anim.target : container.scrollTop;
  const itemRect = el.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const itemTop = itemRect.top - containerRect.top + container.scrollTop;
  const itemBottom = itemTop + itemRect.height;
  let target = base;
  if (itemTop < base) {
    target = itemTop;
  } else if (itemBottom > base + container.clientHeight) {
    target = itemBottom - container.clientHeight;
  }
  smoothScrollPhraseList(container, Math.max(0, Math.min(maxScroll, target)));
}, [pathNav]);

// Клик вне раскрытой кликом группы кнопок патологий закрывает её —
// у dropdown больше нет hover, так что кроме повторного клика по самой
// группе это единственный способ её закрыть мышью.
useEffect(() => {
  if (openQuickButtonGroupIdx === null) return;

  const handleClickOutside = (e: MouseEvent) => {
    const el = quickButtonGroupRefs.current[openQuickButtonGroupIdx];
    if (el && !el.contains(e.target as Node)) {
      setOpenQuickButtonGroupIdx(null);
    }
  };

  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, [openQuickButtonGroupIdx]);

const insertPhrase = (phrase: string) => {
  const fieldId = activeFieldRef.current;
  if (!fieldId) {
    dialog.alert('Поставьте курсор в нужное текстовое поле слева');
    return;
  }


  const inputEl = inputRefs.current[fieldId] as HTMLTextAreaElement | undefined;
  if (!inputEl) return;

  const start = inputEl.selectionStart ?? 0;
  const end = inputEl.selectionEnd ?? start;
  const current = inputEl.value || '';

  const before = current.substring(0, start);
  const after = current.substring(end);

  // Убираем пробелы в конце, чтобы понять последний значимый символ
  const trimmedBefore = before.replace(/\s+$/, '');
  const lastChar = trimmedBefore.slice(-1);

  let finalPhrase = phrase;
  let prefix = '';

  if (lastChar === '.' || lastChar === '!' || lastChar === '?') {
    // После точки / ! / ? — с большой буквы
    finalPhrase = phrase.charAt(0).toUpperCase() + phrase.slice(1);
    prefix = before.endsWith(' ') ? '' : ' ';
  } else if (lastChar === ',') {
    // После запятой — с маленькой буквы
    finalPhrase = phrase.charAt(0).toLowerCase() + phrase.slice(1);
    prefix = before.endsWith(' ') ? '' : ' ';
  } else if (before.length === 0 || trimmedBefore.length === 0) {
    // Начало поля — обычно с маленькой буквы, без пробела (после метки
    // "Название поля:" в готовом протоколе фраза идёт как продолжение
    // предложения). Только для "Заключения" первая фраза — начало
    // самостоятельного предложения, поэтому с большой буквы; во всех
    // остальных текстовых полях поведение не меняется.
    finalPhrase = fieldId === conclusionField?.id
      ? phrase.charAt(0).toUpperCase() + phrase.slice(1)
      : phrase.charAt(0).toLowerCase() + phrase.slice(1);
    prefix = '';
  } else {
    // Обычный случай — оставляем регистр как в шаблоне,
    // пробел добавляем только если его ещё нет
    prefix = before.endsWith(' ') || before.length === 0 ? '' : ' ';
  }

  const newText = before + prefix + finalPhrase + after;
  const newCursorPos = start + prefix.length + finalPhrase.length;

  
  updateField(fieldId, newText);

  requestAnimationFrame(() => {
    const el = inputRefs.current[fieldId] as HTMLTextAreaElement | undefined;
    if (el) {
      el.focus();
      el.setSelectionRange(newCursorPos, newCursorPos);
      autoResize(el);
      setTimeout(() => autoResize(el), 10);
    }
  });
};

const resetTextareaHeights = (values?: Record<string, unknown>) => {
  // Баг воспроизводился ТОЛЬКО когда курсор оставался внутри textarea в
  // момент сброса. Причина — internal scrollTop поля: пока курсор был
  // где-то в середине длинного многострочного текста, браузер прокручивал
  // видимую область textarea вниз, к каретке. Значение (value) после
  // сброса React меняет на пустое корректно, но САМ scrollTop фокусного
  // поля браузер не обнуляет автоматически — он остаётся там же, где был.
  // В итоге видимая область поля указывает "в пустоту" ниже настоящего
  // содержимого (которого уже нет), а placeholder, который рисуется от
  // scrollTop=0, оказывается выше этой видимой области и не виден — именно
  // это и выглядело как "пустые строки без placeholder". У полей без
  // фокуса эта проблема не проявлялась, потому что там либо не было
  // прокрутки, либо браузер сам возвращал её при следующем фокусе.
  //
  // Явно выставляем value (на случай, если React ещё не успел применить
  // его к этому DOM-узлу) и, что здесь главное, scrollTop = 0.
  Object.entries(inputRefs.current).forEach(([fieldId, el]) => {
    if (el && el.tagName === 'TEXTAREA') {
      const ta = el as HTMLTextAreaElement;
      if (values && fieldId in values) {
        const target = values[fieldId];
        ta.value = typeof target === 'string' ? target : '';
      }
      ta.style.height = '';
      ta.scrollTop = 0;
    }
  });
};

const parseVariants = (text: string): { prefix: string; variants: string[] } | null => {
  const match = text.match(/^(.*)\{([^}]+)\}$/);
  if (!match) return null;

  const prefix = match[1];
  const variants = match[2].split('|').map(v => v.trim()).filter(Boolean);
  
  return variants.length > 1 ? { prefix, variants } : null;
};

const selectVariant = (index: number) => {
  if (!variantSelector) return;

  const { fieldId, variants, prefix, trigger, abbrKey} = variantSelector;
  const chosen = variants[index];

// === ЧУВСТВИТЕЛЬНОСТЬ К РЕГИСТРУ (не ломает ничего) ===
let finalChosen = chosen;
if (variantSelector?.originalWord) {
  const firstChar = variantSelector.originalWord[0];
  const isCapitalized = firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase();

  if (isCapitalized) {
    finalChosen = chosen.charAt(0).toUpperCase() + chosen.slice(1);
  } else {
    finalChosen = chosen.charAt(0).toLowerCase() + chosen.slice(1);
  }
}

const textarea = inputRefs.current[fieldId] as HTMLTextAreaElement | undefined;
if (!textarea) return;
const currentValue = textarea.value;
const newText = prefix + finalChosen + trigger + currentValue.substring(variantSelector.startPos);

  
  updateField(fieldId, newText);

  if (abbrKey) {
    recordUsage(abbrKey);
  }

  const newCursorPos = prefix.length + chosen.length + 1;

  requestAnimationFrame(() => {
    const el = inputRefs.current[fieldId] as HTMLTextAreaElement | undefined;
    if (el) {
      el.focus();
      el.setSelectionRange(newCursorPos, newCursorPos);
      autoResize(el);
    }
  });

  setVariantSelector(null);
  setSelectedVariantIndex(0);
};

const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, fieldId: string) => {
  if (variantSelector && e.key.length === 1) {
    setVariantSelector(null);
    setSelectedVariantIndex(0);
  }
  const triggerChars = [' ', '.', ',', ';', ':'];
  if (!triggerChars.includes(e.key)) return;

  const inputEl = e.currentTarget;
  const cursorPos = inputEl.selectionStart ?? 0;
  const value = inputEl.value;

  const textBeforeCursor = value.substring(0, cursorPos);
  const match = textBeforeCursor.match(/(\S+)$/);
  if (!match) return;

  const originalWord = match[1];
  const wordLower = originalWord.toLowerCase();
  const abbrInfo = abbreviations[wordLower];
  if (!abbrInfo) return;

  e.preventDefault();

  const beforeWord = textBeforeCursor.substring(0, match.index ?? 0);

  // === Проверяем, есть ли варианты в аббревиатуре ===
  const parsed = parseVariants(abbrInfo.full);

  if (parsed) {
  const textareaEl = inputRefs.current[fieldId] as HTMLTextAreaElement | undefined;
  const rect = textareaEl?.getBoundingClientRect();

  setVariantSelector({
    fieldId,
    variants: parsed.variants,
    prefix: beforeWord + parsed.prefix,
    trigger: e.key,
    startPos: cursorPos,
    position: {
      top: rect ? rect.bottom + 4 : 200,
      left: rect ? rect.left : 100,
    },
    abbrKey: wordLower,
    originalWord: originalWord,
  });
  setSelectedVariantIndex(0);
  return;
}

  // === Обычная вставка (без вариантов) ===
  let replacement = abbrInfo.full;

  // Сохранение регистра
  if (originalWord[0] === originalWord[0].toUpperCase()) {
    replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }

  const newText = beforeWord + replacement + e.key + value.substring(cursorPos);
  const newCursorPos = beforeWord.length + replacement.length + 1;

  
  updateField(fieldId, newText);

  recordUsage(wordLower);

  requestAnimationFrame(() => {
    const el = inputRefs.current[fieldId] as HTMLTextAreaElement | undefined;
    if (el) {
      el.focus();
      el.setSelectionRange(newCursorPos, newCursorPos);
      autoResize(el);
    }
  });
};

  const copyToClipboard = () => {
    learnPhrasesFromReport();
    navigator.clipboard.writeText(finalPlainText).then(
      () => showToast('Скопировано', 1300),
      () => showToast('Не удалось скопировать', 1300)
    );
  };

  const downloadTxt = () => setShowSaveModal(true);

  const handleSaveWithInfo = () => {
    const nameParts = [
      fullName.trim().replace(/[^a-zA-Zа-яА-Я0-9]/g, '_'),
      birthDate.trim(),
    ].filter(Boolean);
    const filename = [...nameParts, 'Протокол'].join('_') + '.txt';
    learnPhrasesFromReport();
    const blob = new Blob([finalPlainText], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setFullName('');
    setBirthDate('');
    setShowSaveModal(false);
  };

  const goToTemplateList = () => {
  router.push('/');
};

  const importAbbreviations = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importAbbreviationsFile(file)
      .then(() => dialog.alert('Импорт выполнен!'))
      .catch(() => dialog.alert('Ошибка импорта'));
  };

  const addNewGroup = () => {
    const newName = addNewGroupData();
    setSelectedCategory(newName); // сразу выбираем новую группу
  };

  // Уже существующее сокращение с тем же именем. Без учёта регистра: при
  // наборе сокращение ищется по слову в нижнем регистре (см. handleKeyDown),
  // так что "КТ" и "кт" — одно и то же сокращение. Раньше дубль молча
  // перезаписывал существующее вместе с его фразой.
  const findAbbreviationKey = (key: string) => {
    const lower = key.trim().toLowerCase();
    if (!lower) return undefined;
    return Object.keys(abbreviations).find(k => k.toLowerCase() === lower);
  };
  const duplicateAbbrKey = findAbbreviationKey(newAbbrText);

  const addNewAbbreviation = () => {
    const key = newAbbrText.trim();
    const full = newFullText.trim();
    if (!key || !full || findAbbreviationKey(key)) return;
    addNewAbbreviationData(key, full, selectedCategory);
    setNewAbbrText('');
    setNewFullText('');
  };

  const deleteCategory = (cat: string) => {
    deleteCategoryData(cat);
    if (selectedCategory === cat) setSelectedCategory('Все');
  };

  // Стабильные id групп и сокращений — только для key анимации строк
  // (CollapseRow) в "Автокоррекциях". Ключом по имени нельзя: при
  // переименовании строка исчезала бы и появлялась заново. Имя → id; при
  // переименовании id переезжает на новое имя (renameCategory/…).
  const [rowIds] = useState(() => ({ categories: new Map<string, string>(), abbreviations: new Map<string, string>() }));
  const rowId = (map: Map<string, string>, name: string) => {
    let id = map.get(name);
    if (!id) {
      id = crypto.randomUUID();
      map.set(name, id);
    }
    return id;
  };
  const moveRowId = (map: Map<string, string>, from: string, to: string) => {
    map.set(to, rowId(map, from));
    map.delete(from);
  };

  // Escape в поле правки (группа/сокращение/фраза) — отмена: флаг, чтобы
  // onBlur, если он всё-таки сработает при размонтировании поля, не
  // сохранил недописанное значение.
  const cancelInlineEditRef = useRef(false);

  // Удаление в "Автокоррекциях" — через общее окно подтверждения
  // (DialogProvider), а не отдельную модалку со своим оформлением.
  const confirmDeleteCategory = async (cat: string) => {
    const count = Object.values(abbreviations).filter(a => a.category === cat).length;
    const ok = await dialog.confirm(
      count > 0
        ? `Группа «${cat}» и ${count} ${pluralRu(count, ['сокращение', 'сокращения', 'сокращений'])} в ней будут удалены без возможности восстановления.`
        : `Группа «${cat}» будет удалена.`,
      { title: 'Удалить группу?', confirmText: 'Удалить', danger: true }
    );
    if (ok) deleteCategory(cat);
  };

  const confirmDeleteAbbreviation = async (abbr: string) => {
    const ok = await dialog.confirm(
      `Сокращение «${abbr}» будет удалено без возможности восстановления.`,
      { title: 'Удалить сокращение?', confirmText: 'Удалить', danger: true }
    );
    if (ok) deleteAbbreviation(abbr);
  };

  // Переименование сокращения — не перезаписывая другое с тем же именем.
  const renameAbbreviation = (oldKey: string, rawNewKey: string) => {
    const newKey = rawNewKey.trim();
    if (!newKey || newKey === oldKey) return;
    const existing = findAbbreviationKey(newKey);
    // Смена только регистра того же сокращения — не дубль.
    if (existing && existing !== oldKey) {
      dialog.alert(
        `Сокращение «${existing}» уже есть в группе «${abbreviations[existing].category}». Выберите другое имя.`,
        { title: 'Такое сокращение уже есть' }
      );
      return;
    }
    const next = { ...abbreviations };
    next[newKey] = next[oldKey];
    delete next[oldKey];
    moveRowId(rowIds.abbreviations, oldKey, newKey);
    saveData(next, categories);
  };

  const updateAbbreviationPhrase = (key: string, rawFull: string) => {
    const full = rawFull.trim();
    if (!full || full === abbreviations[key]?.full) return;
    saveData({ ...abbreviations, [key]: { ...abbreviations[key], full } }, categories);
  };

  const renameCategory = (cat: string, rawName: string) => {
    const newName = rawName.trim();
    if (!newName || newName === cat || categories.includes(newName)) return;
    const newAbbr = { ...abbreviations };
    Object.keys(newAbbr).forEach(key => {
      if (newAbbr[key].category === cat) newAbbr[key] = { ...newAbbr[key], category: newName };
    });
    moveRowId(rowIds.categories, cat, newName);
    saveData(newAbbr, categories.map(c => (c === cat ? newName : c)));
    if (selectedCategory === cat) setSelectedCategory(newName);
  };

      useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;

      // Ctrl+Z — отмена
      if (isCtrl && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Ctrl+E — свернуть/развернуть все разделы
      if (isCtrl && e.code === 'KeyE') {
        e.preventDefault();
        toggleAllSections();
        return;
      }

      // Ctrl+Shift+C — скопировать протокол
      if (isCtrl && e.shiftKey && e.code === 'KeyC') {
        e.preventDefault();
        copyToClipboard();
        return;
      }

      // Ctrl+Shift+R — сбросить протокол
      if (isCtrl && e.shiftKey && e.code === 'KeyR') {
        e.preventDefault();
        resetToDefault();
        return;
      }

      // Ctrl+Shift+H — к списку шаблонов
      if (isCtrl && e.shiftKey && e.code === 'KeyH') {
        e.preventDefault();
        goToTemplateList();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, toggleAllSections]);

    // === Клавиатура: управление кнопками патологий ===
useEffect(() => {
  if (!activeFieldId || !template) return;

  const activeField = template.fields?.find((f: BuilderField) => f.id === activeFieldId);
  const groups = activeField?.quickButtons || [];
  if (groups.length === 0) {
    setPathNav(null);
    return;
  }

  const handlePathologyKeyDown = (e: KeyboardEvent) => {
    if (
      variantSelector ||
      showComparisonModal ||
      showStateAfterModal ||
      showAbbrModal ||
      showSaveModal
    ) return;

    const isCtrl = e.ctrlKey || e.metaKey;

    // Ctrl + 1..9 — выбор группы
    if (isCtrl && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= groups.length) return;

      const group = groups[idx];
      const phrases = (group.phrases || []).filter(Boolean);

      if (phrases.length === 0) return;

      if (phrases.length === 1) {
        insertPhrase(phrases[0]);
        setPathNav(null);
        setOpenQuickButtonGroupIdx(null);
        return;
      }

      // Именно клавиатурный режим на этой же группе уже активен — повторное
      // нажатие закрывает список целиком. Если группа открыта мышью (или не
      // открыта вовсе) — хоткей не закрывает, а забирает/открывает её в
      // клавиатурном режиме (см. ниже — симметрично тому, как настоящее
      // движение мыши забирает управление в обратную сторону).
      if (pathNav?.groupIdx === idx) {
        setPathNav(null);
        setOpenQuickButtonGroupIdx(null);
        return;
      }

      setOpenQuickButtonGroupIdx(null);
      setPathNav({ groupIdx: idx, phraseIdx: 0 });
      return;
    }

    // Escape — закрыть (и клавиатурную навигацию, и группу, раскрытую кликом)
    if (e.key === 'Escape' && (pathNav || openQuickButtonGroupIdx !== null)) {
      e.preventDefault();
      setPathNav(null);
      setOpenQuickButtonGroupIdx(null);
      return;
    }

    // Стрелки вниз/вверх по фразам — если список уже открыт (кем угодно —
    // клавиатурой или мышью/кликом), но клавиатурного выделения там ещё
    // нет, первая же стрелка забирает управление себе и подсвечивает
    // первую фразу; если выделение уже есть — просто двигает его. Стрелки
    // не трогаем вовсе (пропускаем в поле как обычно), если ни один список
    // сейчас не открыт.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const targetGroupIdx = pathNav?.groupIdx ?? openQuickButtonGroupIdx;
      if (targetGroupIdx === null || targetGroupIdx === undefined) return;

      const targetPhrases = (groups[targetGroupIdx]?.phrases || []).filter(Boolean);
      if (targetPhrases.length === 0) return;

      e.preventDefault();

      if (!pathNav || pathNav.groupIdx !== targetGroupIdx) {
        setOpenQuickButtonGroupIdx(null);
        setPathNav({ groupIdx: targetGroupIdx, phraseIdx: 0 });
        return;
      }

      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setPathNav(prev => {
        if (!prev) return prev;
        const phrases = (groups[prev.groupIdx]?.phrases || []).filter(Boolean);
        return {
          ...prev,
          phraseIdx: Math.min(phrases.length - 1, Math.max(0, prev.phraseIdx + delta)),
        };
      });
      return;
    }

    // Enter — вставить фразу (только в клавиатурном режиме — в мышином
    // Enter должен просто отправлять форму/переводить строку как обычно).
    // Только "голый" Enter: Ctrl+Enter — отдельный хоткей "в Заключение"
    // (см. глобальный обработчик выше), и при открытом списке он не должен
    // превращаться во вставку подсвеченной фразы.
    if (e.key === 'Enter' && pathNav && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      const phrases = (groups[pathNav.groupIdx]?.phrases || []).filter(Boolean);
      if (phrases[pathNav.phraseIdx]) {
        insertPhrase(phrases[pathNav.phraseIdx]);
        // меню остаётся открытым
      }
      return;
    }
  };

  window.addEventListener('keydown', handlePathologyKeyDown);
  return () => window.removeEventListener('keydown', handlePathologyKeyDown);
}, [
  activeFieldId,
  template,
  pathNav,
  openQuickButtonGroupIdx,
  variantSelector,
  showComparisonModal,
  showStateAfterModal,
  showAbbrModal,
  showSaveModal,
]);

        if (loading) return (
  <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
    <div className="w-10 h-10 rounded-full border-4 border-white/15 border-t-amber-400 animate-spin" />
  </div>
);

  if (!template) return (
    <div className="min-h-screen bg-zinc-950 text-white p-8 flex items-center justify-center">
      <div className="text-2xl">Шаблон не найден</div>
    </div>
  );

    const visibleFields = template.fields.filter(
  (f: BuilderField) => !deletedFieldIds.includes(f.id) && f.type !== 'notes'
);

    // Карта: какое поле принадлежит какому заголовку (для сворачивания)
const sectionHeaderMap = new Map<string, string | null>();
let currentHeaderId: string | null = null;
for (const f of visibleFields) {
  if (f.type === 'header') {
    currentHeaderId = f.id;
    sectionHeaderMap.set(f.id, null);
  } else {
    sectionHeaderMap.set(f.id, currentHeaderId);
  }
}

  const activeField = template?.fields?.find((f: BuilderField) => f.id === activeFieldId);

  // Колонка названий — общая в разделе: по самой широкой плашке его полей,
  // но не больше 40% строки (дальше название прокручивается в своём поле).
  // По разделу, а не по всему шаблону: одно длинное название где-то ниже
  // не должно отодвигать содержимое во всех остальных разделах.
  const sectionLabelPx = new Map<string | null, number>();
  for (const f of visibleFields) {
    if (f.type === 'header') continue;
    const section = sectionHeaderMap.get(f.id) ?? null;
    const w = measureLabelPx(f.label || 'Название поля', labelsUppercase) + LABEL_CHIP_PADDING_PX;
    sectionLabelPx.set(section, Math.max(sectionLabelPx.get(section) || 0, w));
  }

    


  return (
    // [overflow-anchor:none] — браузерная привязка прокрутки (scroll
    // anchoring) выключена: всю прокрутку при раскрытии/сворачивании
    // разделов делает наш код (focusFieldElement, scrollIntoView). Иначе при
    // клике на заголовок раздела ВЫШЕ текущего браузер, удерживая видимый
    // контент на месте, сам докручивал страницу вниз, пока раздел
    // раскрывается, а затем scrollIntoView к первому полю вёл её обратно
    // вверх — "скролл вниз, потом вверх".
    <div className="min-h-screen bg-zinc-950 text-white [overflow-anchor:none]">
            
        <div data-filler-topbar className="sticky top-0 z-50 bg-zinc-950 border-b border-white/10">
        <UserHeader>
          {/* Плавно исчезающее уведомление (черновик, копирование и т.п.) */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 bg-none border border-none
                        text-zinc-400 text-sm whitespace-nowrap overflow-hidden transition-all duration-300
                        ${toastMessage
                          ? 'opacity-100 max-w-[200px] scale-100 mr-2'
                          : 'opacity-0 max-w-0 scale-95 pointer-events-none'
                        }`}
          >
            {toastMessage}
          </div>
        </UserHeader>
        {/* Панель над полями — всегда видна (часть липкой шапки, поэтому
            прокрутка к разделу, отсчитывающая от низа шапки, учитывает и
            её). Та же сетка колонок, что у страницы ниже, — кнопки стоят
            ровно над колонкой полей. */}
        <div className={PAGE_COLUMNS_CLASS}>
          <div className={DOCK_COLUMN_CLASS} aria-hidden="true" />
          <div className="flex-1 min-w-0 flex items-center gap-2 py-2">
            <button
              tabIndex={-1}
              onClick={() => {
                if (isComparisonActive) {
                  setIsComparisonActive(false);
                  // даты и режим не очищаем — остаются в памяти
                } else {
                  if (comparisonDates.length === 0) setComparisonDates(['']);
                  if (comparisonDates.length > 1) setIsMultipleComparison(true);
                  setShowComparisonModal(true);
                }
              }}
              className={`${TOPBAR_BUTTON_CLASS} ${isComparisonActive ? TOPBAR_BUTTON_ACTIVE_CLASS : TOPBAR_BUTTON_IDLE_CLASS}`}
              aria-label="Сравнение (Alt+C)"
            >
              Сравнение
              <span className="ml-1.5 text-[10px] font-normal text-zinc-500">Alt+C</span>
            </button>
            <button
              tabIndex={-1}
              onClick={() => {
                if (isStateAfterActive) {
                  setIsStateAfterActive(false);
                  // текст не очищаем
                } else {
                  setShowStateAfterModal(true);
                }
              }}
              className={`${TOPBAR_BUTTON_CLASS} ${isStateAfterActive ? TOPBAR_BUTTON_ACTIVE_CLASS : TOPBAR_BUTTON_IDLE_CLASS}`}
              aria-label="Примечание (Alt+P)"
            >
              Примечание
              <span className="ml-1.5 text-[10px] font-normal text-zinc-500">Alt+P</span>
            </button>
            {/* Видна всегда; без заметок — приглушена, окно подскажет, где их
                добавить. */}
            <button
              onClick={() => setShowNotesModal(true)}
              tabIndex={-1}
              className={`${TOPBAR_BUTTON_CLASS} gap-1.5 ${notesLinks.length > 0 ? TOPBAR_BUTTON_IDLE_CLASS : 'bg-transparent border-white/10 text-zinc-500 hover:text-zinc-300 hover:border-white/20'}`}
            >
              <Paperclip className="w-3.5 h-3.5" />
              Заметки
              {notesLinks.length > 0 && <span className="text-[10px] font-normal text-zinc-500">{notesLinks.length}</span>}
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={labelsUppercase}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleLabelsUppercase}
              className="ml-auto inline-flex items-center gap-2 h-8 px-2 rounded-lg text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer"
              title="Названия полей заглавными буквами"
            >
              <span className={`relative w-7 h-4 rounded-full transition-colors ${labelsUppercase ? 'bg-amber-400' : 'bg-white/15'}`}>
                <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-zinc-950 transition-transform ${labelsUppercase ? 'translate-x-3' : ''}`} />
              </span>
              ЗАГЛАВНЫЕ
            </button>
          </div>
          <div className={QUICK_COLUMN_CLASS} aria-hidden="true" />
        </div>
      </div>

      <div className={`${PAGE_COLUMNS_CLASS} pt-6 pb-8`}>
        {/* Док слева: действия с протоколом. Не фокусируются по Tab. */}
        <aside className={DOCK_COLUMN_CLASS}>
          <div className={`sticky ${SIDE_PANEL_TOP_CLASS} ${DOCK_PANEL_CLASS}`}>
            <button onClick={copyToClipboard} tabIndex={-1} className={`${DOCK_BUTTON_CLASS} text-amber-400 hover:text-amber-300 hover:bg-amber-400/10`} data-tip="Скопировать (Ctrl+Shift+C)"><Copy className="w-[18px] h-[18px]" strokeWidth={1.75} /></button>
            <button onClick={downloadTxt} tabIndex={-1} className={`${DOCK_BUTTON_CLASS} text-zinc-400 hover:text-white hover:bg-white/10`} data-tip="Сохранить"><Download className="w-[18px] h-[18px]" strokeWidth={1.75} /></button>
            <div className="h-px w-5 bg-white/10 my-1" aria-hidden="true" />
            <button onClick={resetToDefault} tabIndex={-1} className={`${DOCK_BUTTON_CLASS} text-zinc-400 hover:text-red-400 hover:bg-white/10`} data-tip="Сбросить протокол (Ctrl+Shift+R)"><RotateCcw className="w-[18px] h-[18px]" strokeWidth={1.75} /></button>
            <button onClick={() => setShowAbbrModal(true)} tabIndex={-1} className={`${DOCK_BUTTON_CLASS} text-zinc-400 hover:text-white hover:bg-white/10`} data-tip="Автокоррекции"><Settings className="w-[18px] h-[18px]" strokeWidth={1.75} /></button>
            <button onClick={openPhraseMemory} onMouseDown={(e) => e.preventDefault()} tabIndex={-1} className={`${DOCK_BUTTON_CLASS} text-zinc-400 hover:text-white hover:bg-white/10`} data-tip="Выученные фразы поля"><Sparkles className="w-[18px] h-[18px]" strokeWidth={1.75} /></button>
            <div className="h-px w-5 bg-white/10 my-1" aria-hidden="true" />
            <button onClick={goToTemplateList} tabIndex={-1} className={`${DOCK_BUTTON_CLASS} text-zinc-400 hover:text-white hover:bg-white/10`} data-tip="К списку шаблонов (Ctrl+Shift+H)"><Home className="w-[18px] h-[18px]" strokeWidth={1.75} /></button>
          </div>
        </aside>

        <main className="flex-1 min-w-0 pb-64">
          {variantSelector && (
            <div
              className="fixed z-40 bg-zinc-900/90 backdrop-blur-md rounded-xl shadow-xl py-1 w-fit min-w-[160px] max-w-[420px]"
              style={{
                top: variantSelector.position.top,
                left: variantSelector.position.left,
              }}
            >
              {variantSelector.variants.map((variant, index) => (
                <button
                  key={index}
                  onClick={() => selectVariant(index)}
                  // Наведение мыши сразу переносит клавиатурное выделение на
                  // эту же строку (как в dropdown'е "Примечание") — единый
                  // источник вместо двух, поэтому подсветка мышью и стрелками
                  // никогда не показывается на разных строках одновременно.
                  onMouseEnter={() => setSelectedVariantIndex(index)}
                  className={`w-full text-left px-4 py-[6px] text-sm transition-colors ${
                    index === selectedVariantIndex
                      ? 'bg-white/10 border-none rounded-xl font-medium'
                      : 'text-white hover:bg-white/10 hover:border-transparent rounded-xl cursor-pointer'
                  }`}
                >
                  {variant}
                </button>
              ))}
            </div>
          )}
          <h1 className="mb-6 px-2 text-2xl font-bold tracking-tight select-none">{template.title}</h1>

          {/* Вводные строки протокола — «Сравнение» и «Примечание»: в
              протоколе они идут перед всеми полями, здесь — так же, тем же
              текстом (comparisonLine/stateAfterText, как в generateReport). */}
          {((isComparisonActive && comparisonDates.length > 0) || (isStateAfterActive && stateAfterText)) && (
            <div className="mb-3 px-2 space-y-1">
              {([
                isComparisonActive && comparisonDates.length > 0 && {
                  key: 'comparison',
                  text: comparisonLine(comparisonDates),
                  edit: () => {
                    if (comparisonDates.length > 1) setIsMultipleComparison(true);
                    setShowComparisonModal(true);
                  },
                  remove: () => setIsComparisonActive(false),
                  title: 'Сравнение',
                },
                isStateAfterActive && stateAfterText && {
                  key: 'stateAfter',
                  text: stateAfterText,
                  edit: () => setShowStateAfterModal(true),
                  remove: () => setIsStateAfterActive(false),
                  title: 'Примечание',
                },
              ].filter(Boolean) as { key: string; text: string; edit: () => void; remove: () => void; title: string }[]).map(line => (
                <div key={line.key} className="group/lead flex items-start gap-2 pl-3 py-1 border-l-2 border-amber-400/50">
                  <span className="flex-1 min-w-0 text-sm leading-tight text-amber-400 whitespace-pre-wrap break-words">{line.text}</span>
                  <span className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover/lead:opacity-100 transition-opacity">
                    <button
                      type="button"
                      tabIndex={-1}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={line.edit}
                      aria-label={`Изменить: ${line.title}`}
                      className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-500 hover:text-white hover:bg-white/10 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={line.remove}
                      aria-label={`Убрать: ${line.title}`}
                      className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-500 hover:text-red-400 hover:bg-white/10 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Строки «Название поля: [содержимое]». Колонка названий общая в
              разделе — содержимое его строк начинается с одной вертикали. */}
          <div>
  {visibleFields.map((f: BuilderField) => {
    const parentHeaderId = f.type !== 'header' ? sectionHeaderMap.get(f.id) : null;
    const isSectionCollapsed = parentHeaderId ? collapsedHeaders.has(parentHeaderId) : false;
    const isAnimatingOut = isSectionCollapsed || newlyAddedId === f.id || removingId === f.id;
    // Кнопки в конце строки видны у активного поля, при наведении на
    // строку или фокусе внутри неё.
    const railVisibilityClass = activeFieldId === f.id
      ? ''
      : 'opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100';
    const value: string = typeof fieldsData[f.id] === 'string' ? fieldsData[f.id] : '';

    return (
      // Внешний grid + grid-rows-[0fr] — плавное сворачивание раздела, как и
      // раньше у карточек; обрезка (overflow-hidden) — только пока строка
      // свёрнута/появляется/удаляется, иначе резались бы всплывающие окна.
      <div
        key={f.id}
        data-field-id={f.id}
        className={`grid group/card transition-all ${skipSectionTransition ? 'duration-0' : 'duration-200'} ease-out
          ${isSectionCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}
          ${newlyAddedId === f.id || removingId === f.id ? 'opacity-0 grid-rows-[0fr]' : ''}
        `}
      >
      <div className={`min-h-0 min-w-0 ${isAnimatingOut ? 'overflow-hidden' : ''}`}>

      {/* === ЗАГОЛОВОК РАЗДЕЛА (сворачивание — как раньше) === */}
{f.type === 'header' && (
  <div
    role="button"
    // Заголовок попадает в естественный порядок Tab, только пока его раздел
    // свёрнут (тогда внутри него нет табируемых полей, и Tab должен уметь
    // "перепрыгнуть" на заголовок как таковой). Когда раздел раскрыт, Tab не
    // должен задерживаться на самом заголовке — фокус должен уходить сразу в
    // поля внутри него, у которых уже tabIndex=0 (см. isSectionCollapsed
    // ниже); программному focus() из openOnlySection/focusHeaderForNav
    // tabIndex=-1 не мешает.
    tabIndex={collapsedHeaders.has(f.id) ? 0 : -1}
    data-header-id={f.id}
    className="mt-5 mb-1 py-1.5 px-2 flex items-center gap-2 cursor-pointer group select-none outline-none rounded-lg
      focus:bg-white/10 focus:ring-2 focus:ring-amber-400/40 focus:ring-inset"
    onClick={() => openOnlySection(f.id)}
    onMouseDown={(e) => {
      // оставляем фокус на заголовке, не уводим в body
      e.preventDefault();
    }}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openOnlySection(f.id);
        return;
      }

      if (e.key === 'Tab') {
        // Раздел уже раскрыт — не мешаем: естественный порядок Tab сам
        // уведёт фокус в первое (или последнее — при Shift+Tab это была
        // бы предыдущая табируемая точка) поле раздела, у полей уже
        // выставлен корректный tabIndex в зависимости от collapsedHeaders.
        if (!collapsedHeaders.has(f.id)) return;

        e.preventDefault();
        if (!template) return;

        const headerIds = template.fields
          .filter((x: BuilderField) => x.type === 'header' && !deletedFieldIds.includes(x.id))
          .map((x: BuilderField) => x.id);

        const idx = headerIds.indexOf(f.id);
        if (idx === -1) return;

        const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
        if (nextIdx < 0 || nextIdx >= headerIds.length) return;

        focusHeaderForNav(headerIds[nextIdx]);
      }
    }}
  >
    <span className="text-zinc-500 group-hover:text-amber-400 group-focus:text-amber-400 transition-colors">
      {collapsedHeaders.has(f.id) ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
    </span>
    <h2 className="text-base font-semibold tracking-wide text-white group-hover:text-amber-400 group-focus:text-amber-400 transition-colors select-none">
      {f.label}
    </h2>
    <div className="flex-1 h-px bg-white/10 ml-2" aria-hidden="true" />
  </div>
)}

      {/* === СТРОКА ПОЛЯ === */}
{f.type !== 'header' && (
  <div className={`relative flex items-start gap-2 px-2 py-1 rounded-lg transition-colors ${
    activeFieldId === f.id ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
  }`}>
    {/* Название поля — редактируемое, на сером фоне */}
    <div
      className="shrink-0 flex items-start gap-1 pt-px"
      style={{ width: `min(${(sectionLabelPx.get(parentHeaderId ?? null) || 0) + LABEL_COLON_PX}px, 40%)` }}
    >
      <input
        type="text"
        tabIndex={-1}
        data-custom-focus
        value={f.label || ''}
        onChange={(e) => updateFieldLabel(f.id, e.target.value)}
        onFocus={() => handleFocus(f.id, null)}
        onBlur={handleBlur}
        placeholder="Название поля"
        title={f.label || ''}
        style={{ width: measureLabelPx(f.label || 'Название поля', labelsUppercase) + LABEL_CHIP_PADDING_PX }}
        className={`min-w-0 max-w-full bg-white/10 rounded-md px-2 py-0.5 text-sm font-medium text-white placeholder:text-zinc-500 focus:outline-none focus:bg-white/15 transition-colors ${
          labelsUppercase ? 'uppercase tracking-wide' : ''
        }`}
      />
      <span className="py-0.5 text-sm text-zinc-500 select-none">:</span>
    </div>

    {/* Содержимое в [ ] */}
    <div className="flex-1 min-w-0">
      {(f.type === 'text' || f.type === 'conclusion') && (
        <div className="relative">
          <span aria-hidden="true" className={BRACKET_OPEN_CLASS}>[</span>
          {/* Поле растёт плавно вслед за текстом (SmoothHeight). */}
          <SmoothHeight className="w-full">
          <div className="relative w-full">
          <textarea
            ref={el => { if (el) inputRefs.current[f.id] = el; }}
            data-custom-focus
            value={value}
            onChange={e => {
              handleInputChange(f.id, e.target.value);
              autoResize(e.target);
              // Курсор — вместе со значением, в том же рендере: иначе подсказка на
              // кадр считалась бы по старой позиции и мигала.
              setCaret(e.target.selectionStart === e.target.selectionEnd ? { fieldId: f.id, pos: e.target.selectionStart } : null);
            }}
            onSelect={e => {
              const t = e.currentTarget;
              setCaret(t.selectionStart === t.selectionEnd ? { fieldId: f.id, pos: t.selectionStart } : null);
            }}
            onKeyDown={e => {
              if (handleGhostKeyDown(e, f.id)) return;
              if (handleCorrectionKeyDown(e, f.id)) return;
              handleFieldTabNavigation(e, f.id);
              if (!e.defaultPrevented) handleKeyDown(e, f.id);
            }}
            onFocus={(e) => handleFocus(f.id, e.target)}
            onBlur={handleBlur}
            tabIndex={isSectionCollapsed ? -1 : 0}
            rows={1}
            className={`w-full bg-transparent border-0 ${CONTENT_TEXT_CLASS} text-amber-400 caret-amber-400 placeholder:text-zinc-500 focus:outline-none resize-none`}
            placeholder={ghost?.fieldId === f.id ? '' : (f.placeholder || 'Введите значение')}
          />
          {/* Зеркало текста поля: прозрачная копия (те же отступы и шрифт —
              те же переносы строк) нужна, чтобы закрывающая «]» и серая
              ИИ-подсказка встали ровно после последнего символа. */}
          <div
            data-ghost-overlay
            aria-hidden="true"
            className={`pointer-events-none absolute inset-x-0 top-0 ${CONTENT_TEXT_CLASS} whitespace-pre-wrap break-words text-transparent`}
          >
            {ghost?.fieldId === f.id ? (
              <>
                {value.slice(0, ghost.pos)}
                {/* Разрешённый перенос на стыке: иначе недописанное слово вместе с
                    подсказкой («гор» + «изонтальный») переносилось в слое целиком на
                    следующую строку, а в самом поле «гор» оставалось на прежней —
                    подсказка съезжала с пустым отступом. */}
                <wbr />
                <span className="text-zinc-500">{ghost.ghost}</span>
                {value.slice(ghost.pos)}
              </>
            ) : (value || f.placeholder || 'Введите значение')}
            <span className={BRACKET_CLOSE_CLASS}>]</span>
            {/* Единица (поля, бывшие «Числом») — после скобки, как раньше. */}
            {f.unit && <span className="ml-1.5 text-zinc-500">{f.unit}</span>}
          </div>
          </div>
          </SmoothHeight>
        </div>
      )}

      {f.type === 'number' && (
        <div className={`flex items-baseline ${CONTENT_TEXT_CLASS} px-0`}>
          <span aria-hidden="true" className="text-zinc-500 select-none">[</span>
          <input
            ref={el => { if (el) inputRefs.current[f.id] = el; }}
            type="text"
            inputMode="decimal"
            data-custom-focus
            value={fieldsData[f.id] || ''}
            onChange={e => handleInputChange(f.id, e.target.value)}
            onFocus={(e) => handleFocus(f.id, e.target)}
            tabIndex={isSectionCollapsed ? -1 : 0}
            onKeyDown={e => handleFieldTabNavigation(e, f.id)}
            onBlur={handleBlur}
            style={{ width: numberInputWidth(String(fieldsData[f.id] || f.placeholder || '0.00')) }}
            className="mx-[2px] bg-transparent border-0 p-0 text-center tabular-nums text-amber-400 caret-amber-400 placeholder:text-zinc-500 focus:outline-none"
            placeholder={f.placeholder || '0.00'}
          />
          <span aria-hidden="true" className="text-zinc-500 select-none">]</span>
          {f.unit && <span className="ml-1.5 text-zinc-500">{f.unit}</span>}
        </div>
      )}

      {f.type === 'select' && (
        <div className={`flex items-baseline ${CONTENT_TEXT_CLASS} px-0`}>
          <span aria-hidden="true" className="text-zinc-500 select-none">[</span>
          <select
            ref={el => { if (el) inputRefs.current[f.id] = el; }}
            data-custom-focus
            value={fieldsData[f.id] || ''}
            onChange={e => updateField(f.id, e.target.value)}
            onFocus={() => handleFocus(f.id, null)}
            onBlur={handleBlur}
            tabIndex={isSectionCollapsed ? -1 : 0}
            onKeyDown={e => handleFieldTabNavigation(e, f.id)}
            className={`max-w-full appearance-none bg-transparent border-0 px-1 py-0 cursor-pointer focus:outline-none ${
              fieldsData[f.id] ? 'text-amber-400' : 'text-zinc-500'
            }`}
          >
            <option value="" className="bg-zinc-900 text-zinc-400">выберите вариант…</option>
            {f.options?.map((opt: string, i: number) => <option key={i} value={opt} className="bg-zinc-900 text-white">{opt}</option>)}
          </select>
          <span aria-hidden="true" className="text-zinc-500 select-none">]</span>
          <ChevronDown size={12} className="ml-1 self-center text-zinc-500 pointer-events-none" aria-hidden="true" />
        </div>
      )}

      {f.type === 'checkbox' && (
        <label
          className={`flex items-center gap-2 cursor-pointer ${CONTENT_TEXT_CLASS} px-0`}
          onClick={() => handleFocus(f.id, null)}
        >
          <span aria-hidden="true" className="text-zinc-500 select-none">[</span>
          <span className="relative inline-flex shrink-0">
            <input
              ref={el => { if (el) inputRefs.current[f.id] = el; }}
              type="checkbox"
              checked={!!fieldsData[f.id]}
              onChange={e => updateField(f.id, e.target.checked)}
              onFocus={() => handleFocus(f.id, null)}
              onBlur={handleBlur}
              tabIndex={isSectionCollapsed ? -1 : 0}
              onKeyDown={e => handleFieldTabNavigation(e, f.id)}
              className="peer sr-only"
            />
            <span className="w-4 h-4 rounded border-2 border-white/40 bg-transparent peer-checked:bg-amber-400 peer-checked:border-amber-400 peer-focus-visible:ring-2 peer-focus-visible:ring-amber-400/40 transition-all flex items-center justify-center">
              {!!fieldsData[f.id] && (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-black">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
          </span>
          <span className={fieldsData[f.id] ? 'text-amber-400' : 'text-zinc-500'}>
            {fieldsData[f.id] ? (f.checkedPhrase || 'Да') : (f.uncheckedPhrase || 'Нет')}
          </span>
          <span aria-hidden="true" className="text-zinc-500 select-none">]</span>
        </label>
      )}

      {f.type === 'rating' && (
        <div className="flex items-center gap-1.5">
          <span aria-hidden="true" className="text-sm text-zinc-500 select-none">[</span>
          <RatingField field={f} value={fieldsData[f.id] || 0} onChange={(val) => updateField(f.id, val)} onFocus={handleFocus} onKeyDown={e => handleFieldTabNavigation(e, f.id)} disabled={isSectionCollapsed} />
          <span aria-hidden="true" className="text-sm text-zinc-500 select-none">]</span>
        </div>
      )}

      {f.type === 'formula' && (
        <div className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 ${CONTENT_TEXT_CLASS} px-0`}>
          {(f.variables || []).map((v, i: number) => (
            <span key={i} className="inline-flex items-baseline">
              <span className="mr-1 text-zinc-400">{v.name} =</span>
              <span aria-hidden="true" className="text-zinc-500 select-none">[</span>
              <input
                ref={el => { if (el) inputRefs.current[`${f.id}_var_${i}`] = el; }}
                type="text"
                inputMode="decimal"
                data-custom-focus
                value={fieldsData[`${f.id}_var_${i}`] || ''}
                onChange={e => updateField(`${f.id}_var_${i}`, e.target.value)}
                onFocus={() => handleFocus(f.id, null)}
                onBlur={handleBlur}
                tabIndex={isSectionCollapsed ? -1 : 0}
                onKeyDown={e => handleFieldTabNavigation(e, f.id, { index: i, total: (f.variables || []).length + 1 })}
                style={{ width: numberInputWidth(String(fieldsData[`${f.id}_var_${i}`] || '0.00')) }}
                className="mx-[2px] bg-transparent border-0 p-0 text-center tabular-nums text-amber-400 caret-amber-400 placeholder:text-zinc-500 focus:outline-none"
                placeholder="0.00"
              />
              <span aria-hidden="true" className="text-zinc-500 select-none">]</span>
            </span>
          ))}
          <span className="inline-flex items-baseline gap-1.5">
            <span className="text-zinc-500">→</span>
            <span className={fieldsData[f.id] ? 'text-amber-400' : 'text-zinc-500'}>{fieldsData[f.id] || '—'}</span>
            {f.unit && <span className="text-zinc-500">{f.unit}</span>}
          </span>
          {/* Комментарий к результату — в протоколе в скобках после единицы.
              Пустой: ни скобок, ни текста; поле ввода видно только при
              наведении на строку / фокусе в ней (как кнопки строки). */}
          {(() => {
            const key = formulaCommentKey(f.id);
            const comment: string = typeof fieldsData[key] === 'string' ? fieldsData[key] : '';
            const vars = (f.variables || []).length;
            return (
              <span className={`inline-flex items-baseline ${comment ? '' : railVisibilityClass}`}>
                {comment && <span aria-hidden="true" className="text-zinc-500 select-none">(</span>}
                <input
                  ref={el => { if (el) inputRefs.current[key] = el; }}
                  type="text"
                  data-custom-focus
                  value={comment}
                  onChange={e => handleInputChange(key, e.target.value)}
                  onFocus={() => handleFocus(f.id, null)}
                  onBlur={handleBlur}
                  tabIndex={isSectionCollapsed ? -1 : 0}
                  onKeyDown={e => handleFieldTabNavigation(e, f.id, { index: vars, total: vars + 1 })}
                  placeholder="+ комментарий"
                  style={{ width: measureTextPx(comment || '+ комментарий', 400) + 3 }}
                  className="bg-transparent border-0 p-0 text-amber-400 caret-amber-400 placeholder:text-zinc-600 focus:outline-none"
                />
                {comment && <span aria-hidden="true" className="text-zinc-500 select-none">)</span>}
              </span>
            );
          })()}
        </div>
      )}
    </div>

    {/* Кнопки в конце строки: добавить поле ниже / удалить это */}
    <div className="shrink-0 flex items-center gap-0.5 pt-px">
      <button
        onClick={() => addTextFieldAfter(f.id)}
        tabIndex={-1}
        aria-label="Добавить поле"
        className={`w-6 h-6 flex items-center justify-center rounded-md text-zinc-500 hover:text-white hover:bg-white/10 transition-[color,background-color,opacity] cursor-pointer ${railVisibilityClass}`}
      >
        <Plus className="w-4 h-4" />
      </button>
      <button
        onClick={() => removeField(f.id)}
        tabIndex={-1}
        aria-label="Удалить"
        className={`w-6 h-6 flex items-center justify-center rounded-md text-zinc-500 hover:text-red-400 hover:bg-white/10 transition-[color,background-color,opacity] cursor-pointer ${railVisibilityClass}`}
      >
        <Trash2 size={15} />
      </button>
    </div>

    {/* Находки над «Заключением»: пока в нём курсор. Клики по попапу не
        уводят фокус из поля (preventDefault на mousedown) — можно смотреть
        на находки и печатать заключение. Высота — не больше места над
        строкой: при фокусе она прокручивается в центр экрана, а сверху
        липкая шапка (~7rem). */}
    <AnimatePresence>
      {f.type === 'conclusion' && activeFieldId === f.id && findings.length > 0 && (
        <motion.div
          key="findings"
          initial={{ opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.98 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          onMouseDown={(e) => e.preventDefault()}
          className="absolute bottom-full left-0 right-0 mb-2 z-40 max-h-[calc(50vh-7rem)] overflow-y-auto rounded-2xl bg-zinc-900 border border-white/10 shadow-2xl px-3.5 py-2.5"
        >
          <div className="mb-1.5 flex items-baseline gap-2 text-[11px] text-zinc-500">
            Находки
            <span className="tabular-nums">{findings.length}</span>
          </div>
          <div className="space-y-0.5">
            {findings.map((item, i) => (
              <div key={item.id}>
                {item.section && item.section !== findings[i - 1]?.section && (
                  <div className={`${i > 0 ? 'mt-1.5' : ''} mb-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500`}>
                    {item.section}
                  </div>
                )}
                <div className="text-xs leading-snug">
                  <span className={`text-zinc-400 ${labelsUppercase ? 'uppercase tracking-wide' : ''}`}>{item.label}:</span>{' '}
                  <span className="text-amber-400 whitespace-pre-wrap break-words">{item.value}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>

  </div>
)}

      </div>
      </div>
    );
  })}
          </div>
        </main>

        {/* Справа: быстрые кнопки активного поля (Ctrl+1…9 — группы). */}
        <aside className={QUICK_COLUMN_CLASS}>
          <div className={`sticky ${SIDE_PANEL_TOP_CLASS}`}>
            {/* ИИ-проверка активного поля — после паузы в наборе. В правой
                панели, а не поверх строки: строка доходит до этой колонки, и
                всплывающее окно закрывало бы быстрые кнопки. */}
            {visibleCorrection && (
      <div
        className="mb-2 rounded-xl bg-zinc-900 border border-amber-400/25 px-3 py-2.5 text-xs leading-snug"
        onMouseDown={(e) => e.preventDefault()}
      >
        <div className="mb-1.5 text-[11px] text-zinc-500 truncate">
          Исправление · <span className="text-zinc-300">{activeField?.label || 'поле'}</span>
        </div>
        <div className="flex items-start gap-2">
          <SpellCheck className="w-3.5 h-3.5 mt-px shrink-0 text-amber-400" aria-hidden="true" />
          <span className="flex-1 min-w-0 text-zinc-300 whitespace-pre-wrap break-words">
            {wordDiff(visibleCorrection.original, visibleCorrection.corrected).map((seg, i) => (
              <span key={i}>
                {seg.deleted && (
                  <><span className="line-through text-red-400/80" title="будет удалено">{seg.deleted}</span>{seg.text ? ' ' : ''}</>
                )}
                {seg.changed ? (
                  <span
                    className="text-amber-400 underline decoration-dotted underline-offset-2"
                    title={seg.was ? `было: ${seg.was}` : 'добавлено'}
                  >
                    {seg.text}
                  </span>
                ) : seg.text}
              </span>
            ))}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-end gap-3">
          <button
            type="button"
            tabIndex={-1}
            onClick={() => dismissCorrection(visibleCorrection.fieldId)}
            className="text-zinc-500 hover:text-white cursor-pointer"
          >
            Не исправлять <span className="text-[10px] text-zinc-600">Esc</span>
          </button>
          <button
            type="button"
            tabIndex={-1}
            onClick={() => applyCorrection(visibleCorrection.fieldId)}
            className="font-medium text-amber-400 hover:text-amber-300 cursor-pointer"
          >
            Исправить <span className="text-[10px] font-normal text-amber-400/60">Alt+Enter</span>
          </button>
        </div>
      </div>
    )}
          <div className="rounded-2xl bg-zinc-900/75 border border-white/10 shadow-2xl p-2">
            <div className="px-2 pt-1 pb-2 text-xs text-zinc-500 truncate">
              Быстрые кнопки{activeField?.label ? <> · <span className="text-zinc-300">{activeField.label}</span></> : null}
            </div>
            {activeFieldId && activeField?.quickButtons && activeField.quickButtons.length > 0 ? (
    <div
      className="flex flex-col gap-0.5"
      onMouseDown={(e) => e.preventDefault()}
      // Раньше здесь сбрасывался pathNav при наведении мыши на ряд — это
      // было нужно для старой модели с dropdown-hover. Теперь раскрытие по
      // hover убрано (см. openQuickButtonGroupIdx), и этот сброс стал не
      // просто лишним, а вредным: когда список открывается горячей клавишей
      // (Ctrl+1..9) прямо под НЕПОДВИЖНым курсором, Chrome всё равно
      // синтезирует mouseenter для элементов, появившихся под курсором без
      // реального движения мыши — из-за чего pathNav сбрасывался и список
      // тут же захлопывался. Закрытие по мыши теперь делает отдельный
      // click-outside эффект на openQuickButtonGroupIdx, а pathNav закрывается
      // явно — по Ctrl+число/Escape/смене активного поля.
      onMouseMove={() => {
        // Chrome всё же синтезирует mousemove без реального движения мыши —
        // когда под неподвижным курсором прокручивается контент (как раз
        // наш список при листании стрелками). Из-за этого, если курсор
        // стоял над открывшимся списком, первое же пролистывание отбирало
        // управление у клавиатуры, и подсветка возвращалась туда, где лежал
        // курсор. У синтетического события координаты курсора те же, что у
        // предыдущего, — такие события игнорируем.
        // (Сравнение делает глобальный слушатель в фазе захвата — он видит
        // и движения курсора до того, как тот оказался над списком.)
        if (!mouseMoveIsRealRef.current) return;
        // Настоящее движение мыши передаёт управление списком от клавиатуры к
        // курсору: сама группа остаётся открытой (теперь через
        // openQuickButtonGroupIdx), но подсветка стрелками пропадает и
        // стрелки/Enter перестают работать, пока список не переоткроют
        // явно горячей клавишей — контроль не может быть у обоих сразу.
        if (pathNav) {
          setOpenQuickButtonGroupIdx(pathNav.groupIdx);
          setPathNav(null);
        }
      }}
    >
      {(activeField.quickButtons || []).map((group: QuickButtonGroup, gIdx: number) => {
        const phrases = (group.phrases || []).filter(Boolean);
        const isSinglePhrase = phrases.length === 1;
        const singlePhrase = isSinglePhrase ? phrases[0] : '';

        const isNavOpen = pathNav?.groupIdx === gIdx;
        const isClickOpen = openQuickButtonGroupIdx === gIdx;
        const isOpen = isNavOpen || isClickOpen;

        return (
          <div
            key={group.id}
            ref={(el) => { quickButtonGroupRefs.current[gIdx] = el; }}
            className={`dropdown dropdown-end w-full ${isOpen ? 'dropdown-open' : ''}`}
          >
            {/* Кнопка группы — раскрытие списка только по клику (не по hover) */}
            <div
              tabIndex={-1}
              role="button"
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm text-white hover:bg-white/5 hover:text-amber-400 focus:outline-none cursor-pointer transition-colors ${
                isOpen ? 'bg-white/5 text-amber-400' : ''
              }`}
              onClick={() => {
                if (isSinglePhrase && singlePhrase) {
                  insertPhrase(singlePhrase);
                  return;
                }
                setPathNav(null);
                setOpenQuickButtonGroupIdx(prev => (prev === gIdx ? null : gIdx));
              }}
            >
              <span className={`inline-flex items-center justify-center w-4 h-4 text-[10px] font-medium rounded shrink-0 ${gIdx < 9 ? 'bg-white/10 text-zinc-300' : ''}`}>
                {gIdx < 9 ? gIdx + 1 : ''}
              </span>
              <span className="flex-1 min-w-0 truncate">{group.label || 'Группа'}</span>
              {!isSinglePhrase && <ChevronDown size={12} className={`shrink-0 text-zinc-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
            </div>

            {/* Список фраз (2-й уровень) */}
            {!isSinglePhrase && (
              <ul
                tabIndex={-1}
                className="dropdown-content menu bg-zinc-900 border border-white/10 shadow-2xl rounded-box z-[10000] w-full min-w-[320px] p-1 mt-1"
              >
                <div className="max-h-[280px] overflow-y-auto overflow-x-hidden py-1 overscroll-contain scrollbar-thin scrollbar-thumb-zinc-500 scrollbar-track-zinc-900/30">
                  {phrases.map((phrase: string, pIdx: number) => {
                    // Подсветка курсором (hover) и подсветка клавиатурой
                    // (pathNav) — два независимых источника: наводя мышь на
                    // другую фразу, не меняем pathNav (иначе стрелки/Enter
                    // неожиданно перехватывали бы клавиши, пока мышь просто
                    // лежит над списком, открытым кликом). Цвет у них
                    // намеренно один и тот же (bg-white/10, как в поповере
                    // вариантов аббревиатур) — раз одновременно виден только
                    // один источник (см. ниже), различать их визуально не
                    // нужно. Пока клавиатура ведёт эту же группу (isNavOpen),
                    // hover на остальных строках отключаем совсем — иначе
                    // там, где физически застыл курсор (а движения не было,
                    // только переключился режим), повисает лишняя, уже не
                    // актуальная подсветка мышью. hover:!bg-transparent с !
                    // обязателен — иначе побеждает собственный :hover самого
                    // daisyUI у .menu li (см.
                    // node_modules/daisyui/components/menu.css), которому
                    // просто отсутствие нашего hover-класса не помеха.
                    const isKeyboardSelected = isNavOpen && pathNav?.phraseIdx === pIdx;
                    return (
                    <li key={pIdx}>
                      <button
                        data-path-group={gIdx}
                        data-path-phrase={pIdx}
                        onClick={() => insertPhrase(phrase)}
                        className={`w-full text-left justify-start text-xs py-3 px-5 rounded-lg text-white transition-colors ${
                          isKeyboardSelected
                            ? 'bg-white/10'
                            : isNavOpen
                              ? 'hover:!bg-transparent'
                              : 'hover:bg-white/10'
                        }`}
                      >
                        {phrase}
                      </button>
                    </li>
                    );
                  })}
                </div>
              </ul>
            )}
          </div>
        );
      })}
    </div>
            ) : (
              <p className="px-2 pb-2 text-xs text-zinc-600">
                {activeFieldId ? 'У этого поля нет быстрых кнопок' : 'Поставьте курсор в поле'}
              </p>
            )}
          </div>
          </div>
        </aside>
      </div>

      {/* МОДАЛКИ (полностью без изменений) */}

      <AnimatedModal
        open={phraseMemoryFieldId !== null}
        onClose={() => setPhraseMemoryFieldId(null)}
        size="lg"
      >
        {(() => {
          const fieldId = phraseMemoryFieldId;
          const field = template?.fields.find(f => f.id === fieldId);
          const phrases = fieldId ? rankedPhrases(phraseMemory.memory[fieldId]) : [];
          return (
            <>
              <ModalHeader
                title="Выученные фразы"
                subtitle={fieldId === STATE_AFTER_FIELD_ID ? 'Примечание' : field?.type === 'conclusion' ? 'Заключение' : (field?.label || 'Текстовое поле')}
                onClose={() => setPhraseMemoryFieldId(null)}
              />
              {fieldId && phraseMemory.stats[fieldId] && (() => {
                const byModel = phraseMemory.stats[fieldId];
                const rows = Object.entries(byModel).length > 1
                  ? [['Всего', sumStats(byModel)] as const, ...Object.entries(byModel)]
                  : Object.entries(byModel);
                return (
                  <div className="px-6 py-3 border-b border-white/10 text-xs text-zinc-400 space-y-1">
                    {rows.map(([model, st]) => (
                      <div key={model} className="flex items-baseline gap-3 tabular-nums">
                        <span className="w-40 shrink-0 truncate text-zinc-500" title={model}>{model.replace(/\/latest$/, '')}</span>
                        <span>
                          принято <span className="text-amber-400 font-medium">{st.shown ? Math.round((st.accepted / st.shown) * 100) : 0}%</span>
                          {' '}подсказок ({st.accepted} из {st.shown})
                        </span>
                        {st.requests > 0 && <span className="ml-auto text-zinc-500">ответ ~{Math.round(st.ms / st.requests)} мс</span>}
                      </div>
                    ))}
                  </div>
                );
              })()}
              <ModalBody className="max-h-[60vh] py-3">
                {phrases.length === 0 ? (
                  <p className="py-6 text-center text-sm text-zinc-500">Пока ничего не выучено</p>
                ) : phrases.map(({ key, entry }) => (
                  <div key={key} className="group flex items-center gap-3 -mx-3 px-3 py-1.5 rounded-lg hover:bg-white/5">
                    <span className="flex-1 min-w-0 text-sm text-zinc-100 break-words">
                      {entry.t.split(SLOT).map((part, i) => (
                        <span key={i}>
                          {i > 0 && <span className="text-zinc-500">…</span>}
                          {part}
                        </span>
                      ))}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-zinc-500" title="Сколько раз встречалась в протоколах">×{entry.c}</span>
                    <button
                      type="button"
                      onClick={() => fieldId && phraseMemory.forget(fieldId, key)}
                      aria-label="Забыть фразу"
                      className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-zinc-500 hover:text-red-400 hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </ModalBody>
              <div className="px-6 py-3 border-t border-white/10 text-xs text-zinc-500 leading-relaxed">
                ИИ-подсказки пишут в вашем стиле по этим фразам — они собираются из скопированных и сохранённых протоколов.{' '}
                <span className="text-zinc-400">→</span> — принять,{' '}
                <span className="text-zinc-400">Ctrl/⌥+→</span> — одно слово,{' '}
                <span className="text-zinc-400">Esc</span> — скрыть.
              </div>
            </>
          );
        })()}
      </AnimatedModal>

      <AnimatedModal
        open={showNotesModal}
        onClose={() => setShowNotesModal(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setShowNotesModal(false);
        }}
      >
        <ModalHeader title="Заметки" onClose={() => setShowNotesModal(false)} />
        <ModalBody className="max-h-[60vh] py-3">
          {notesLinks.length === 0 && (
            <p className="py-4 text-center text-sm text-zinc-500">
              В этом шаблоне нет заметок — их можно добавить в конструкторе шаблона.
            </p>
          )}
          {notesLinks.filter(link => isSafeUrl(link.url)).map((link, i) => (
            <a
              key={i}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2.5 -mx-3 px-3 py-2 rounded-lg text-sm text-white hover:bg-white/5 hover:text-amber-400 transition-colors"
            >
              <LinkIcon className="w-4 h-4 shrink-0 text-zinc-500 group-hover:text-amber-400 transition-colors" />
              <span className="flex-1 min-w-0 truncate">{link.text}</span>
              <ExternalLink className="w-3.5 h-3.5 shrink-0 text-zinc-600 group-hover:text-amber-400 transition-colors" />
            </a>
          ))}
        </ModalBody>
      </AnimatedModal>

      <AnimatedModal
        open={showComparisonModal}
        onClose={() => setShowComparisonModal(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const hasValidDate = comparisonDates.some(d => isValidDateDDMMYYYY(d));
            if (hasValidDate) {
              setIsComparisonActive(true);
              setShowComparisonModal(false);
            }
          }
          if (e.key === 'Escape') {
            setShowComparisonModal(false);
          }
        }}
      >
        <ModalHeader
          title="Сравнение с предыдущим"
          subtitle="Дата попадёт в начало протокола"
          onClose={() => setShowComparisonModal(false)}
        />
        {/* Отступы — padding внутри анимируемых строк, а не space-y: margin
            у раскрывающегося по высоте блока прыгал бы скачком. Окно само
            плавно меняет высоту вслед за строками (CollapseRow). */}
        <ModalBody>
          <input
            autoFocus
            type="text"
            inputMode="numeric"
            value={formatDateToDDMMYYYY(comparisonDates[0] || '')}
            onChange={(e) => handleComparisonDateChange(e, 0)}
            placeholder="ДД-ММ-ГГГГ"
            maxLength={10}
            className={`${MODAL_INPUT_CLASS} text-center tabular-nums`}
          />

          <label className="mt-4 flex items-center justify-between gap-4 cursor-pointer">
            <span className="text-sm text-zinc-300">Сравнить с несколькими исследованиями</span>
            <span className="relative inline-flex items-center shrink-0">
              <input
                type="checkbox"
                checked={isMultipleComparison}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setIsMultipleComparison(checked);
                  if (!checked && comparisonDates.length > 1) {
                    setComparisonDates(comparisonDates.slice(0, 1));
                  }
                }}
                className="sr-only peer"
              />
              {/* Переключатель в акцентном цвете: дорожка amber, бегунок
                  тёмный — как залитые главные кнопки. */}
              <span className="w-10 h-6 rounded-full bg-white/10 peer-checked:bg-amber-400 transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:rounded-full after:bg-zinc-300 peer-checked:after:bg-zinc-950 peer-checked:after:translate-x-4 after:transition-[transform,background-color]" />
            </span>
          </label>

          <AnimatePresence initial={false}>
            {isMultipleComparison && (
              <CollapseRow key="multiple">
                <div className="pt-4">
                  <AnimatePresence initial={false}>
                    {comparisonDates.slice(1).map((date, index) => {
                      const realIndex = index + 1;
                      return (
                        <CollapseRow key={comparisonDateIds[realIndex] ?? realIndex}>
                          <div className="group/row flex items-center gap-2 pb-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={formatDateToDDMMYYYY(date)}
                              onChange={(e) => handleComparisonDateChange(e, realIndex)}
                              placeholder="ДД-ММ-ГГГГ"
                              maxLength={10}
                              className={`${MODAL_INPUT_CLASS} text-center tabular-nums`}
                            />
                            <button
                              onClick={() => {
                                setComparisonDates(comparisonDates.filter((_, i) => i !== realIndex));
                                setComparisonDateIds(comparisonDateIds.filter((_, i) => i !== realIndex));
                              }}
                              className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-zinc-500 hover:text-red-400 hover:bg-white/5 transition-colors cursor-pointer"
                              aria-label="Убрать дату"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                          </div>
                        </CollapseRow>
                      );
                    })}
                  </AnimatePresence>

                  <button
                    onClick={() => {
                      setComparisonDates([...comparisonDates, '']);
                      setComparisonDateIds([...comparisonDateIds, crypto.randomUUID()]);
                    }}
                    className="h-8 px-2.5 -ml-2.5 inline-flex items-center gap-1.5 rounded-lg text-sm text-zinc-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Добавить исследование
                  </button>
                </div>
              </CollapseRow>
            )}
          </AnimatePresence>
        </ModalBody>
        <ModalFooter>
          <ModalButton onClick={() => setShowComparisonModal(false)}>Отмена</ModalButton>
          <ModalButton
            variant="primary"
            onClick={() => {
              const validDates = comparisonDates.filter(d => isValidDateDDMMYYYY(d));
              if (validDates.length > 0) {
                setComparisonDates(validDates);
                setIsComparisonActive(true);
                setShowComparisonModal(false);
              }
            }}
            disabled={!comparisonDates.some(d => isValidDateDDMMYYYY(d))}
          >
            Применить
          </ModalButton>
        </ModalFooter>
      </AnimatedModal>

      <AnimatedModal
        open={showStateAfterModal}
        onClose={() => setShowStateAfterModal(false)}
        size="lg"
        onKeyDown={(e) => {
          // Esc с видимой ИИ-подсказкой уже обработан полем (скрыл подсказку).
          if (e.key === 'Escape' && !e.defaultPrevented) setShowStateAfterModal(false);
        }}
      >
        <ModalHeader
          title="Примечание"
          onClose={() => setShowStateAfterModal(false)}
          actions={
            <button
              type="button"
              onClick={() => {
                // Текст «Примечания» сохраняется — окно можно открыть снова.
                setShowStateAfterModal(false);
                setPhraseMemoryFieldId(STATE_AFTER_FIELD_ID);
              }}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-sm text-zinc-300 bg-white/5 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              Выученные фразы
            </button>
          }
        />
        <ModalBody>
          {/* То же, что текстовые поля протокола: ИИ дописывает серым после
              курсора по прошлым примечаниям (память фраз — STATE_AFTER_FIELD_ID). */}
          <div className="relative">
            <textarea
              ref={el => {
                stateAfterTextareaRef.current = el;
                if (el) inputRefs.current[STATE_AFTER_FIELD_ID] = el;
              }}
              autoFocus
              value={stateAfterText}
              onChange={e => {
                setStateAfterText(e.target.value);
                setCaret(e.target.selectionStart === e.target.selectionEnd ? { fieldId: STATE_AFTER_FIELD_ID, pos: e.target.selectionStart } : null);
              }}
              onSelect={e => {
                const t = e.currentTarget;
                setCaret(t.selectionStart === t.selectionEnd ? { fieldId: STATE_AFTER_FIELD_ID, pos: t.selectionStart } : null);
              }}
              onFocus={e => {
                const t = e.currentTarget;
                setCaret({ fieldId: STATE_AFTER_FIELD_ID, pos: t.selectionStart });
              }}
              onKeyDown={(e) => {
                if (handleGhostKeyDown(e, STATE_AFTER_FIELD_ID)) return;
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  applyStateAfter();
                }
              }}
              placeholder="Например: состояние после артроскопии"
              className={`w-full bg-white/5 border border-white/10 rounded-xl ${STATE_AFTER_TEXT_CLASS} text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/20 transition-[border-color,height] duration-200 ease-out resize-none`}
              rows={3}
            />
            {ghost?.fieldId === STATE_AFTER_FIELD_ID && (
              <div
                data-ghost-overlay
                aria-hidden="true"
                className={`pointer-events-none absolute inset-x-0 top-0 border border-transparent ${STATE_AFTER_TEXT_CLASS} whitespace-pre-wrap break-words text-transparent`}
              >
                {stateAfterText.slice(0, ghost.pos)}
                <wbr />
                <span className="text-zinc-500">{ghost.ghost}</span>
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
            ИИ дописывает по вашим прошлым примечаниям: <span className="text-zinc-400">→</span> — принять,{' '}
            <span className="text-zinc-400">Ctrl/⌥+→</span> — одно слово, <span className="text-zinc-400">Esc</span> — скрыть.{' '}
            <span className="text-zinc-400">Enter</span> — применить.
          </p>
        </ModalBody>
        <ModalFooter>
          <ModalButton onClick={() => setShowStateAfterModal(false)}>Отмена</ModalButton>
          <ModalButton variant="primary" onClick={applyStateAfter} disabled={!stateAfterText.trim()}>
            Применить
          </ModalButton>
        </ModalFooter>
      </AnimatedModal>


      {/* ====================== АВТОКОРРЕКЦИИ ======================
          Одно слово для функции — "сокращение" (раньше вперемешку
          "автокоррекция"/"аббревиатура"). Редактирование — по клику, а не
          двойному клику (без подсказок угадать его было невозможно);
          действия строк — по наведению, как в билдере. */}
      <AnimatedModal
        open={showAbbrModal}
        onClose={() => setShowAbbrModal(false)}
        size="xl"
        className="h-[min(560px,calc(100vh-2rem))]"
        onKeyDown={(e) => {
          if (e.key === 'Escape') setShowAbbrModal(false);
        }}
      >
        <ModalHeader
          title="Автокоррекции"
          subtitle="Сокращение разворачивается во фразу после пробела или знака препинания"
          onClose={() => setShowAbbrModal(false)}
          actions={
            <>
              <label className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-sm text-zinc-300 bg-white/5 hover:bg-white/10 hover:text-white transition-colors cursor-pointer">
                <Upload className="w-4 h-4" />
                Импорт
                <input type="file" accept=".json" onChange={importAbbreviations} className="hidden" />
              </label>
              <button
                onClick={exportAbbreviations}
                className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-sm text-zinc-300 bg-white/5 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Экспорт
              </button>
            </>
          }
        />

        <div className="flex flex-1 min-h-0">
          {/* Группы */}
          <div className="w-56 shrink-0 border-r border-white/10 p-3 flex flex-col">
            {/* Отступ между строками — pb внутри строки, а не space-y (см.
                CollapseRow). */}
            <div className="flex-1 overflow-y-auto">
              <button
                onClick={() => setSelectedCategory('Все')}
                className={`mb-0.5 w-full h-9 px-3 flex items-center gap-2 rounded-lg text-sm transition-colors cursor-pointer ${
                  selectedCategory === 'Все' ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <span className="flex-1 text-left truncate">Все</span>
                <span className="text-xs text-zinc-500 tabular-nums">{Object.keys(abbreviations).length}</span>
              </button>

              <AnimatePresence initial={false}>
              {categories.map(cat => {
                const count = Object.values(abbreviations).filter(a => a.category === cat).length;
                const isSelected = selectedCategory === cat;
                return (
                  <CollapseRow key={rowId(rowIds.categories, cat)}>
                  <div className="pb-0.5">
                  <div
                    className={`group/row h-9 px-3 flex items-center gap-1.5 rounded-lg text-sm transition-colors ${
                      isSelected ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {editingCategory === cat ? (
                      <input
                        autoFocus
                        type="text"
                        defaultValue={cat}
                        onBlur={(e) => {
                          if (!cancelInlineEditRef.current) renameCategory(cat, e.target.value);
                          setEditingCategory(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                          if (e.key === 'Escape') {
                            e.stopPropagation();
                            cancelInlineEditRef.current = true;
                            setEditingCategory(null);
                          }
                        }}
                        className="flex-1 min-w-0 h-7 -mx-1.5 px-1.5 bg-white/5 rounded-md text-sm text-white focus:outline-none"
                      />
                    ) : (
                      <button
                        onClick={() => setSelectedCategory(cat)}
                        onDoubleClick={() => { cancelInlineEditRef.current = false; setEditingCategory(cat); }}
                        className="flex-1 min-w-0 h-full text-left truncate cursor-pointer"
                      >
                        {cat}
                      </button>
                    )}
                    {editingCategory !== cat && (
                      <>
                        <span className="text-xs text-zinc-500 tabular-nums group-hover/row:hidden">{count}</span>
                        <button
                          onClick={() => { cancelInlineEditRef.current = false; setEditingCategory(cat); }}
                          className="hidden group-hover/row:flex w-6 h-6 items-center justify-center rounded-md text-zinc-500 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                          aria-label="Переименовать группу"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => confirmDeleteCategory(cat)}
                          className="hidden group-hover/row:flex w-6 h-6 items-center justify-center rounded-md text-zinc-500 hover:text-red-400 hover:bg-white/10 transition-colors cursor-pointer"
                          aria-label="Удалить группу"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                  </div>
                  </CollapseRow>
                );
              })}
              </AnimatePresence>
            </div>

            <button
              onClick={addNewGroup}
              className="mt-3 h-9 w-full inline-flex items-center justify-center gap-1.5 rounded-lg text-sm text-zinc-300 bg-white/5 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Группа
            </button>
          </div>

          {/* Сокращения */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="px-4 pt-4 pb-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Поиск по сокращению или фразе"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className={`${MODAL_INPUT_CLASS} pl-9`}
                />
              </div>
            </div>

            {filteredAbbreviations.length > 0 && (
              <div className="flex items-center gap-3 px-7 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                <span className="w-24 shrink-0">Сокращение</span>
                <span className="flex-1">Фраза</span>
                <span className="shrink-0">Использований</span>
                <span className="w-6 shrink-0" aria-hidden="true" />
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 pb-2">
              {filteredAbbreviations.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center px-6">
                  <div className="text-sm font-medium text-zinc-300">
                    {searchTerm ? 'Ничего не найдено' : 'Сокращений пока нет'}
                  </div>
                  <div className="mt-1 max-w-xs text-sm text-zinc-500">
                    {searchTerm
                      ? 'Попробуйте изменить запрос.'
                      : 'Добавьте первое сокращение в строке внизу.'}
                  </div>
                </div>
              )}
              {/* AnimatePresence — всегда, а не вместо пустого состояния:
                  иначе первое сокращение в пустом списке монтировало бы его
                  заново (initial={false}) и появлялось без анимации.
                  key по группе+поиску: при смене фильтра список
                  пересоздаётся без анимации — иначе все строки разом
                  "переливались" бы на каждое нажатие в поиске. Анимируются
                  только добавление и удаление. */}
                <AnimatePresence key={`${selectedCategory}|${searchTerm}`} initial={false}>
                {filteredAbbreviations.map(([abbr, info]) => {
                  const parsed = parseVariants(info.full);
                  return (
                    <CollapseRow key={rowId(rowIds.abbreviations, abbr)}>
                    <div className="group/row flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors text-sm">
                      {editingAbbrKey === abbr ? (
                        <input
                          autoFocus
                          type="text"
                          defaultValue={abbr}
                          onBlur={(e) => {
                            if (!cancelInlineEditRef.current) renameAbbreviation(abbr, e.target.value);
                            setEditingAbbrKey(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') {
                              e.stopPropagation();
                              cancelInlineEditRef.current = true;
                              setEditingAbbrKey(null);
                            }
                          }}
                          className="w-24 shrink-0 h-7 -mx-1.5 px-1.5 bg-white/5 rounded-md text-sm font-medium text-white focus:outline-none"
                        />
                      ) : (
                        <button
                          onClick={() => { cancelInlineEditRef.current = false; setEditingAbbrKey(abbr); }}
                          className="w-24 shrink-0 h-7 -mx-1.5 px-1.5 rounded-md text-left font-medium text-white truncate hover:bg-white/5 cursor-text"
                        >
                          {abbr}
                        </button>
                      )}

                      {editingFullKey === abbr ? (
                        <input
                          autoFocus
                          type="text"
                          defaultValue={info.full}
                          onBlur={(e) => {
                            if (!cancelInlineEditRef.current) updateAbbreviationPhrase(abbr, e.target.value);
                            setEditingFullKey(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') {
                              e.stopPropagation();
                              cancelInlineEditRef.current = true;
                              setEditingFullKey(null);
                            }
                          }}
                          className="flex-1 min-w-0 h-7 -mx-1.5 px-1.5 bg-white/5 rounded-md text-sm text-white focus:outline-none"
                        />
                      ) : (
                        <button
                          onClick={() => { cancelInlineEditRef.current = false; setEditingFullKey(abbr); }}
                          className="flex-1 min-w-0 h-7 -mx-1.5 px-1.5 rounded-md text-left text-zinc-200 hover:bg-white/5 cursor-text flex items-center gap-1.5 overflow-hidden"
                        >
                          {/* Варианты {a|b|c} — метками, а не сырым текстом */}
                          {parsed ? (
                            <>
                              {parsed.prefix && <span className="truncate">{parsed.prefix}</span>}
                              {parsed.variants.map((v, i) => (
                                <span key={i} className="shrink-0 px-1.5 py-0.5 rounded-md bg-white/10 text-xs text-zinc-200">{v}</span>
                              ))}
                            </>
                          ) : (
                            <span className="truncate">{info.full}</span>
                          )}
                        </button>
                      )}

                      {selectedCategory === 'Все' && (
                        <span className="shrink-0 px-2 py-0.5 rounded-md bg-white/5 text-xs text-zinc-400">{info.category}</span>
                      )}

                      <span className="shrink-0 w-[88px] text-right text-xs text-zinc-500 tabular-nums">{info.usage || 0}</span>

                      <button
                        onClick={() => confirmDeleteAbbreviation(abbr)}
                        className="w-6 h-6 shrink-0 flex items-center justify-center rounded-md text-zinc-500 hover:text-red-400 hover:bg-white/10 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 transition-[color,opacity] cursor-pointer"
                        aria-label="Удалить сокращение"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    </CollapseRow>
                  );
                })}
                </AnimatePresence>
            </div>

            {/* Добавление */}
            <div className="px-4 py-3 border-t border-white/10">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newAbbrText}
                  onChange={e => setNewAbbrText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') addNewAbbreviation();
                  }}
                  placeholder="Сокращение"
                  aria-invalid={!!duplicateAbbrKey}
                  className={`${MODAL_INPUT_CLASS.replace('w-full', 'w-36').replace('h-10', 'h-9')} shrink-0 ${
                    duplicateAbbrKey ? 'border-red-400/60! focus:border-red-400/80!' : ''
                  }`}
                />
                <input
                  type="text"
                  value={newFullText}
                  onChange={e => setNewFullText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') addNewAbbreviation();
                  }}
                  placeholder="Фраза"
                  className={MODAL_INPUT_CLASS.replace('h-10', 'h-9')}
                />
                <ModalButton
                  variant="primary"
                  className="shrink-0"
                  onClick={addNewAbbreviation}
                  disabled={!newAbbrText.trim() || !newFullText.trim() || !!duplicateAbbrKey}
                >
                  <Plus className="w-4 h-4" />
                  Добавить
                </ModalButton>
              </div>
              {duplicateAbbrKey ? (
                // Предупреждение о дубле — вместо подсказки о синтаксисе, на
                // её месте, чтобы окно не меняло высоту.
                <p role="alert" className="mt-2 text-xs text-red-400">
                  Сокращение «{duplicateAbbrKey}» уже есть в группе «{abbreviations[duplicateAbbrKey].category}»: «{abbreviations[duplicateAbbrKey].full}».{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategory('Все');
                      setSearchTerm(duplicateAbbrKey);
                    }}
                    className="underline underline-offset-2 hover:text-red-300 cursor-pointer"
                  >
                    Показать
                  </button>
                </p>
              ) : (
                <p className="mt-2 text-xs text-zinc-500">
                  Несколько вариантов — в фигурных скобках через «|»: <span className="text-zinc-400">{'{печень|селезёнка}'}</span> — при вводе появится выбор.
                  {selectedCategory !== 'Все' && <> Добавится в группу «{selectedCategory}».</>}
                </p>
              )}
            </div>
          </div>
        </div>
      </AnimatedModal>

      <AnimatedModal
        open={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        size="sm"
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSaveWithInfo();
        }}
      >
        <ModalHeader
          title="Сохранить протокол"
          subtitle="Имя файла — из ФИО и даты рождения"
          onClose={() => setShowSaveModal(false)}
        />
        <ModalBody className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">ФИО</label>
            <input
              autoFocus
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Иванов Иван Иванович"
              className={MODAL_INPUT_CLASS}
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Дата рождения</label>
            <input
              type="text"
              inputMode="numeric"
              value={birthDate}
              onChange={(e) => setBirthDate(maskDateInput(e.target.value))}
              placeholder="ДД-ММ-ГГГГ"
              maxLength={10}
              className={`${MODAL_INPUT_CLASS} tabular-nums`}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <ModalButton onClick={() => setShowSaveModal(false)}>Отмена</ModalButton>
          <ModalButton variant="primary" onClick={handleSaveWithInfo}>
            <Download className="w-4 h-4" />
            Сохранить
          </ModalButton>
        </ModalFooter>
      </AnimatedModal>
    </div>
  );
}
export default withAuth(FillerPage);