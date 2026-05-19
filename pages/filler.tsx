'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import pb from '../lib/pocketbase';
pb.autoCancellation(false);
import { Copy, Download, ChevronDown, ChevronRight, Settings, Search, Trash2, Home, BookmarkIcon, RotateCcw, XCircle } from 'lucide-react';
import { 
  ArrowDownOnSquareIcon, 
  ArrowUpOnSquareIcon        
} from '@heroicons/react/24/outline';
import type { BuilderField, QuickButtonGroup, QuickButtonSubgroup } from '../types/builder';
import withAuth from '../components/withAuth';
import UserHeader from '../components/UserHeader';

// ====================== МОДУЛЬ РЕЙТИНГА ======================
const RatingField = ({ 
  field, 
  value, 
  onChange, 
  onFocus 
}: {
  field: BuilderField;
  value: number;
  onChange: (value: number) => void;
  onFocus: (fieldId: string, el: HTMLElement | null) => void;
}) => {
  return (
    <div className="flex gap-2 justify-center">
      {Array.from({ length: field.max || 5 }, (_, i) => {
        const score = i + 1;
        const isActive = value === score;
        return (
          <button
            key={score}
            onClick={() => {
              onChange(score);
              onFocus(field.id, null);
            }}
            tabIndex={0}
            className={`w-10 h-10 flex items-center justify-center text-lg font-medium rounded-2xl transition-all border
${isActive
                ? 'bg-zinc-800 border-amber-400 text-white'
                : 'bg-transparent border-white/30 hover:border-amber-400 text-white'
}`}
          >
            {score}
          </button>
        );
      })}
    </div>
  );
};
// ===========================================================================


