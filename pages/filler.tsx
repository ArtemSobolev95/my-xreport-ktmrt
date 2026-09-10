'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import pb from '../lib/pocketbase';
pb.autoCancellation(false);
import { Copy, Download, ChevronDown, ChevronRight, Settings, Search, Trash2, Home, BookmarkIcon, RotateCcw, XCircle, ChevronsDownUp, Paperclip } from 'lucide-react';
import { 
  ArrowDownOnSquareIcon, 
  ArrowUpOnSquareIcon        
} from '@heroicons/react/24/outline';
import type { BuilderField, QuickButtonGroup, Template } from '../types/builder';
import withAuth from '../components/withAuth';
import UserHeader from '../components/UserHeader';
import { migrateQuickButtons } from '../lib/migrateQuickButtons';
import { evaluateFormula } from '../lib/evaluateFormula';
import { generateReport } from '../lib/generateReport';
import { useAbbreviations } from '../hooks/useAbbreviations';
import { useDialog } from '../components/DialogProvider';

// ====================== МОДУЛЬ РЕЙТИНГА ======================

const RatingField = ({ 
  field, 
  value, 
  onChange, 
  onFocus,
  disabled = false,
}: {
  field: BuilderField;
  value: number;
  onChange: (value: number) => void;
  onFocus: (fieldId: string, el: HTMLElement | null) => void;
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
    <div className="flex gap-2 justify-center">
      {Array.from({ length: field.max || 5 }, (_, i) => {
        const score = i + 1;
        const isActive = value === score;

        return (
          <button
              key={score}
              onClick={() => handleClick(score)}
              tabIndex={disabled ? -1 : 0}
              data-custom-focus
              className={`w-8 h-8 flex items-center justify-center text-sm font-medium rounded-xl transition-all border cursor-pointer
                focus:outline-none focus-visible:border-amber-400 focus-visible:ring-2 focus-visible:ring-amber-400/40
                ${isActive
                  ? 'bg-zinc-800 border-amber-400 text-white shadow-md'
                  : 'bg-transparent border-white/30 hover:border-amber-400 hover:bg-white/5 text-white'
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

// Должно совпадать с duration-200 на карточках полей (см. className ниже,
// где рендерятся карточки) — используется, чтобы не скроллить/фокусировать
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
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Все');
  const [newAbbrText, setNewAbbrText] = useState('');
  const [newFullText, setNewFullText] = useState('');
  const [editingAbbrKey, setEditingAbbrKey] = useState<string | null>(null);
  const [editingFullKey, setEditingFullKey] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: 'category' | 'abbreviation';
    id: string;
    name: string;
  } | null>(null);
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
  const [isMultipleComparison, setIsMultipleComparison] = useState(false);
  const [isStateAfterActive, setIsStateAfterActive] = useState(false);
  const [stateAfterPhrases, setStateAfterPhrases] = useState<string[]>([]);
  const [stateAfterSearch, setStateAfterSearch] = useState('');
  const [pathNav, setPathNav] = useState<{
  groupIdx: number;
  phraseIdx: number;
} | null>(null);


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
  let value = e.target.value.replace(/\D/g, '');

  if (value.length > 8) value = value.slice(0, 8);

  if (value.length >= 5) {
    value = `${value.slice(0, 2)}-${value.slice(2, 4)}-${value.slice(4)}`;
  } else if (value.length >= 3) {
    value = `${value.slice(0, 2)}-${value.slice(2)}`;
  }

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


const focusFieldElement = (fieldId: string) => {
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
    el.focus();
  } else {
    setActiveFieldId(fieldId);
    activeFieldRef.current = fieldId;
  }
};

const openOnlySection = (headerId: string) => {
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

  // Открываем этот раздел, остальные закрываем — анимированно, так же,
  // как и закрытие (раньше здесь стоял setSkipSectionTransition(true),
  // из-за чего открытие происходило мгновенно, без анимации, а закрытие —
  // с анимацией; теперь оба случая ведут себя одинаково).
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

  // Фокус на первое поле — ждём завершения CSS-анимации разворота
  // (см. SECTION_TRANSITION_MS), иначе scrollIntoView внутри
  // focusFieldElement целится в ещё двигающийся элемент и дёргается.
  if (firstFieldId) {
    setTimeout(() => {
      focusFieldElement(firstFieldId!);
    }, SECTION_TRANSITION_MS + 10);
  }
};

// Заголовок раздела в фокусе при Tab-навигации (см. onKeyDown у заголовка
// ниже) — открываем его и закрываем остальные, но, в отличие от
// openOnlySection, фокус остаётся на самом заголовке, а не ныряет в
// первое поле: так Tab можно продолжать листать заголовки один за другим.
const focusHeaderForNav = (headerId: string) => {
  if (!template) return;

  const allHeaderIds = (template.fields || [])
    .filter((f: BuilderField) => f.type === 'header' && !deletedFieldIds.includes(f.id))
    .map((f: BuilderField) => f.id);

  setCollapsedHeaders(new Set(allHeaderIds.filter((id: string) => id !== headerId)));

  const el = document.querySelector(`[data-header-id="${headerId}"]`) as HTMLElement | null;
  el?.focus();
  setTimeout(() => {
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, SECTION_TRANSITION_MS + 10);
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
    openOnlySection(next.headerId);
    return;
  }

  // Shift+Tab с первого поля → предыдущий раздел, последнее поле
  if (e.shiftKey && pos === 0 && isFirstVar) {
    e.preventDefault();
    const prev = sections[sectionIndex - 1];
    if (!prev) return;

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
        inputRefs.current[lastVarKey].focus();
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
    el.style.height = Math.min(el.scrollHeight, 400) + 'px';
  };

  const addTextFieldAfter = (currentId: string) => {
  if (!template) return;
  saveToHistory();

  const newId = 'text-' + Date.now().toString();
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
    'Сбросить протокол к исходному состоянию?\n\nВсе введённые данные будут удалены.',
    { danger: true, confirmText: 'Сбросить' }
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
  resetTextareaHeights();

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

  const confirmed = await dialog.confirm('Очистить черновик? Все введённые данные будут удалены.', {
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
  resetTextareaHeights();
  setIsComparisonActive(false);
  setComparisonDates([]);
  setIsMultipleComparison(false);
  setIsStateAfterActive(false);
  setStateAfterText('');
  setToastMessage(null);
  initializeCollapsedState(originalTemplate.fields);
};
 
    // Закрытие модалок по Escape (работает независимо от фокуса)
  useEffect(() => {
    const anyModalOpen =
      showComparisonModal ||
      showStateAfterModal ||
      showAbbrModal ||
      showNotesModal ||
      showSaveModal ||
      !!deleteConfirm;

    if (!anyModalOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();

      if (showComparisonModal) setShowComparisonModal(false);
      if (showStateAfterModal) setShowStateAfterModal(false);
      if (showAbbrModal) setShowAbbrModal(false);
      if (showNotesModal) setShowNotesModal(false);
      if (showSaveModal) setShowSaveModal(false);
      if (deleteConfirm) setDeleteConfirm(null);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    showComparisonModal,
    showStateAfterModal,
    showAbbrModal,
    showNotesModal,
    showSaveModal,
    deleteConfirm,
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


    // ====================== ЗАГРУЗКА ФРАЗ "СОСТОЯНИЕ ПОСЛЕ" С СЕРВЕРА ======================
  useEffect(() => {
    const loadStateAfterPhrases = async () => {
      if (!pb.authStore.record?.id) return;

      const userId = pb.authStore.record.id;

      try {
        const records = await pb.collection('state_after_phrases').getList(1, 1, {
          filter: `user = "${userId}"`,
          $autoCancel: false
        });

        if (records.items.length > 0) {
          setStateAfterPhrases(records.items[0].phrases || []);
          console.log('✅ Фразы "Состояние после" загружены с сервера');
        } else {
          try {
            // Создаём запись при первом использовании
            await pb.collection('state_after_phrases').create({
              user: userId,
              phrases: []
            });
            setStateAfterPhrases([]);
            console.log('✅ Создана новая запись фраз "Состояние после"');
          } catch {
            // Как и с аббревиатурами: параллельный запрос уже создал запись
            // первым, уникальный индекс на user не даёт создать вторую —
            // читаем то, что уже есть, вместо гонки.
            const records2 = await pb.collection('state_after_phrases').getList(1, 1, {
              filter: `user = "${userId}"`,
              $autoCancel: false
            });
            setStateAfterPhrases(records2.items[0]?.phrases || []);
          }
        }
      } catch (err) {
        console.error("Ошибка загрузки фраз 'Состояние после':", err);
        setStateAfterPhrases([]);
      }
    };
    loadStateAfterPhrases();
  }, []);

    // ====================== СОХРАНЕНИЕ ФРАЗ "СОСТОЯНИЕ ПОСЛЕ" ======================
  const saveStateAfterPhrasesToServer = async (newPhrases: string[]) => {
    if (!pb.authStore.record?.id) return;

    const userId = pb.authStore.record.id;

    try {
      const records = await pb.collection('state_after_phrases').getList(1, 1, {
        filter: `user = "${userId}"`,
        $autoCancel: false
      });

      if (records.items.length > 0) {
        await pb.collection('state_after_phrases').update(records.items[0].id, {
          phrases: newPhrases
        });
      } else {
        try {
          await pb.collection('state_after_phrases').create({
            user: userId,
            phrases: newPhrases
          });
        } catch (createErr) {
          // Гонка: запись уже создана параллельным запросом — обновляем её.
          const retry = await pb.collection('state_after_phrases').getList(1, 1, {
            filter: `user = "${userId}"`,
            $autoCancel: false
          });
          if (retry.items[0]) {
            await pb.collection('state_after_phrases').update(retry.items[0].id, { phrases: newPhrases });
          } else {
            throw createErr;
          }
        }
      }
    } catch (err) {
      console.error("Ошибка сохранения фраз 'Состояние после':", err);
    }
  };

    // ====================== РАБОТА С ФРАЗАМИ "СОСТОЯНИЕ ПОСЛЕ" ======================

    // Добавить новую фразу в список сохранённых
  const addStateAfterPhrase = async () => {
    const text = stateAfterText.trim();
    if (!text || stateAfterPhrases.includes(text)) return;

    const newPhrases = [...stateAfterPhrases, text];
    setStateAfterPhrases(newPhrases);
    await saveStateAfterPhrasesToServer(newPhrases);
    setStateAfterSearch('');
  };

  // Удалить фразу из списка
  const deleteStateAfterPhrase = async (index: number) => {
    const newPhrases = stateAfterPhrases.filter((_, i) => i !== index);
    setStateAfterPhrases(newPhrases);
    await saveStateAfterPhrasesToServer(newPhrases);
  };

    // Добавить выбранную фразу через запятую (накопление)
  const selectStateAfterPhrase = (phrase: string) => {
    let current = stateAfterText.trim();

    // Убираем trailing запятую и пробелы в конце (если есть)
    current = current.replace(/,\s*$/, '').trim();

    let newText;
    if (current) {
      newText = `${current}, ${phrase}`;
    } else {
      newText = phrase;
    }

    setStateAfterText(newText);
  };

  // Фильтрация фраз по отдельному поиску
  const filteredStateAfterPhrases = stateAfterPhrases.filter(phrase =>
    phrase.toLowerCase().includes(stateAfterSearch.toLowerCase())
  );

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
      
      // Миграция quickButtons: старый формат (subgroups) → новый (phrases)
if (Array.isArray(record.fields)) {
  record.fields = record.fields.map((f: BuilderField) => ({
    ...f,
    quickButtons: migrateQuickButtons(f.quickButtons),
  }));
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

        // Удаляем данные удалённых полей
        const currentIds = new Set(record.fields.map((f: BuilderField) => f.id));
        Object.keys(newData).forEach(key => {
          if (!currentIds.has(key)) delete newData[key];
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
  const { finalText, finalPlainText } = useMemo(
    () => generateReport({
      template,
      fieldsData,
      deletedFieldIds,
      isComparisonActive,
      comparisonDates,
      isStateAfterActive,
      stateAfterText,
    }),
    [
      fieldsData,
      template,
      deletedFieldIds,
      isComparisonActive,
      comparisonDates,
      isStateAfterActive,
      stateAfterText
    ]
  );

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

      useEffect(() => {
    if (!activeFieldId) return;

    const raf = requestAnimationFrame(() => {
      const el =
        inputRefs.current[activeFieldId] ||
        (document.querySelector(`[data-field-id="${activeFieldId}"]`) as HTMLElement | null);

      if (el) {
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
  }, [activeFieldId]);

  const handleInputChange = (fieldId: string, value: string) => {
  updateField(fieldId, value, { groupTyping: true });
};

// Автоскролл выбранной фразы при навигации стрелками
useEffect(() => {
  if (!pathNav) return;

  requestAnimationFrame(() => {
    const el = document.querySelector(
      `[data-path-group="${pathNav.groupIdx}"][data-path-phrase="${pathNav.phraseIdx}"]`
    ) as HTMLElement | null;

    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}, [pathNav]);

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
    // Начало поля — всегда с маленькой буквы, без пробела
    finalPhrase = phrase.charAt(0).toLowerCase() + phrase.slice(1);
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

const resetTextareaHeights = () => {
  setTimeout(() => {
    Object.values(inputRefs.current).forEach((el) => {
      if (el && el.tagName === 'TEXTAREA') {
        el.style.height = '30px';        // дефолтная высота
      }
    });
  }, 30);
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
    navigator.clipboard.writeText(finalPlainText).then(
      () => showToast('Скопировано', 1300),
      () => showToast('Не удалось скопировать', 1300)
    );
  };

  const downloadTxt = () => setShowSaveModal(true);

  const handleSaveWithInfo = () => {
    let filename = 'Протокол.txt';
    if (fullName.trim()) filename = fullName.trim().replace(/[^a-zA-Zа-яА-Я0-9]/g, '_');
    if (birthDate.trim()) filename += `_${birthDate.trim()}`;
    filename += '_Протокол.txt';
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

  const addNewAbbreviation = () => {
    if (!newAbbrText || !newFullText) return;
    addNewAbbreviationData(newAbbrText, newFullText, selectedCategory);
    setNewAbbrText('');
    setNewFullText('');
  };

  const deleteCategory = (cat: string) => {
    deleteCategoryData(cat);
    if (selectedCategory === cat) setSelectedCategory('Все');
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
      showSaveModal ||
      deleteConfirm
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
        return;
      }

      setPathNav({ groupIdx: idx, phraseIdx: 0 });
      return;
    }

    if (!pathNav) return;

    // Escape — закрыть
    if (e.key === 'Escape') {
      e.preventDefault();
      setPathNav(null);
      return;
    }

    // Стрелки вниз/вверх по фразам
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setPathNav(prev => {
        if (!prev) return prev;
        const phrases = (groups[prev.groupIdx]?.phrases || []).filter(Boolean);
        return {
          ...prev,
          phraseIdx: Math.min(phrases.length - 1, prev.phraseIdx + 1),
        };
      });
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setPathNav(prev => {
        if (!prev) return prev;
        return { ...prev, phraseIdx: Math.max(0, prev.phraseIdx - 1) };
      });
      return;
    }

    // Enter — вставить фразу
    if (e.key === 'Enter') {
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
  variantSelector,
  showComparisonModal,
  showStateAfterModal,
  showAbbrModal,
  showSaveModal,
  deleteConfirm,
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

    


  return (
    <div className="min-h-screen bg-zinc-950 text-white">
            
        <div className="sticky top-0 z-50 bg-zinc-950 border-b border-white/10">
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
      </div>               

      <div className="max-w-7xl mx-auto px-4 md:px-8 lg:px-12 pt-8 pb-8 grid grid-cols-12 gap-8">
        <div className="col-span-5 space-y-4 pb-64">
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
        <h1 className="text-3xl font-bold mb-6 text-center mx-auto max-w-3xl tracking-tight select-none">{template.title}</h1>
                        <div className="space-y-4">
  {visibleFields.map((f: BuilderField) => {
    const parentHeaderId = f.type !== 'header' ? sectionHeaderMap.get(f.id) : null;
    const isSectionCollapsed = parentHeaderId ? collapsedHeaders.has(parentHeaderId) : false;
    

    return (
      <div
        key={f.id}
        data-field-id={f.id}
        className={`card transition-all ${skipSectionTransition ? 'duration-0' : 'duration-200'} ease-out 
            ${f.type === 'header' || f.type === 'notes'
              ? 'bg-transparent border-0 shadow-none' 
              : 'bg-zinc-900/75 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl'
            }
            ${isSectionCollapsed 
              ? 'grid-rows-[0fr] overflow-hidden border-0 shadow-none bg-transparent py-0 my-0' 
              : 'grid-rows-[1fr] overflow-visible'
            }
            ${newlyAddedId === f.id 
              ? 'opacity-0 max-h-0 mt-0 mb-0 py-0 scale-[0.95]' 
              : ''
            }
            ${removingId === f.id 
              ? 'opacity-0 max-h-0 mt-0 mb-0 py-0 scale-[0.95]' 
              : ''
            }
            ${activeFieldId === f.id
              ? 'border-amber-400 shadow-[0_0_0_4px_rgba(245,158,11,0.3)]' 
              : 'hover:border-white/20'
            }
            relative grid
          `}
          >
      

     {/* === Анимируемая обёртка (вставь сюда) === */}
     <div className="overflow-hidden transition-all duration-200 ease-out">

      <div className={`card-body ${
  f.type === 'header'
    ? 'px-1 py-0'
    : 'px-4 pt-3 pb-3'
}`}>



        {/* Название поля */}
{/* === РЕДАКТИРУЕМЫЙ ЗАГОЛОВОК ДЛЯ ВСЕХ ПОЛЕЙ === */}
                {f.type !== 'header' && f.type !== 'checkbox' && (
          <div className="flex items-center gap-1 mb-1">
    <div className="flex-1 flex justify-center min-w-0">
      <input
        type="text"
        tabIndex={-1}
        value={f.label || ''}
        onChange={(e) => updateFieldLabel(f.id, e.target.value)}
        onFocus={() => handleFocus(f.id, null)}
        onBlur={handleBlur}
        placeholder="Название поля"
        style={{
          width: `${Math.max((f.label || 'Название поля').length + 2, 10)}ch`,
        }}
        className="max-w-full text-center bg-white/10 rounded-lg px-2 py-0.5 text-sm font-medium text-white placeholder:text-zinc-500 focus:outline-none transition-all"
      />
    </div>
    <div className="flex shrink-0">
              <button
                onClick={() => addTextFieldAfter(f.id)}
                tabIndex={-1}
                className="btn btn-ghost btn-square w-5 h-5 min-h-0 text-white hover:text-amber-400 hover:bg-white/10 rounded-md border-0 shadow-none p-0 transition-colors"
                title="Добавить поле"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </button>
              <button
                onClick={() => removeField(f.id)}
                tabIndex={-1}
                className="btn btn-ghost btn-square w-5 h-5 min-h-0 text-white hover:text-red-400 hover:bg-white/10 rounded-md border-0 shadow-none p-0 transition-colors"
                title="Удалить"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </button>
            </div>
          </div>
        )}

      {/* === HEADER — Большой заголовок раздела (с кнопкой сворачивания) === */}
{f.type === 'header' && (
  <div
    role="button"
    tabIndex={0}
    data-header-id={f.id}
    className="py-2 flex items-center justify-between cursor-pointer group select-none outline-none
  rounded-xl px-2
  focus:bg-white/10 focus:text-amber-400
  focus:ring-2 focus:ring-amber-400/40 focus:ring-inset"
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
    <h2 className="text-2xl font-bold text-white tracking-tight flex-1 text-center
  group-hover:text-amber-400 group-focus:text-amber-400 transition-colors select-none">
      {f.label}
    </h2>
    <button
      onClick={(e) => {
        e.stopPropagation();
        openOnlySection(f.id);
      }}
      tabIndex={-1}
      className="btn btn-ghost btn-square btn-lg hover:border-transparent hover:bg-transparent hover:text-amber-400 focus:outline-none focus:ring-0 shadow-none transition-all"
      title={collapsedHeaders.has(f.id) ? 'Развернуть раздел' : 'Свернуть раздел'}
    >
      {collapsedHeaders.has(f.id) ? <ChevronRight size={22} /> : <ChevronDown size={22} />}
    </button>
  </div>
)}
        
        {/* Все поля остаются без изменений */}
        {f.type === 'text' && (
  <textarea
    ref={el => { if (el) inputRefs.current[f.id] = el; }}
    value={fieldsData[f.id] || ''}
    onChange={e => { handleInputChange(f.id, e.target.value); autoResize(e.target); }}
    onKeyDown={e => {
      handleFieldTabNavigation(e, f.id);
      if (!e.defaultPrevented) handleKeyDown(e, f.id);
    }}
    onFocus={(e) => handleFocus(f.id, e.target)}
    onBlur={handleBlur}
    tabIndex={isSectionCollapsed ? -1 : 0}
    rows={1}
    className="w-full bg-transparent border-0 px-1 py-0.5 leading-tight text-white placeholder:text-zinc-400 focus:outline-none focus:bg-white/5 transition-all text-sm resize-none"
    placeholder={f.placeholder || 'Введите значение'}
  />
)}

        {f.type === 'number' && (
          <input
            ref={el => { if (el) inputRefs.current[f.id] = el; }}
            type="text"
            value={fieldsData[f.id] || ''}
            onChange={e => handleInputChange(f.id, e.target.value)}
            onFocus={(e) => handleFocus(f.id, e.target)}
            tabIndex={isSectionCollapsed ? -1 : 0}
            onKeyDown={e => handleFieldTabNavigation(e, f.id)}
            onBlur={handleBlur}
            className="w-20 text-center bg-transparent border-0 px-1 py-0.5 mb-1 text-white placeholder:text-zinc-400 focus:outline-none focus:bg-white/5 transition-all text-sm"
            placeholder={f.placeholder || '0.00'}
          />
        )}

                {f.type === 'checkbox' && (
  <div className="flex items-center gap-1">
    <label
      className="flex flex-1 items-center gap-3 cursor-pointer text-sm group min-w-0"
      onClick={() => handleFocus(f.id, null)}
    >
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
        <span className="w-5 h-5 rounded-md border-2 border-white/40 bg-transparent peer-checked:bg-amber-400 peer-checked:border-amber-400 peer-focus-visible:ring-2 peer-focus-visible:ring-amber-400/40 transition-all flex items-center justify-center">
          {!!fieldsData[f.id] && (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-3.5 h-3.5 text-black"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          )}
        </span>
      </span>
      <span className={`transition-colors ${fieldsData[f.id] ? 'text-amber-400' : 'text-white group-hover:text-amber-400'}`}>
        {f.label}
      </span>
    </label>
    <div className="flex shrink-0">
      <button
        onClick={() => addTextFieldAfter(f.id)}
        tabIndex={-1}
        className="btn btn-ghost btn-square w-5 h-5 min-h-0 text-white hover:text-amber-400 hover:bg-white/10 rounded-md border-0 shadow-none p-0 transition-colors"
        title="Добавить поле"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      </button>
      <button
        onClick={() => removeField(f.id)}
        tabIndex={-1}
        className="btn btn-ghost btn-square w-5 h-5 min-h-0 text-white hover:text-red-400 hover:bg-white/10 rounded-md border-0 shadow-none p-0 transition-colors"
        title="Удалить"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      </button>
    </div>
  </div>
)}

                {f.type === 'select' && (
                  <select
                    ref={el => { if (el) inputRefs.current[f.id] = el; }}
                    value={fieldsData[f.id] || ''}
                    onChange={e => updateField(f.id, e.target.value)}
                    onFocus={() => handleFocus(f.id, null)}
                    onBlur={handleBlur}
                    tabIndex={isSectionCollapsed ? -1 : 0}
                    onKeyDown={e => handleFieldTabNavigation(e, f.id)}
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-none px-5 py-1.5 mb-1 outline-none text-sm cursor-pointer"
                  >
                    <option value="">Выберите вариант...</option>
                    {f.options?.map((opt: string, i: number) => <option key={i} value={opt}>{opt}</option>)}
                  </select>
                )}

                {f.type === 'rating' && <RatingField field={f} value={fieldsData[f.id] || 0} onChange={(val) => updateField(f.id, val)} onFocus={handleFocus} disabled={isSectionCollapsed}/>} 
              </div>
                


                {f.type === 'formula' && (
  <div className="px-3 pt-0 pb-1 space-y-2">
    {/* Переменные */}
    <div className="space-y-1">
      {(f.variables || []).map((v, i: number) => (
        <div key={i} className="flex items-center gap-3">
          <span className="w-8 text-zinc-400 text-sm flex-shrink-0">{v.name}</span>
          <span className="text-zinc-400">=</span>
          <input
            ref={el => { if (el) inputRefs.current[`${f.id}_var_${i}`] = el; }}
            type="text"
            value={fieldsData[`${f.id}_var_${i}`] || ''}
            onChange={e => updateField(`${f.id}_var_${i}`, e.target.value)}
            onFocus={() => handleFocus(f.id, null)}
            onBlur={handleBlur}
            tabIndex={isSectionCollapsed ? -1 : 0}
            onKeyDown={e => handleFieldTabNavigation(e, f.id, { index: i, total: (f.variables || []).length })}
            className="w-20 text-center bg-transparent border-0 px-0 py-0.5 leading-tight text-white text-sm placeholder:text-zinc-400 focus:outline-none focus:bg-white/5 transition-all"
            placeholder="0.00"
          />
        </div>
      ))}
    </div>

    {/* Результат */}
    <div className="pt-2 border-t border-white/10 flex items-baseline gap-3">
      <span className="text-zinc-400 text-sm">Результат</span>
      <span className="text-sm text-white">
        {fieldsData[f.id] || '—'}
      </span>
      {f.unit && <span className="text-zinc-400 text-sm">{f.unit}</span>}
    </div>
  </div>
)}

                
              </div>   

    </div>     
  )
})}
          </div>
        </div>

        <div className="col-span-7 sticky top-20 z-50 self-start h-[calc(100vh-7rem)] relative">
          
          <div className="mb-4 flex gap-3">
             


            </div>

                    <div className="card bg-zinc-900/75 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl max-h-[42vh] flex flex-col min-h-0 overflow-hidden mb-6 p-1 relative">
  
  {/* Градиентная защита от наложения */}
  <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-zinc-900/95 via-zinc-900 to-transparent z-10 pointer-events-none" />
  
    {/* Заметки — левый верхний угол */}
  {notesLinks.length > 0 && (
    <div className="absolute top-4 left-4 z-10">
      <button
        onClick={() => setShowNotesModal(true)}
        tabIndex={-1}
        className="btn btn-ghost btn-square btn-sm text-white hover:text-amber-400 hover:bg-transparent border border-transparent focus:outline-none focus:ring-0 shadow-none transition-all tooltip tooltip-right"
        data-tip="Заметки"
      >
        <Paperclip size={18} />
      </button>
    </div>
  )}
  
  
  {/* Кнопки Сравнение и Состояние в правом верхнем углу */}
  <div className="absolute top-4 right-4 flex gap-2 z-10">
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
      className={`px-4 py-1.5 text-xs font-medium rounded-2xl border transition-all cursor-pointer
        ${isComparisonActive 
          ? 'bg-amber-400/10 border-amber-400 text-amber-400' 
          : 'bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-white/20'
        }`}
    >
      Сравнение
    </button>

    <button
      tabIndex={-1}
      onClick={() => {
        if (isStateAfterActive) {
  setIsStateAfterActive(false);
  // текст не очищаем
} else {
  setStateAfterSearch('');
  setShowStateAfterModal(true);
}
      }}
      className={`px-4 py-1.5 text-xs font-medium rounded-2xl border transition-all cursor-pointer
        ${isStateAfterActive 
          ? 'bg-amber-400/10 border-amber-400 text-amber-400' 
          : 'bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-white/20'
        }`}
    >
      Состояние
    </button>
  </div>

  <div className="flex-1 p-8 pt-14 overflow-auto text-zinc-100 text-[14px] leading-relaxed"
       style={{ lineHeight: '1.65' }}
       dangerouslySetInnerHTML={{ __html: finalText }} 
  />
</div>
            
          
                  
                  {/* Кнопки патологий */}
{activeFieldId && activeField?.quickButtons && activeField.quickButtons.length > 0 && (
  <div className="sticky bottom-0 bg-zinc-950/80 backdrop-blur-xl border-t border-white/10 pt-4 pb-2 z-30">
    <div
      className="flex flex-wrap gap-2"
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => setPathNav(null)}
    >
      {(activeField.quickButtons || []).map((group: QuickButtonGroup, gIdx: number) => {
        const phrases = (group.phrases || []).filter(Boolean);
        const isSinglePhrase = phrases.length === 1;
        const singlePhrase = isSinglePhrase ? phrases[0] : '';

        const isNavOpen = pathNav?.groupIdx === gIdx;

        return (
          <div
            key={group.id}
            className={`dropdown dropdown-hover ${isNavOpen ? 'dropdown-open' : ''}`}
          >
            {/* Кнопка группы */}
            <div
              tabIndex={-1}
              role="button"
              className={`btn btn-ghost btn-sm px-6 py-2.5 text-sm text-white border border-transparent hover:border-transparent hover:bg-transparent hover:text-amber-400 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 shadow-none active:shadow-none transition-all ${
                isNavOpen ? 'text-amber-400 border-amber-400/40' : ''
              }`}
              onClick={() => {
                if (isSinglePhrase && singlePhrase) insertPhrase(singlePhrase);
              }}
            >
              {gIdx < 9 && (
                <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-medium rounded bg-white/10 text-zinc-300 mr-1.5 shrink-0">
                  {gIdx + 1}
                </span>
              )}
              {group.label || 'Группа'}
              {!isSinglePhrase && <ChevronDown size={12} className="ml-1" />}
            </div>

            {/* Список фраз (2-й уровень) */}
            {!isSinglePhrase && (
              <ul
                tabIndex={-1}
                className="dropdown-content menu bg-zinc-900/90 backdrop-blur-md border border-zinc-700 rounded-box z-[10000] min-w-[340px] p-1"
              >
                <div className="max-h-[280px] overflow-y-auto overflow-x-hidden py-1 overscroll-contain scrollbar-thin scrollbar-thumb-zinc-500 scrollbar-track-zinc-900/30">
                  {phrases.map((phrase: string, pIdx: number) => (
                    <li key={pIdx}>
                      <button
                        data-path-group={gIdx}
                        data-path-phrase={pIdx}
                        onClick={() => insertPhrase(phrase)}
                        className={`w-full text-left justify-start hover:bg-zinc-800 text-white text-xs py-3 px-5 rounded-lg transition-colors ${
                          isNavOpen && pathNav?.phraseIdx === pIdx ? 'bg-zinc-800' : ''
                        }`}
                      >
                        {phrase}
                      </button>
                    </li>
                  ))}
                </div>
              </ul>
            )}
          </div>
        );
      })}
    </div>
  </div>
)}

          {/* Нижний ряд кнопок — НЕ фокусируются по Tab */}
          <div className="flex justify-center gap-4 mt-10">
            <button 
                  onClick={toggleAllSections} 
                  tabIndex={-1} 
                  className="btn btn-ghost btn-square btn-lg hover:border-transparent hover:bg-transparent hover:text-amber-400 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 shadow-none active:shadow-none transition-all tooltip" 
                  data-tip="Свернуть/Развернуть текущий раздел (Ctrl+E/Cmd+E)"
                >
                  <ChevronsDownUp size={22} />
                </button>
            <button onClick={copyToClipboard} tabIndex={-1} className="btn btn-ghost btn-square btn-lg hover:border-transparent hover:bg-transparent hover:text-amber-400 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 shadow-none active:shadow-none transition-all tooltip" data-tip="Скопировать (Ctrl+Shift+C)" ><Copy size={22} /></button>
            <button onClick={resetToDefault} tabIndex={-1} className="btn btn-ghost btn-square btn-lg hover:border-transparent hover:bg-transparent hover:text-amber-400 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 shadow-none active:shadow-none transition-all tooltip" data-tip="Сбросить протокол (Ctrl+Shift+R)" ><RotateCcw size={22} /></button>
            <button onClick={downloadTxt} className="btn btn-ghost btn-square btn-lg hover:border-transparent hover:bg-transparent hover:text-amber-400 shadow-none active:shadow-none transition-all tooltip" data-tip="Сохранить" ><Download size={22}/></button>
            <button onClick={goToTemplateList} tabIndex={-1} className="btn btn-ghost btn-square btn-lg hover:border-transparent hover:bg-transparent hover:text-amber-400 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 shadow-none active:shadow-none transition-all tooltip" data-tip="К списку шаблонов (Ctrl+Shift+H)" ><Home size={22} /></button>
            <button onClick={() => setShowAbbrModal(true)} className="btn btn-ghost btn-square btn-lg hover:border-transparent hover:bg-transparent hover:text-amber-400 shadow-none active:shadow-none transition-all tooltip" data-tip="Автокоррекции" ><Settings size={22} /></button>
          </div>
        </div>
      </div>

      {/* МОДАЛКИ (полностью без изменений) */}

                        {showNotesModal && (
        <dialog
          className="modal modal-open"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowNotesModal(false);
          }}
        >
          <div className="modal-box bg-zinc-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl max-w-md mx-4">
            <div className="px-6 pt-5 pb-3 border-b border-white/10">
              <h2 className="text-xl font-semibold text-white">Заметки</h2>
            </div>

            <div className="px-6 py-4 max-h-[60vh] overflow-y-auto space-y-1">
              {notesLinks.filter(link => isSafeUrl(link.url)).map((link, i) => (
                <a
                  key={i}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sm text-white hover:text-amber-400 underline underline-offset-2 transition-all"
                >
                  {link.text}
                </a>
              ))}
            </div>
          </div>

          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setShowNotesModal(false)}>close</button>
          </form>
        </dialog>
      )}



            {showComparisonModal && (
        <dialog 
          className="modal modal-open"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
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
          <div className="modal-box bg-zinc-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl max-w-md mx-4">
            <div className="px-6 pt-5 pb-3 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Сравнение с предыдущим</h2>
            </div>

            <div className="p-6 space-y-4">
              {/* Основная дата */}
              <div>
                
                
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={formatDateToDDMMYYYY(comparisonDates[0] || '')} 
                    onChange={(e) => handleComparisonDateChange(e, 0)}
                    placeholder="ДД-ММ-ГГГГ" 
                    maxLength={10}
                    className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-5 py-3 text-white placeholder:text-zinc-400 focus:outline-none transition-all text-center"
                  />
                </div>
              </div>

              {/* Toggle */}
              <div className="flex items-center justify-between pt-2">
                <span className="text-sm text-zinc-400">Сравнить с несколькими исследованиями</span>
                <label className="relative inline-flex items-center cursor-pointer">
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
                  <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-400"></div>
                </label>
              </div>

              {/* Дополнительные даты */}
              {isMultipleComparison && (
                <div className="space-y-3 pt-2">
                  {comparisonDates.slice(1).map((date, index) => {
                    const realIndex = index + 1;
                    return (
                      <div key={realIndex} className="flex gap-2 items-center">
                        <input 
                          type="text" 
                          value={formatDateToDDMMYYYY(date)} 
                          onChange={(e) => handleComparisonDateChange(e, realIndex)}
                          placeholder="ДД-ММ-ГГГГ" 
                          maxLength={10}
                          className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-5 py-3 text-white placeholder:text-zinc-400 focus:outline-none transition-all text-center"
                        />
                        <button 
                          onClick={() => {
                            const newDates = comparisonDates.filter((_, i) => i !== realIndex);
                            setComparisonDates(newDates);
                          }}
                          className="text-zinc-400 hover:text-red-400 transition-colors p-2 text-xl leading-none cursor-pointer"
                        >
                          -
                        </button>
                      </div>
                    );
                  })}

                  <button 
                    onClick={() => setComparisonDates([...comparisonDates, ''])}
                    className="w-full py-2.5 text-sm border border-transparent text-white/70 hover:text-amber-400 transition-colors cursor-pointer"
                  >
                    Добавить исследование
                  </button>
                </div>
              )}
            </div>

            <div className="px-6 pb-6 pt-2 flex gap-3">
              <button 
                onClick={() => setShowComparisonModal(false)} 
                className="flex-1 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-sm font-medium text-white transition-all cursor-pointer"
              >
                Отмена
              </button>
              <button 
                onClick={() => { 
                  const validDates = comparisonDates.filter(d => isValidDateDDMMYYYY(d));
                  if (validDates.length > 0) { 
                    setComparisonDates(validDates);
                    setIsComparisonActive(true); 
                    setShowComparisonModal(false); 
                  } 
                }} 
                disabled={!comparisonDates.some(d => isValidDateDDMMYYYY(d))}
                className="flex-1 py-3.5 bg-white/5 hover:bg-amber-400/10 border border-white/10 hover:border-amber-400 rounded-2xl text-sm font-medium text-white hover:text-amber-300 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Применить
              </button>
            </div>
          </div>

          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setShowComparisonModal(false)}>close</button>
          </form>
        </dialog>
      )}

                  {showStateAfterModal && (
        <dialog
    className="modal modal-open"
    onKeyDown={(e) => {
      if (e.key === 'Escape') {
        setShowStateAfterModal(false);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        // не перехватываем Enter внутри textarea без модификатора — см. onKeyDown у textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'TEXTAREA') return;

        e.preventDefault();
        let text = stateAfterText.trim();
        if (!text) return;
        if (!text.endsWith('.') && !text.endsWith('!') && !text.endsWith('?')) {
          text += '.';
        }
        setStateAfterText(text);
        setIsStateAfterActive(true);
        setShowStateAfterModal(false);
      }
    }}
  >
          <div className="modal-box bg-zinc-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl max-w-lg mx-4 max-h-[90vh]">
            <div className="px-6 pt-5 pb-3 border-b border-white/10">
              <h2 className="text-xl font-semibold text-white">Состояние после</h2>
            </div>

            <div className="p-6 space-y-4">
              {/* Основное поле (textarea) */}
              <div>
                
                <textarea
  value={stateAfterText}
  onChange={e => setStateAfterText(e.target.value)}
  onKeyDown={(e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      let text = stateAfterText.trim();
      if (!text) return;
      if (!text.endsWith('.') && !text.endsWith('!') && !text.endsWith('?')) {
        text += '.';
      }
      setStateAfterText(text);
      setIsStateAfterActive(true);
      setShowStateAfterModal(false);
    }
  }}
  placeholder="Введите значение или выберите фразу"
  className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3 text-white placeholder:text-zinc-400 focus:outline-none transition-all resize-none"
  rows={3}
/>
              </div>

              {/* Отдельный поиск */}
              <div>
                
                <input
                  type="text"
                  value={stateAfterSearch}
                  onChange={e => setStateAfterSearch(e.target.value)}
                  placeholder="Поиск по фразам"
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3 text-white placeholder:text-zinc-400 focus:outline-none transition-all"
                />
              </div>

              {/* Список фраз */}
              {stateAfterPhrases.length > 0 && (
                <div>
                  
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-2 max-h-[240px] overflow-y-auto">
                    {filteredStateAfterPhrases.length > 0 ? (
                      filteredStateAfterPhrases.map((phrase, index) => {
                        const originalIndex = stateAfterPhrases.indexOf(phrase);
                        return (
                          <div
                            key={originalIndex}
                            onClick={() => selectStateAfterPhrase(phrase)}
                            className="flex items-center justify-between px-4 py-2.5 hover:bg-white/10 rounded-xl cursor-pointer group transition-colors"
                          >
                            <span className="text-sm text-white pr-4">{phrase}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteStateAfterPhrase(originalIndex);
                              }}
                              className="text-zinc-400 hover:text-red-400 opacity-60 group-hover:opacity-100 transition-all p-1 text-xl leading-none cursor-pointer"
                            >
                              -
                            </button>
                          </div>
                        );
                      })
                    ) : (
                      <div className="px-4 py-3 text-sm text-zinc-500 text-center">Ничего не найдено</div>
                    )}
                  </div>
                </div>
              )}

              {/* Кнопка добавления новой фразы в список */}
              {stateAfterText.trim() && !stateAfterPhrases.includes(stateAfterText.trim()) && (
                <button
                  onClick={addStateAfterPhrase}
                  className="w-full py-3 bg-transparent border border-none rounded-2xl text-sm font-medium text-white hover:text-amber-300 transition-all cursor-pointer"
                >
                  Добавить фразу
                </button>
              )}
            </div>

            <div className="px-6 pb-6 pt-2 flex gap-3">
              <button
                onClick={() => setShowStateAfterModal(false)}
                className="flex-1 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-sm font-medium text-white transition-all cursor-pointer"
              >
                Отмена
              </button>
              <button
                onClick={() => {
                  let text = stateAfterText.trim();
                  if (text && !text.endsWith('.') && !text.endsWith('!') && !text.endsWith('?')) {
                    text += '.';
                  }
                  setStateAfterText(text);
                  if (text) {
                    setIsStateAfterActive(true);
                    setShowStateAfterModal(false);
                  }
                }}
                disabled={!stateAfterText.trim()}
                className="flex-1 py-3.5 bg-white/5 hover:bg-amber-400/10 border border-white/10 hover:border-amber-400 rounded-2xl text-sm font-medium text-white hover:text-amber-300 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Применить
              </button>
            </div>
          </div>

          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setShowStateAfterModal(false)}>close</button>
          </form>
        </dialog>
      )}

      {showAbbrModal && (
                    <dialog
    className="modal modal-open"
    onKeyDown={(e) => {
      if (e.key === 'Escape') setShowAbbrModal(false);
    }}
  >
          <div className="modal-box bg-zinc-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl w-full max-w-5xl h-[620px] flex flex-col overflow-hidden">
          

      {/* Шапка модалки — кнопки в правом верхнем углу */}
      <div className="px-6 pt-5 pb-3 border-b border-white/10 relative">
  <h2 className="text-xl font-semibold text-white">Автокоррекции</h2>

  <div className="absolute top-5 right-4 flex items-center gap-1">
    <button
      onClick={exportAbbreviations}
      className="btn btn-ghost btn-square w-9 h-9 text-white hover:border-transparent hover:bg-transparent hover:text-amber-400 focus:outline-none focus:ring-0 shadow-none transition-all tooltip tooltip-bottom"
      data-tip="Экспортировать"
    >
      <ArrowDownOnSquareIcon className="size-5" />
    </button>

    <label
      className="btn btn-ghost btn-square w-9 h-9 text-white hover:border-transparent hover:bg-transparent hover:text-amber-400 focus:outline-none focus:ring-0 shadow-none transition-all tooltip tooltip-bottom"
      data-tip="Импортировать"
    >
      <ArrowUpOnSquareIcon className="size-5" />
      <input type="file" accept=".json" onChange={importAbbreviations} className="hidden" />
    </label>
  </div>
</div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        
        {/* Левая колонка — Группы */}
        <div className="w-64 border-r border-white/10 p-4 flex flex-col">
  <div className="text-xs uppercase text-zinc-400 mb-3 px-2"></div>
  
  <div className="flex-1 overflow-auto space-y-1">
    
    {/* Кнопка "Все" */}
    <div 
      onClick={() => setSelectedCategory('Все')}
      className={`flex items-center px-4 py-2.5 rounded-2xl text-sm cursor-pointer transition-colors ${
        selectedCategory === 'Все' ? 'bg-zinc-700 text-white' : 'hover:bg-white/5 text-zinc-300'
      }`}
    >
      Все
    </div>

    {categories.map(cat => (
      <div 
        key={cat} 
        className={`flex items-center px-4 py-2 rounded-2xl text-sm transition-colors ${
          selectedCategory === cat ? 'bg-zinc-700 text-white' : 'hover:bg-white/5 text-zinc-300'
        }`}
      >
        {/* Текст / Поле редактирования */}
        <div className="flex-1 min-w-0">
          {editingCategory === cat ? (
            <input
              autoFocus
              type="text"
              defaultValue={cat}
              onBlur={(e) => {
                const newName = e.target.value.trim();
                if (newName && newName !== cat) {
                  const newAbbr = { ...abbreviations };
                  Object.keys(newAbbr).forEach(key => {
                    if (newAbbr[key].category === cat) newAbbr[key].category = newName;
                  });
                  const newCats = categories.map(c => c === cat ? newName : c);
                  saveData(newAbbr, newCats);
                  if (selectedCategory === cat) setSelectedCategory(newName);
                }
                setEditingCategory(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setEditingCategory(null);
              }}
              className="w-full bg-transparent border-0 text-white text-sm px-0 focus:outline-none"
            />
          ) : (
            <button 
              onClick={() => setSelectedCategory(cat)}
              onDoubleClick={() => setEditingCategory(cat)}
              className="w-full text-left"
            >
              {cat}
            </button>
          )}
        </div>

        {/* Мусорка — жёстко зафиксирована */}
        <button 
          onClick={() => setDeleteConfirm({ type: 'category', id: cat, name: cat })}
          className="flex-shrink-0 ml-4 text-white hover:text-red-400 transition-colors cursor-pointer"
        >
          <Trash2 size={16} />
        </button>
      </div>
    ))}
  </div>

  {/* Кнопка Добавить группу */}
  <div className="mt-auto pt-4">
    <button 
      onClick={addNewGroup}
      className="w-full py-3.5 bg-white/5 hover:bg-amber-400/10 border border-white/10 hover:border-amber-400 rounded-2xl text-white hover:text-amber-400 text-sm font-medium transition-colors cursor-pointer"
    >
      Добавить
    </button>
  </div>
</div>

        {/* Правая колонка — компактный список аббревиатур */}
<div className="flex-1 flex flex-col">

  {/* Поиск */}
  <div className="p-4 border-b border-white/10">
    <div className="relative">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
      <input 
        type="text" 
        placeholder="Поиск..." 
        value={searchTerm} 
        onChange={e => setSearchTerm(e.target.value)} 
        className="w-full bg-white/5 border border-white/10 rounded-2xl pl-11 pr-6 py-3 text-sm text-white placeholder:text-zinc-400 focus:outline-none"
      />
    </div>
  </div>

  {/* Список аббревиатур */}
  <div className="flex-1 p-2 overflow-auto">
    {filteredAbbreviations.length === 0 ? (
      <p className="text-zinc-400 text-center py-12 text-sm">Ничего не найдено</p>
    ) : (
      filteredAbbreviations.map(([abbr, info]) => (
        <div key={abbr} className="flex items-center gap-4 px-4 py-2.5 hover:bg-white/10 rounded-xl transition-colors text-sm">
          
          {/* Редактирование аббревиатуры */}
          {editingAbbrKey === abbr ? (
            <input
              autoFocus
              type="text"
              defaultValue={abbr}
              onBlur={() => setEditingAbbrKey(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const newAbbr = e.currentTarget.value.trim();
                  if (newAbbr && newAbbr !== abbr) {
                    const newAbbrs = { ...abbreviations };
                    const value = newAbbrs[abbr];
                    delete newAbbrs[abbr];
                    newAbbrs[newAbbr] = value;
                    saveData(newAbbrs, categories);
                  }
                  setEditingAbbrKey(null);
                }
                if (e.key === 'Escape') setEditingAbbrKey(null);
              }}
              className="w-20 bg-transparent border-0 text-white text-sm px-0 focus:outline-none"
            />
          ) : (
            <button onDoubleClick={() => setEditingAbbrKey(abbr)} className="w-20 text-left text-white font-medium">
              {abbr}
            </button>
          )}

          {/* Редактирование полной фразы */}
          {editingFullKey === abbr ? (
            <input
              autoFocus
              type="text"
              defaultValue={info.full}
              onBlur={() => setEditingFullKey(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const newFull = e.currentTarget.value.trim();
                  if (newFull && newFull !== info.full) {
                    const newAbbrs = { ...abbreviations };
                    newAbbrs[abbr].full = newFull;
                    saveData(newAbbrs, categories);
                  }
                  setEditingFullKey(null);
                }
                if (e.key === 'Escape') setEditingFullKey(null);
              }}
              className="flex-1 bg-transparent border-0 text-white text-sm px-0 focus:outline-none"
            />
          ) : (
            <button onDoubleClick={() => setEditingFullKey(abbr)} className="flex-1 text-left text-white">
              {info.full}
            </button>
          )}

          <div className="text-xs bg-white/10 px-3 py-1 rounded-xl text-zinc-300 whitespace-nowrap">
            {info.category}
          </div>

          <div className="text-xs text-zinc-400 font-mono whitespace-nowrap">
            ({info.usage || 0})
          </div>

          <button 
            onClick={() => setDeleteConfirm({ type: 'abbreviation', id: abbr, name: abbr })}
            className="text-white hover:text-red-400 transition-colors cursor-pointer"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))
    )}
  </div>

  {/* Форма добавления новой аббревиатуры */}
  <div className="p-4 border-t border-white/10 flex gap-3">
    <input 
      type="text" 
      value={newAbbrText} 
      onChange={e => setNewAbbrText(e.target.value)} 
      placeholder="Аббревиатура" 
      className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-sm text-white placeholder:text-zinc-400 focus:outline-none"
    />
    <input 
      type="text" 
      value={newFullText} 
      onChange={e => setNewFullText(e.target.value)} 
      placeholder="Фраза" 
      className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-sm text-white placeholder:text-zinc-400 focus:outline-none"
    />
    <button 
      onClick={addNewAbbreviation} 
      className="px-8 bg-white/5 hover:bg-amber-400/10 border border-white/10 hover:border-amber-400 rounded-2xl text-white hover:text-amber-400 text-sm font-medium transition-colors cursor-pointer">
      Добавить
    </button>
  </div>
</div>
      </div>
    </div>

    <form method="dialog" className="modal-backdrop">
      <button onClick={() => setShowAbbrModal(false)}>close</button>
    </form>
  </dialog>
)}

{/* МОДАЛКА ПОДТВЕРЖДЕНИЯ УДАЛЕНИЯ — компактная */}
{deleteConfirm && (
  <dialog className="modal modal-open">
    <div className="modal-box bg-zinc-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl max-w-md">
      <div className="px-6 pt-5 pb-1">
        <h3 className="text-lg font-semibold text-white">
          Удалить {deleteConfirm.type === 'category' ? 'группу' : 'аббревиатуру'}?
        </h3>
        <p className="text-zinc-400 text-sm mt-1">
          {deleteConfirm.type === 'category' 
            ? `"${deleteConfirm.name}" и все аббревиатуры внутри неё будут удалены навсегда.`
            : `"${deleteConfirm.name}" будет удалена навсегда.`}
        </p>
      </div>

      <div className="px-6 py-5 flex gap-3">
        <button
          onClick={() => setDeleteConfirm(null)}
          className="flex-1 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-white text-sm font-medium transition-all cursor-pointer"
        >
          Отмена
        </button>
        <button
          onClick={() => {
            if (deleteConfirm.type === 'category') {
              deleteCategory(deleteConfirm.id);
            } else {
              deleteAbbreviation(deleteConfirm.id);
            }
            setDeleteConfirm(null);
          }}
          className="flex-1 py-3.5 bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-400 rounded-2xl text-white hover:text-red-400 text-sm font-medium transition-all cursor-pointer"
        >
          Удалить
        </button>
      </div>
    </div>

    <form method="dialog" className="modal-backdrop">
      <button onClick={() => setDeleteConfirm(null)}>close</button>
    </form>
  </dialog>
)}

      {showSaveModal && (
                  <dialog className="modal modal-open" onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveWithInfo();
            }}>
              <div className="modal-box bg-zinc-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl max-w-md mx-4">

                <div className="px-6 pt-5 pb-1">
                  <h2 className="text-xl font-semibold text-white">Сохранить</h2>
                </div>

                <div className="px-6 py-5 space-y-5">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">ФИО</label>
                    <input 
                      type="text" 
                      value={fullName} 
                      onChange={(e) => setFullName(e.target.value)} 
                      placeholder="Введите имя" 
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-sm text-white placeholder:text-zinc-400 focus:outline-none transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">Дата рождения (ДД.ММ.ГГГГ)</label>
                    <input 
                      type="text" 
                      value={birthDate} 
                      onChange={(e) => setBirthDate(e.target.value)} 
                      placeholder="Введите дату" 
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-sm text-white placeholder:text-zinc-400 focus:outline-none transition-all"
                    />
                  </div>
                </div>

                <div className="px-6 pb-6 pt-2 flex gap-3">
                  <button 
                    onClick={() => setShowSaveModal(false)} 
                    className="flex-1 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-sm font-medium text-white transition-all"
                  >
                    Отмена
                  </button>
                  <button 
                    onClick={handleSaveWithInfo} 
                    className="flex-1 py-3.5 bg-white/5 hover:bg-amber-400/10 border border-white/10 hover:border-amber-400 rounded-2xl text-sm font-medium text-white hover:text-amber-300 transition-all"
                  >
                    Сохранить
                  </button>
                </div>
              </div>

              {/* backdrop */}
              <form method="dialog" className="modal-backdrop">
                <button onClick={() => setShowSaveModal(false)}>close</button>
              </form>
            </dialog>
          )}
    </div>
  );
}
export default withAuth(FillerPage);