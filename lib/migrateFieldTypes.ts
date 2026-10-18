import type { BuilderField } from '../types/builder';

// Типы полей «Число», «Чекбокс» и «Шкала» больше не создаются в
// конструкторе: всё, что они давали, умеет текстовое поле с быстрыми
// кнопками — а ИИ-подсказки, выученные фразы и ИИ-проверка работают только
// с текстом. Существующие шаблоны (в том числе публичные) превращаются в
// текстовые при загрузке — в заполнении и в конструкторе (там это
// сохраняется при следующем сохранении шаблона), так же как
// migrateQuickButtons обновляет старый формат быстрых кнопок.
//
// Готовый протокол не меняется по смыслу: «Название: значение.»
//   чекбокс — placeholder = фраза «не отмечено» (она и раньше выводилась по
//             умолчанию), быстрая кнопка = фраза «отмечено»;
//   шкала   — группа быстрых кнопок «1 — пояснение», «2 — …»;
//   число   — текстовое поле с той же единицей (unit): она дописывается
//             к значению в протоколе, как раньше.
// Разница — точка в конце, как у всех текстовых полей.

export const LEGACY_FIELD_TYPES = ['number', 'checkbox', 'rating'] as const;

export const isLegacyFieldType = (type: string): boolean =>
  (LEGACY_FIELD_TYPES as readonly string[]).includes(type);

// Фразы шкалы: «N — пояснение», или просто «N», если пояснений нет.
const ratingPhrases = (f: BuilderField): string[] =>
  Array.from({ length: f.max || 5 }, (_, i) => {
    const explanation = f.showExplanations ? f.explanations?.[i]?.trim() : '';
    return explanation ? `${i + 1} — ${explanation}` : String(i + 1);
  });

export function migrateLegacyField(f: BuilderField): BuilderField {
  if (!isLegacyFieldType(f.type)) return f;
  // Настройки старых типов в текстовом поле не нужны.
  const rest: BuilderField = { ...f };
  delete rest.checkedPhrase;
  delete rest.uncheckedPhrase;
  delete rest.max;
  delete rest.explanations;
  delete rest.showExplanations;
  delete rest.unit;
  const quickButtons = f.quickButtons || [];

  if (f.type === 'checkbox') {
    const checked = (f.checkedPhrase || 'Да').trim();
    const unchecked = (f.uncheckedPhrase || 'Нет').trim();
    return {
      ...rest,
      type: 'text',
      placeholder: unchecked,
      defaultValue: f.defaultValue === true ? checked : '',
      quickButtons: [...quickButtons, { id: crypto.randomUUID(), label: checked, isExpanded: false, phrases: [checked] }],
    };
  }

  if (f.type === 'rating') {
    const phrases = ratingPhrases(f);
    const def = typeof f.defaultValue === 'number' && f.defaultValue > 0 ? phrases[f.defaultValue - 1] || '' : '';
    return {
      ...rest,
      type: 'text',
      placeholder: '',
      defaultValue: def,
      quickButtons: [...quickButtons, { id: crypto.randomUUID(), label: f.label || 'Шкала', isExpanded: false, phrases }],
    };
  }

  // number: placeholder числа был подсказкой ввода («0.00»), а у текстового
  // поля placeholder — текст протокола по умолчанию; не переносим.
  return {
    ...rest,
    type: 'text',
    placeholder: '',
    defaultValue: f.defaultValue !== undefined && f.defaultValue !== null && f.defaultValue !== '' ? String(f.defaultValue) : '',
    unit: f.unit || undefined,
  };
}

export const migrateLegacyFields = (fields: BuilderField[]): BuilderField[] => fields.map(migrateLegacyField);

// Значение, сохранённое для поля старого типа (черновик протокола), —
// в текст преобразованного поля.
export function convertLegacyValue(original: BuilderField, value: unknown): string {
  if (typeof value === 'string') return value;
  if (original.type === 'checkbox') return value === true ? (original.checkedPhrase || 'Да').trim() : '';
  if (original.type === 'rating') {
    const n = typeof value === 'number' ? value : 0;
    return n > 0 ? ratingPhrases(original)[n - 1] || String(n) : '';
  }
  return value === undefined || value === null ? '' : String(value);
}