function FillerPage() {
  const router = useRouter();
  const { id } = router.query;
  const user = pb.authStore.record; // openButtonId и newGroupName больше не используются —
  const [template, setTemplate] = useState<any>(null); // временно оставляем any (тип сложный)
  const [originalTemplate, setOriginalTemplate] = useState<any>(null);
  const [fieldsData, setFieldsData] = useState<Record<string, any>>({});
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const activeFieldRef = useRef<string | null>(null);
  const activeInputRef = useRef<HTMLElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletedFieldIds, setDeletedFieldIds] = useState<string[]>([]);
  const [abbreviations, setAbbreviations] = useState<Record<string, { full: string; category: string; usage: number }>>({});
  const [categories, setCategories] = useState<string[]>([]);
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
} | null>(null);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>>({});
  const [initialized, setInitialized] = useState(false);
  const [newlyAddedId, setNewlyAddedId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isComparisonActive, setIsComparisonActive] = useState(false);
  const [comparisonDate, setComparisonDate] = useState('');
  const [isStateAfterActive, setIsStateAfterActive] = useState(false);
  const [stateAfterText, setStateAfterText] = useState('');
  const [showComparisonModal, setShowComparisonModal] = useState(false);
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


  const saveToHistory = () => {
    setHistory(prev => {
      const snapshot = {
        fieldsData: { ...fieldsData },
        deletedFieldIds: [...deletedFieldIds]   // массив!
      };
      const newHistory = [...prev, snapshot];
      return newHistory.slice(-MAX_HISTORY);
    });
  };

  const undo = () => {
    if (history.length === 0) return;
    const lastState = history[history.length - 1];
    setFieldsData(lastState.fieldsData);
    setDeletedFieldIds([...lastState.deletedFieldIds]);   // массив!
    setHistory(prev => prev.slice(0, -1));
  };

  const autoResize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 400) + 'px';
  };

  const addTextFieldAfter = (currentId: string) => {
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
    setTemplate(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        fields: prev.fields.map((f: BuilderField) =>
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

  const resetToDefault = () => {
    if (!originalTemplate) return;
    saveToHistory();
    setTemplate(JSON.parse(JSON.stringify(originalTemplate)));
    setDeletedFieldIds([]);
    const init: Record<string, any> = {};
    originalTemplate.fields.forEach((f: BuilderField) => {
      if (f.defaultValue !== undefined) init[f.id] = f.defaultValue;
      else if (f.type === 'checkbox') init[f.id] = false;
      else if (f.type === 'rating') init[f.id] = 0;
      else init[f.id] = '';
    });
    setFieldsData(init);
    setIsComparisonActive(false);
    setComparisonDate('');
    setIsStateAfterActive(false);
    setStateAfterText('');
  };
 
  
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


            // ====================== ЗАГРУЗКА АББРЕВИАТУР ======================
  useEffect(() => {
    const loadAbbr = async () => {
      if (!pb.authStore.record?.id) return;

      const userId = pb.authStore.record.id;

      try {
        const records = await pb.collection('abbreviations').getList(1, 1, {
          filter: `user = "${userId}"`,
          $autoCancel: false
        });

        if (records.items.length > 0) {
          const record = records.items[0];
          setAbbreviations(record.abbreviations || {});
          setCategories(record.categories || ['Общие']);
          console.log('✅ Аббревиатуры загружены');
        } else {
          throw { status: 404 };
        }
      } catch (err: unknown) {
        const error = err as any;
        if (error?.status === 404) {
          const defaultData = {
            user: userId,
            abbreviations: {},
            categories: []
          };
          const newRecord = await pb.collection('abbreviations').create(defaultData);
          setAbbreviations(newRecord.abbreviations);
          setCategories(newRecord.categories);
          console.log('✅ Создана новая запись аббревиатур');
        } else {
          console.error("Ошибка загрузки:", err);
          setAbbreviations({});
          setCategories(['Общие']);
        }
      }
    };
    loadAbbr();
  }, []);

              // ====================== СОХРАНЕНИЕ АББРЕВИАТУР ======================
  const saveData = async (newAbbr: Record<string, any>, newCats: string[]) => {
    setAbbreviations(newAbbr);
    setCategories(newCats);

    if (!pb.authStore.record?.id) return;

    const userId = pb.authStore.record.id;
    const payload = {
      abbreviations: newAbbr,
      categories: newCats,
      user: userId
    };

    try {
      const records = await pb.collection('abbreviations').getList(1, 1, {
        filter: `user = "${userId}"`,
        $autoCancel: false
      });

      if (records.items.length > 0) {
        await pb.collection('abbreviations').update(records.items[0].id, payload);
        console.log('✅ Аббревиатуры обновлены');
      } else {
        await pb.collection('abbreviations').create(payload);
        console.log('✅ Аббревиатуры созданы');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("❌ Ошибка сохранения:", errorMessage);
    }
  };


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

    const loadTemplate = async () => {
      try {
        const record = await pb.collection('templates').getOne(id as string, { 
          $autoCancel: false 
        });

        // Проверяем доступ
        const ownerId = typeof record.user === 'string' ? record.user : record.user?.id || '';
        if (ownerId !== pb.authStore.record?.id && !record.isPublic) {
          alert('У вас нет доступа к этому шаблону');
          router.push('/');
          return;
        }

        setOriginalTemplate(JSON.parse(JSON.stringify(record)));
        setTemplate(record);

        const init: Record<string, any> = {};
        record.fields.forEach((f: BuilderField) => {
          if (f.defaultValue !== undefined) init[f.id] = f.defaultValue;
          else if (f.type === 'checkbox') init[f.id] = false;
          else if (f.type === 'rating') init[f.id] = 0;
          else init[f.id] = '';
        });

        setFieldsData(init);
      } catch (err) {
        console.error("Ошибка загрузки шаблона:", err);
        alert("Шаблон не найден или у вас нет доступа");
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

        const varMap = Object.fromEntries(
          f.variables.map((v, i: number) => {
            const raw = fieldsData[`${f.id}_var_${i}`] || v.value || '';
            return [v.name, parseFloat(raw) || 0];
          })
        );

        const func = new Function(...Object.keys(varMap), `return ${f.formula};`);
        const result = func(...Object.values(varMap));

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

  const isFieldEmpty = (field: BuilderField, value: any): boolean => {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (field.type === 'rating') return value == 0 || value === null || value === undefined;
  return false;
};

      // ====================== ГЕНЕРАЦИЯ ОТЧЁТА (useMemo) ======================
  const { finalText, finalPlainText } = useMemo(() => {
    if (!template) return { finalText: '', finalPlainText: '' };

    let htmlText = '';
    let plainText = '';

    if (isComparisonActive && comparisonDate) {
      htmlText += `<span class="text-amber-400">Описание исследования в сравнении с предыдущим от ${comparisonDate}:</span>\n\n`;
      plainText += `Описание исследования в сравнении с предыдущим от ${comparisonDate}:\n\n`;
    }
    if (isStateAfterActive && stateAfterText) {
      htmlText += `<span class="text-amber-400">Состояние после ${stateAfterText}</span>\n\n`;
      plainText += `Состояние после ${stateAfterText}\n\n`;
    }

    template.fields.forEach((f: BuilderField) => {
        if (deletedFieldIds.includes(f.id)) return;

        if (f.type === 'header') return;

        const val = fieldsData[f.id];

        
        if (f.type === 'text' && isFieldEmpty(f, val) && !f.placeholder) {
          return;
        }

        let displayHtml = val || '';
        let displayPlain = val || '';

        if (!val && f.placeholder) {
          displayHtml = `<span style="color: #9ca3af;">${f.placeholder}</span>`;
          displayPlain = f.placeholder;
        }

        let coloredHtml = displayHtml;
        if (val && ['text', 'number', 'select', 'checkbox', 'formula', 'comparison'].includes(f.type)) {
          coloredHtml = `<span class="text-amber-400">${val}</span>`;
        }

        if (f.type === 'text') {
      const finalHtml = val ? coloredHtml : displayHtml;
      const finalPlain = displayPlain;

      htmlText += `${f.label}: ${finalHtml}\n\n`;
      plainText += `${f.label}: ${finalPlain}\n\n`;
    }


      else if (f.type === 'checkbox') {
        const isChecked = fieldsData[f.id] === true;
        const checkboxText = isChecked ? (f.checkedPhrase || 'Да') : (f.uncheckedPhrase || 'Нет');
        htmlText += `${f.label}: <span class="text-amber-400">${checkboxText}</span>\n\n`;
        plainText += `${f.label}: ${checkboxText}\n\n`;
      }
      else if (f.type === 'number') {
        if (!val) return;
        const unitHtml = f.unit ? ` <span class="text-amber-400">${f.unit}</span>.` : '.';
        const unitPlain = f.unit ? ` ${f.unit}.` : '.';
        htmlText += `${f.label}: <span class="text-amber-400">${val}</span>${unitHtml}\n\n`;
        plainText += `${f.label}: ${val}${unitPlain}\n\n`;
      }
      else if (f.type === 'select') {
        if (!val) return;
        htmlText += `${f.label}: ${coloredHtml}\n\n`;
        plainText += `${f.label}: ${val}\n\n`;
      } 
      else if (f.type === 'rating') {
        if (!val || val === 0) return;
        const expl = f.showExplanations && f.explanations ? ` — ${f.explanations[val - 1] || ''}` : '';
        htmlText += `${f.label}: <span class="text-amber-400">${val}${expl}</span>\n\n`;
        plainText += `${f.label}: ${val}${expl}\n\n`;
      } 
      else if (f.type === 'formula') {
        const hasAnyValue = (f.variables || []).some((v: any, i: number) => 
          fieldsData[`${f.id}_var_${i}`] && String(fieldsData[`${f.id}_var_${i}`]).trim() !== ''
        );
        if (!hasAnyValue) return;

        const result = val || '';
        if (!result || result === 'NaN') return;

        const unitHtml = f.unit ? ` <span class="text-amber-400">${f.unit}</span>.` : '.';
        const unitPlain = f.unit ? ` ${f.unit}.` : '.';
        htmlText += `${f.label}: <span class="text-amber-400">${result}</span>${unitHtml}\n\n`;
        plainText += `${f.label}: ${result}${unitPlain}\n\n`;
      }
      else if (f.type === 'comparison') {
        const headerText = fieldsData[`${f.id}_header`] || f.label || '';
        const hasAnyValue = (f.items || []).some((item) => {
          const v = fieldsData[`${f.id}_val_${item.id}`] || item.value || '';
          const p = fieldsData[`${f.id}_prev_${item.id}`] || item.previous || '';
          return v.trim() || p.trim();
        });
        if (!hasAnyValue) return;

        if (headerText) {
          htmlText += `${headerText}:\n`;
          plainText += `${headerText}:\n`;
        }

        (f.items || []).forEach((item) => {
          const valuePart = fieldsData[`${f.id}_val_${item.id}`] || item.value || '';
          const previousPart = fieldsData[`${f.id}_prev_${item.id}`] || item.previous || '';
          htmlText += `<span class="text-amber-400">${item.number}. ${valuePart}, ранее ${previousPart}.</span>\n`;
          plainText += `${item.number}. ${valuePart}, ранее ${previousPart}.\n`;
        });
        htmlText += '\n';
        plainText += '\n';
      }
    });

    return {
      finalText: htmlText.trim(),
      finalPlainText: plainText.trim()
    };
  }, [
    fieldsData,
    template,
    deletedFieldIds,
    isComparisonActive,
    comparisonDate,
    isStateAfterActive,
    stateAfterText
  ]);

  const updateField = (fieldId: string, value: any) => {   // value может быть string | number | boolean
    saveToHistory();
    setFieldsData(prev => ({ ...prev, [fieldId]: value }));
  };

  const handleFocus = (fieldId: string, el: HTMLElement | null) => {
  // Извлекаем основной ID карточки
  let mainId = fieldId;
  if (fieldId.includes('_')) {
    mainId = fieldId.split('_')[0];
  }

  setActiveFieldId(mainId);
  activeFieldRef.current = mainId;
  activeInputRef.current = el;
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

  const handleInputChange = (fieldId: string, value: string) => {
  saveToHistory();
  updateField(fieldId, value);
};

const insertPhrase = (phrase: string) => {
  const fieldId = activeFieldRef.current;
  if (!fieldId) {
    alert('Поставьте курсор в нужное текстовое поле слева');
    return;
  }

  const inputEl = inputRefs.current[fieldId] as HTMLTextAreaElement | undefined;
  if (!inputEl) return;

  const start = inputEl.selectionStart ?? 0;
  const end = inputEl.selectionEnd ?? start;
  const current = inputEl.value || '';

  const newText = current.substring(0, start) + phrase + current.substring(end);
  const newCursorPos = start + phrase.length;

  saveToHistory();
  updateField(fieldId, newText);

  // Восстанавливаем курсор + растягиваем textarea
  requestAnimationFrame(() => {
    const el = inputRefs.current[fieldId] as HTMLTextAreaElement | undefined;
    if (el) {
      el.focus();
      el.setSelectionRange(newCursorPos, newCursorPos);

      // === Главное исправление: вызываем autoResize ===
      autoResize(el);

      // Дополнительная страховка на случай длинных фраз
      setTimeout(() => {
        autoResize(el);
      }, 10);
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

  const { fieldId, variants, prefix, trigger } = variantSelector;
  const chosen = variants[index];

  const textarea = inputRefs.current[fieldId] as HTMLTextAreaElement | undefined;
  if (!textarea) return;

  const currentValue = textarea.value;
  const newText = prefix + chosen + trigger + currentValue.substring(variantSelector.startPos);

  saveToHistory();
  updateField(fieldId, newText);

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

  saveToHistory();
  updateField(fieldId, newText);

  const updated = JSON.parse(JSON.stringify(abbreviations));
  updated[wordLower].usage = (updated[wordLower].usage || 0) + 1;
  saveData(updated, categories);

  requestAnimationFrame(() => {
    const el = inputRefs.current[fieldId] as HTMLTextAreaElement | undefined;
    if (el) {
      el.focus();
      el.setSelectionRange(newCursorPos, newCursorPos);
      autoResize(el);
    }
  });
};

  const copyToClipboard = () => navigator.clipboard.writeText(finalPlainText);

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

  const exportAbbreviations = () => {
    const dataStr = JSON.stringify({ abbreviations, categories }, null, 2);
    const link = document.createElement('a');
    link.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    link.download = 'xreport-abbreviations.json';
    link.click();
  };

    const importAbbreviations = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        saveData(imported.abbreviations || {}, imported.categories || ['Общие']);
        alert('✅ Импорт выполнен!');
      } catch { 
        alert('Ошибка импорта'); 
      }
    };
    reader.readAsText(file);
  };

  const addNewGroup = () => {
    let newName = 'Новая группа';
    let counter = 1;

    // Делаем уникальное имя, если уже есть "Новая группа"
    while (categories.includes(newName)) {
      counter++;
      newName = `Новая группа ${counter}`;
    }

    saveData(abbreviations, [...categories, newName]);
    setSelectedCategory(newName); // сразу выбираем новую группу
  };

  const addNewAbbreviation = () => {
    if (!newAbbrText || !newFullText) return;
    const cat = selectedCategory !== 'Все' ? selectedCategory : 'Общие';
    saveData({ ...abbreviations, [newAbbrText]: { full: newFullText, category: cat, usage: 0 } }, categories);
    setNewAbbrText('');
    setNewFullText('');
  };


  const deleteCategory = (cat: string) => {
  // Удаляем все аббревиатуры из этой группы
    const newAbbr = { ...abbreviations };
    Object.keys(newAbbr).forEach(key => {
      if (newAbbr[key].category === cat) {
        delete newAbbr[key];
      }
    });

    // Удаляем саму группу
    const newCats = categories.filter(c => c !== cat);
    saveData(newAbbr, newCats);

    if (selectedCategory === cat) setSelectedCategory('Все');
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

        if (loading) return (
    <div className="min-h-screen bg-zinc-950 text-white p-8 flex items-center justify-center">
      <div className="text-2xl">Проверка доступа...</div>
    </div>
  );

  if (!template) return (
    <div className="min-h-screen bg-zinc-950 text-white p-8 flex items-center justify-center">
      <div className="text-2xl">Шаблон не найден</div>
    </div>
  );

    const visibleFields = template.fields.filter((f: BuilderField) => !deletedFieldIds.includes(f.id));

  const activeField = template?.fields?.find((f: BuilderField) => f.id === activeFieldId);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
            
        <div className="sticky top-0 z-50 bg-zinc-950 border-b border-white/10">
        <UserHeader />
      </div>

                     

      <div className="max-w-7xl mx-auto px-4 md:px-8 lg:px-12 pt-8 pb-8 grid grid-cols-12 gap-8">
        <div className="col-span-5 space-y-4">
          {variantSelector && (
            <div
              className="fixed z-[99999] bg-zinc-900/10 backdrop-blur-md rounded-xl shadow-xl py-1 min-w-[180px]"
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
                      : 'text-white hover:bg-white/10 hover:border rounded-xl'
                  }`}
                >
                  {variant}
                </button>
              ))}
            </div>
          )}
        <h1 className="text-3xl font-bold mb-6 text-center mx-auto max-w-3xl tracking-tight">{template.title}</h1>
        <div className="space-y-4">
  {visibleFields.map((f: BuilderField) => (
    <div
  key={f.id}
  data-field-id={f.id}
  className={`card transition-all duration-250 ease-out rounded-2xl overflow-visible
    ${f.type === 'header' || f.type === 'notes'
      ? 'bg-transparent border-0 shadow-none' 
      : 'bg-zinc-900/75 backdrop-blur-2xl border border-white/10 shadow-2xl'
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
    relative`}
>
      {/* Кнопки управления — правый верхний угол */}
     {f.type !== 'header' && f.type !== 'notes' && ( 
      <div className="absolute top-4 right-4 flex gap-0 z-20">
        {/* Сначала кнопка ДОБАВИТЬ */}
        <button
          onClick={() => addTextFieldAfter(f.id)}
          tabIndex={-1}
          className="btn btn-ghost btn-square w-6 h-6 text-white hover:text-amber-400 hover:bg-transparent border border-transparent focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 shadow-none active:shadow-none transition-all tooltip" data-tip="Добавить поле">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
        </button>

        {/* Потом кнопка УДАЛИТЬ */}
        <button
          onClick={() => removeField(f.id)}
          tabIndex={-1}
          className="btn btn-ghost btn-square w-6 h-6 text-white hover:text-red-400 hover:bg-transparent border border-transparent focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 shadow-none active:shadow-none transition-all tooltip" data-tip="Удалить">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </button>
      </div>
     )}

      <div className="card-body p-5 pt-12">   {/* pt-12 — отступ сверху под кнопки */}
        {/* Название поля */}
{f.type !== 'checkbox' && f.type !== 'header' && (
  <>
    {f.isQuickText ? (
      // === РЕДАКТИРУЕМЫЙ ЗАГОЛОВОК (для полей, добавленных через +) ===
      <input
        type="text"
        value={f.label || ''}
        onChange={(e) => updateFieldLabel(f.id, e.target.value)}
        onFocus={() => handleFocus(f.id, null)}
        onBlur={handleBlur}
        placeholder="Введите значение"
        className="w-full text-center bg-transparent px-0 py-1 mb-2 text-sm font-medium text-white placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none transition-all"
      />
    ) : (
      // === Статичное название (для полей из шаблона) ===
      <label className="block text-white text-sm mb-2 font-medium text-center">
        {f.label}
      </label>
    )}
  </>
)}

        {/* Все поля остаются без изменений */}
        {f.type === 'text' && (
          <textarea
            ref={el => { if (el) inputRefs.current[f.id] = el; }}
            value={fieldsData[f.id] || ''}
            onChange={e => { handleInputChange(f.id, e.target.value); autoResize(e.target); }}
            onKeyDown={e => handleKeyDown(e, f.id)}
            onFocus={(e) => handleFocus(f.id, e.target)}
            onBlur={handleBlur}
            className="w-full bg-transparent border-0 border-b-2 border-zinc-600 px-0 py-0 text-white placeholder:text-zinc-400 hover:border-zinc-400 focus:border-amber-400 focus:outline-none focus:bg-white/5 transition-all text-sm resize-none"
            placeholder={f.placeholder || 'Введите значение'}
            style={{ minHeight: '30px' }}
          />
        )}

        {f.type === 'number' && (
          <input
            ref={el => { if (el) inputRefs.current[f.id] = el; }}
            type="text"
            value={fieldsData[f.id] || ''}
            onChange={e => handleInputChange(f.id, e.target.value)}
            onFocus={(e) => handleFocus(f.id, e.target)}
            onBlur={handleBlur}
            className="w-20 text-center bg-transparent border-0 border-b-2 border-zinc-600 px-0 py-2 text-white placeholder:text-zinc-400 hover:border-zinc-400 focus:border-amber-400 focus:outline-none focus:bg-white/5 transition-all text-sm"
            placeholder={f.placeholder || '0.00'}
          />
        )}

                {f.type === 'checkbox' && (
                <label 
                  className="flex items-center gap-3 cursor-pointer text-sm group mb-6"
                  onClick={() => handleFocus(f.id, null)}
                >
                  <input
                    ref={el => { if (el) inputRefs.current[f.id] = el; }}
                    type="checkbox"
                    checked={!!fieldsData[f.id]}
                    onChange={e => updateField(f.id, e.target.checked)}
                    onFocus={() => handleFocus(f.id, null)}
                    onBlur={handleBlur}
                    className="w-5 h-5 accent-amber-400 border-2 border-white/40 bg-transparent rounded 
                              focus:ring-2 focus:ring-amber-400/30 focus:outline-none transition-all cursor-pointer"
                  />
                  
                  <span 
                      className={`transition-colors ${
                        fieldsData[f.id] 
                          ? 'text-amber-400' 
                          : 'text-white group-hover:text-amber-400'
                      }`}
                    >
                      {f.label}
                    </span>
                </label>
              )}

                {f.type === 'select' && (
                  <select
                    ref={el => { if (el) inputRefs.current[f.id] = el; }}
                    value={fieldsData[f.id] || ''}
                    onChange={e => updateField(f.id, e.target.value)}
                    onFocus={() => handleFocus(f.id, null)}
                    onBlur={handleBlur}
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-none px-5 py-3 outline-none text-sm cursor-pointer"
                  >
                    <option value="">Выберите вариант...</option>
                    {f.options?.map((opt: string, i: number) => <option key={i} value={opt}>{opt}</option>)}
                  </select>
                )}

                {f.type === 'rating' && <RatingField field={f} value={fieldsData[f.id] || 0} onChange={(val) => updateField(f.id, val)} onFocus={handleFocus}/>} 
              </div>
                {f.type === 'notes' && (
                  <div>
                    <div className="flex items-center justify-center gap-1 pt-0 pb-6">
                      <BookmarkIcon className="w-6 h-6" />
                      <span className="font-semibold text-2xl">Заметки</span>
                    </div>
                    {f.notes && (
                      <div className="space-y-3 pb-10">
                        {f.notes.split('\n').filter(Boolean).map((line, i) => {
                          const match = line.match(/\[(.*?)\]\((.*?)\)/);
                          if (match) {
                            const [, text, url] = match;
                            return <div key={i} className="border border-transparent rounded-none px-5 py-0"><a href={url} target="_blank" rel="noopener noreferrer" className="block text-white hover:text-amber-400 underline text-sm transition-all">{text}</a></div>;
                          }
                          return <div key={i} className="text-zinc-300 text-sm border border-transparent rounded-none px-4 py-3">{line}</div>;
                        })}
                      </div>
                    )}
                  </div>
                )}

                {f.type === 'formula' && (
                    <div className="px-6 pt-2 pb-6 space-y-4">
                      
                      {/* Переменные */}
                      <div className="space-y-5">
                        {(f.variables || []).map((v: any, i: number) => (
                          <div key={i} className="flex items-center gap-4">
                            <span className="w-12 text-zinc-400 text-sm flex-shrink-0">{v.name}</span>
                            <span className="text-zinc-400">=</span>
                            <input
                              ref={el => { if (el) inputRefs.current[`${f.id}_var_${i}`] = el; }}
                              type="text"
                              value={fieldsData[`${f.id}_var_${i}`] || ''}
                              onChange={e => updateField(`${f.id}_var_${i}`, e.target.value)}
                              onFocus={() => handleFocus(f.id, null)}
                              onBlur={handleBlur}
                              className="w-20 text-center bg-transparent border-0 border-b-2 border-white/20 px-0 py-2 text-white text-sm 
                       hover:border-zinc-400 focus:border-amber-400 focus:outline-none focus:bg-white/5 transition-all"
                              placeholder="0.00"
                            />
                          </div>
                        ))}
                      </div>

                      {/* Результат */}
                      <div className="pt-6 border-t border-white/10 flex items-baseline gap-3">
                        <span className="text-zinc-400 text-sm">Результат</span>
                        <span className="text-sm text-white">
                          {fieldsData[f.id] || '—'}
                        </span>
                        {f.unit && <span className="text-zinc-400 text-sm">{f.unit}</span>}
                      </div>
                    </div>
                  )}

                {f.type === 'comparison' && (
  <div className="px-6 pt-1 pb-6 space-y-6">

    <input
      ref={el => { if (el) inputRefs.current[`${f.id}_header`] = el; }}
      type="text"
      value={fieldsData[`${f.id}_header`] || f.label || ''}
      onChange={e => updateField(`${f.id}_header`, e.target.value)}
      onFocus={() => handleFocus(`${f.id}_header`, null)}
      onBlur={handleBlur}
      className="w-full text-sm bg-transparent border-0 border-b-2 border-white/20 px-0 py-3 text-white text-center text-base hover:border-zinc-400 focus:border-amber-400 focus:outline-none focus:bg-white/5 transition-all"
      placeholder="Введите значение"
    />

    <div className="space-y-3">
      {(f.items || []).map((item) => (
        <div key={item.id} className="flex items-center gap-4">
          <span className="font-medium text-zinc-400 w-6 text-sm">{item.number}.</span>

          <input
            type="text"
            value={fieldsData[`${f.id}_val_${item.id}`] || item.value || ''}
            onChange={e => updateField(`${f.id}_val_${item.id}`, e.target.value)}
            onFocus={() => handleFocus(`${f.id}_val_${item.id}`, null)}
            onBlur={handleBlur}
            className="w-full text-sm bg-transparent border-0 border-b-2 border-white/20 px-0 py-2 text-white hover:border-zinc-400 focus:border-amber-400 focus:outline-none focus:bg-white/5 transition-all"
            placeholder="Текущее значение"
          />

          <span className="text-zinc-400 text-sm whitespace-nowrap">ранее</span>

          <input
            type="text"
            value={fieldsData[`${f.id}_prev_${item.id}`] || item.previous || ''}
            onChange={e => updateField(`${f.id}_prev_${item.id}`, e.target.value)}
            onFocus={() => handleFocus(`${f.id}_prev_${item.id}`, null)}
            onBlur={handleBlur}
            className="w-full text-sm bg-transparent border-0 border-b-2 border-white/20 px-0 py-2 text-white hover:border-zinc-400 focus:border-amber-400 focus:outline-none focus:bg-white/5 transition-all"
            placeholder="Предыдущее значение"
          />

          <button
            onClick={() => {
              const currentItems = f.items || [];
              const newItems = currentItems.filter((i) => i.id !== item.id);
              const newFields = (template.fields as BuilderField[]).map((field) =>
                field.id === f.id ? { ...field, items: newItems } : field
              );
              setTemplate({ ...template, fields: newFields });
            }}
            tabIndex={-1}
            className="text-white hover:text-red-400 transition-colors cursor-pointer"
          >
            <Trash2 size={18} />
          </button>
        </div>
      ))}
    </div>

    <button
      onClick={() => {
        const currentItems = f.items || [];
        const maxNumber = Math.max(...currentItems.map((i) => i.number || 0), 0);
        const newItem = { id: Date.now().toString(), number: maxNumber + 1, value: '', previous: '' };
        const newFields = template.fields.map((field: BuilderField) =>
          field.id === f.id ? { ...field, items: [...currentItems, newItem] } : field
        );
        setTemplate({ ...template, fields: newFields });
      }}
      className=" mx-auto block w-fit py-3.5 px-8 ghost btn py-3.6 bg-transparent hover:bg-transparent border border-transparent hover:text-amber-400 rounded-2xl focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 shadow-none active:shadow-none text-white text-sm font-medium transition-all"
    >
      Добавить
    </button>
  </div>
)}
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-7 sticky top-20 z-50 self-start flex flex-col h-[calc(100vh-4rem)] relative">
          
          <div className="mb-4 flex gap-3">
             {/* Кнопка Сравнение */}
<button
  onClick={() => {
    if (isComparisonActive) {
      setIsComparisonActive(false);
      setComparisonDate('');
    } else {
      setShowComparisonModal(true);
    }
  }}
  tabIndex={-1}
  className={`justify-left gap-3 py-4 px-6 text-sm font-medium rounded-2xl transition-all
    bg-transparent border border-none text-white
    hover:text-amber-400 cursor-pointer
    ${isComparisonActive ? '!text-amber-400' : ''}
  `}
>
  <span>Сравнение</span>
</button>

{/* Кнопка Состояние после */}
<button
  onClick={() => {
    if (isStateAfterActive) {
      setIsStateAfterActive(false);
      setStateAfterText('');
    } else {
      setShowStateAfterModal(true);
    }
  }}
  tabIndex={-1}
  className={`flex-0 justify-left gap-3 py-4 px-6 text-sm font-medium rounded-2xl transition-all
    bg-transparent border border-transparent text-white
    hover:text-amber-400 cursor-pointer
    ${isStateAfterActive ? '!text-amber-400' : ''}
  `}
>
  <span>Состояние</span>
</button>
            </div>

                    <div className="card bg-zinc-900/75 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl max-h-[42vh] flex flex-col min-h-0 overflow-hidden mb-6 p-1">
            <div className="flex-1 p-8 overflow-auto text-zinc-100 text-[14px] leading-relaxed"
                  style={{ lineHeight: '1.65' }}
                  dangerouslySetInnerHTML={{ __html: finalText }} 
                  />
          </div>
          
                  {/* Кнопки патологий */}
{activeFieldId && activeField?.quickButtons && activeField.quickButtons.length > 0 && (
  <div className="sticky bottom-0 bg-zinc-950/80 backdrop-blur-xl border-t border-white/10 pt-4 pb-2 z-30">
    <div className="flex flex-wrap gap-2"
    onMouseDown={(e) => e.preventDefault()}
    >
      

      {(activeField.quickButtons || []).map((group: QuickButtonGroup) => {
        const subgroups = group.subgroups || [];
        const isSingleSubgroupAndSinglePhrase =
          subgroups.length === 1 && (subgroups[0].phrases?.filter(Boolean).length || 0) === 1;
        const singlePhrase = isSingleSubgroupAndSinglePhrase
          ? subgroups[0].phrases.filter(Boolean)[0]
          : '';

        return (
          <div key={group.id} className="dropdown dropdown-hover">
            {/* 1-й уровень — группа */}
            <div
              tabIndex={0}
              role="button"
              className="btn btn-ghost btn-sm px-6 py-2.5 text-sm text-white border border-transparent hover:border-transparent hover:bg-transparent hover:text-amber-400 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 shadow-none active:shadow-none transition-all"
              onClick={() => {
                if (isSingleSubgroupAndSinglePhrase && singlePhrase) insertPhrase(singlePhrase);
              }}
            >
              {group.label || 'Группа'}
              {!isSingleSubgroupAndSinglePhrase && <ChevronDown size={12} className="ml-1" />}
            </div>

            {/* Меню 2-го уровня */}
            {!isSingleSubgroupAndSinglePhrase && (
              <ul 
                tabIndex={0} 
                className="dropdown-content menu bg-zinc-900/90 backdrop-blur-2xl border border-zinc-700 rounded-box z-1 w-52 p-2"
              >
                {subgroups.map((subgroup: QuickButtonSubgroup) => {
  const phrases = subgroup.phrases?.filter(Boolean) || [];
  const isSinglePhraseInSubgroup = phrases.length === 1;

  return (
    <li 
      key={subgroup.id} 
      className="group rounded-lg hover:bg-zinc-800 transition-all"   
    >
      <div className="dropdown dropdown-left dropdown-hover w-full">
        <button
          onClick={isSinglePhraseInSubgroup ? () => insertPhrase(phrases[0]) : undefined}
          tabIndex={0}
          className="w-full text-left justify-start text-white text-xs py-1 px-3 rounded-lg flex items-center 
                     hover:bg-transparent group-hover:bg-transparent transition-colors cursor-pointer"
        >
          {subgroup.label || 'Подгруппа'}
          
          {!isSinglePhraseInSubgroup && <ChevronRight size={14} className="ml-auto" />}
          {isSinglePhraseInSubgroup && <span className="ml-auto w-4 flex-shrink-0" />}
        </button>

        {/* Третий уровень */}
        {!isSinglePhraseInSubgroup && (
          <ul tabIndex={0} className="dropdown-content menu bg-zinc-900 bg-zinc-900/90 backdrop-blur-2xl border border-zinc-700 rounded-xl shadow-xl min-w-[340px] z-[10000] p-1 duration-70 delay-0" 
          >
            <div className="max-h-[280px] overflow-y-auto overflow-x-hidden py-1 overscroll-contain scrollbar-thin scrollbar-thumb-zinc-500 scrollbar-track-zinc-900/30">
    {/* сюда остаётся весь .map по phrases */}
          
            
            {phrases.map((phrase: string, i: number) => (
              <li key={i}>
                <button
                  onClick={() => insertPhrase(phrase)}
                  className="w-full text-left justify-start hover:bg-zinc-800 text-white text-xs py-3 px-5 rounded-lg transition-colors"
                >
                  {phrase}
                </button>
              </li>
            ))}
            </div>
          </ul>
          
        )}
      </div>
    </li>
  );
})}
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
            <button onClick={copyToClipboard} tabIndex={-1} className="btn btn-ghost btn-square btn-lg hover:border-transparent hover:bg-transparent hover:text-amber-400 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 shadow-none active:shadow-none transition-all tooltip" data-tip="Скопировать" ><Copy size={22} /></button>
            <button onClick={resetToDefault} tabIndex={-1} className="btn btn-ghost btn-square btn-lg hover:border-transparent hover:bg-transparent hover:text-amber-400 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 shadow-none active:shadow-none transition-all tooltip" data-tip="Сбросить протокол" ><RotateCcw size={22} /></button>
            <button onClick={downloadTxt} tabIndex={-1} className="btn btn-ghost btn-square btn-lg hover:border-transparent hover:bg-transparent hover:text-amber-400 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 shadow-none active:shadow-none transition-all tooltip" data-tip="Сохранить" ><Download size={22}/></button>
            <button onClick={goToTemplateList} tabIndex={-1} className="btn btn-ghost btn-square btn-lg hover:border-transparent hover:bg-transparent hover:text-amber-400 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 shadow-none active:shadow-none transition-all tooltip" data-tip="К списку шаблонов" ><Home size={22} /></button>
            <button onClick={() => setShowAbbrModal(true)} tabIndex={-1} className="btn btn-ghost btn-square btn-lg hover:border-transparent hover:bg-transparent hover:text-amber-400 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 shadow-none active:shadow-none transition-all tooltip" data-tip="Автокоррекции" ><Settings size={22} /></button>    
          </div>
        </div>
      </div>

      {/* МОДАЛКИ (полностью без изменений) */}
      {showComparisonModal && (
  <dialog 
    className="modal modal-open"
    onKeyDown={(e) => {
      if (e.key === 'Enter') {
        if (comparisonDate.trim()) {
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
      <div className="px-6 pt-5 pb-3 border-b border-white/10">
        <h2 className="text-xl font-semibold text-white">Сравнение с предыдущим</h2>
      </div>

      <div className="p-8">
        <label className="block text-sm text-zinc-400 mb-2">Дата предыдущего исследования</label>
        <input 
          type="date" 
          value={comparisonDate} 
          onChange={e => setComparisonDate(e.target.value)} 
          placeholder="ДД.ММ.ГГГГ." 
          className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-white placeholder:text-zinc-400 focus:border-amber-400 focus:outline-none transition-all"
        />
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
            if (comparisonDate.trim()) { 
              setIsComparisonActive(true); 
              setShowComparisonModal(false); 
            } 
          }} 
          className="flex-1 py-3.5 bg-white/5 hover:bg-amber-400/10 border border-white/10 hover:border-amber-400 rounded-2xl text-sm font-medium text-white hover:text-amber-300 transition-all cursor-pointer"
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
      if (e.key === 'Enter') {
        if (stateAfterText.trim()) {
          setIsStateAfterActive(true);
          setShowStateAfterModal(false);
        }
      }
      if (e.key === 'Escape') {
        setShowStateAfterModal(false);
      }
    }}
  >
    <div className="modal-box bg-zinc-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl max-w-md mx-4">
      <div className="px-6 pt-5 pb-3 border-b border-white/10">
        <h2 className="text-xl font-semibold text-white">Состояние после</h2>
      </div>

      <div className="p-8">
        <label className="block text-sm text-zinc-400 mb-2">Ранее проводимое лечение</label>
        <input 
          type="text" 
          value={stateAfterText} 
          onChange={e => setStateAfterText(e.target.value)} 
          placeholder="Введите значение" 
          className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-white placeholder:text-zinc-400 focus:border-amber-400 focus:outline-none transition-all"
        />
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
            if (stateAfterText.trim()) { 
              setIsStateAfterActive(true); 
              setShowStateAfterModal(false); 
            } 
          }} 
          className="flex-1 py-3.5 bg-white/5 hover:bg-amber-400/10 border border-white/10 hover:border-amber-400 rounded-2xl text-sm font-medium text-white hover:text-amber-300 transition-all cursor-pointer"
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
                    <dialog className="modal modal-open">
          <div className="modal-box bg-zinc-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
          

      {/* Шапка модалки — кнопки в правом верхнем углу */}
      <div className="px-6 pt-5 pb-3 border-b border-white/10 relative">
        <h2 className="text-xl font-semibold text-white">Автокоррекции</h2>

        
        {/* Кнопки в правом верхнем углу (как в карточках) */}
        <div className="absolute top-5 right-6 flex items-center gap-1">
          <button 
            onClick={exportAbbreviations} 
            className="btn btn-ghost btn-square w-9 h-9 text-white hover:border-transparent hover:bg-transparent hover:text-amber-400 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 shadow-none active:shadow-none transition-all tooltip tooltip-bottom"
          data-tip="Экспортировать">
            <ArrowDownOnSquareIcon className="size-5" />
          </button>
          
          <label className="btn btn-ghost btn-square w-9 h-9 text-white hover:border-transparent hover:bg-transparent hover:text-amber-400 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 shadow-none active:shadow-none transition-all tooltip tooltip-bottom"
            data-tip="Импортировать">
            <ArrowUpOnSquareIcon className="size-5" />
            <input type="file" accept=".json" onChange={importAbbreviations} className="hidden" />
          </label>
          
          <button 
            onClick={() => setShowAbbrModal(false)} 
            className="btn btn-ghost btn-square w-9 h-9 text-white hover:border-transparent hover:bg-transparent hover:text-red-400 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 shadow-none active:shadow-none transition-all tooltip tooltip-bottom"
          data-tip="Закрыть">
            <XCircle size={20} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        
        {/* Левая колонка — Группы */}
        <div className="w-64 border-r border-white/10 p-4 flex flex-col">
  <div className="text-xs uppercase text-zinc-400 mb-3 px-2"></div>
  
  <div className="flex-1 overflow-auto space-y-1">
    {categories.map(cat => (
      <div 
        key={cat} 
        className={`flex items-center px-4 py-2.5 rounded-2xl text-sm transition-colors ${
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
          className="flex-shrink-0 ml-4 text-white hover:text-red-400 transition-colors"
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
        className="w-full bg-white/5 border border-white/10 rounded-2xl pl-11 pr-6 py-3 text-sm text-white placeholder:text-zinc-400 focus:border-amber-400 focus:outline-none"
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
            className="text-white hover:text-red-400 transition-colors"
          >
            <Trash2 size={17} />
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
      className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-sm text-white placeholder:text-zinc-400 focus:border-amber-400 focus:outline-none"
    />
    <input 
      type="text" 
      value={newFullText} 
      onChange={e => setNewFullText(e.target.value)} 
      placeholder="Фраза" 
      className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-sm text-white placeholder:text-zinc-400 focus:border-amber-400 focus:outline-none"
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
          className="flex-1 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-white text-sm font-medium transition-all"
        >
          Отмена
        </button>
        <button
          onClick={() => {
            if (deleteConfirm.type === 'category') {
              deleteCategory(deleteConfirm.id);
            } else {
              const newAbbrs = { ...abbreviations };
              delete newAbbrs[deleteConfirm.id];
              saveData(newAbbrs, categories);
            }
            setDeleteConfirm(null);
          }}
          className="flex-1 py-3 bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-400 rounded-2xl text-white hover:text-red-400 text-sm font-medium transition-all"
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
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-sm text-white placeholder:text-zinc-400 focus:border-amber-400 focus:outline-none transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">Дата рождения (ДД.ММ.ГГГГ)</label>
                    <input 
                      type="text" 
                      value={birthDate} 
                      onChange={(e) => setBirthDate(e.target.value)} 
                      placeholder="Введите дату" 
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-sm text-white placeholder:text-zinc-400 focus:border-amber-400 focus:outline-none transition-all"
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