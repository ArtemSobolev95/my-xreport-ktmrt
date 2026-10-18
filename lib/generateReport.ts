import type { BuilderField, Template } from '../types/builder';

// Экранирование перед вставкой в HTML, который рендерится через
// dangerouslySetInnerHTML: label/placeholder/фразы приходят из шаблона,
// а шаблон может редактировать не только его владелец (публичные шаблоны).
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);

const isFieldEmpty = (field: BuilderField, value: unknown): boolean => {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (field.type === 'rating') return value == 0 || value === null || value === undefined;
  return false;
};

// Каждая строка протокола — отдельный блок: в превью пары «Поле: значение»
// идут столбиком, а не сливаются в один абзац. pre-line сохраняет переносы
// внутри многострочных значений (например, «Заключение»).
const row = (html: string): string =>
  `<div class="mb-1.5 last:mb-0 whitespace-pre-line">${html}</div>`;

export interface GenerateReportParams {
  template: Template | null;
  // Значения полей разнотипны по природе (текст/число/bool) в зависимости
  // от BuilderField.type — единый строгий тип потребовал бы
  // дискриминированного маппинга по каждому типу поля.
  fieldsData: Record<string, any>;
  deletedFieldIds: string[];
  isComparisonActive: boolean;
  comparisonDates: string[];
  isStateAfterActive: boolean;
  stateAfterText: string;
  // Названия полей ЗАГЛАВНЫМИ (переключатель на странице заполнения) —
  // так же и в готовом протоколе.
  uppercaseLabels?: boolean;
}

// Ключ комментария к результату формулы в fieldsData (рядом с ключами
// переменных `${id}_var_${i}`).
export const formulaCommentKey = (fieldId: string): string => `${fieldId}_comment`;

// Вводная строка «Сравнения» — общая для протокола и для её показа над
// полями на странице заполнения.
export const comparisonLine = (comparisonDates: string[]): string => {
  const label = comparisonDates.length === 1 ? 'с предыдущим от' : 'с предыдущими от';
  return `Описание исследования в сравнении ${label} ${comparisonDates.join(', ')}:`;
};

export function generateReport({
  template,
  fieldsData,
  deletedFieldIds,
  isComparisonActive,
  comparisonDates,
  isStateAfterActive,
  stateAfterText,
  uppercaseLabels = false,
}: GenerateReportParams): { finalText: string; finalPlainText: string } {
  if (!template) return { finalText: '', finalPlainText: '' };

  let htmlText = '';
  let plainText = '';

  if (isComparisonActive && comparisonDates.length > 0) {
    const line = comparisonLine(comparisonDates);
    htmlText += row(`<span class="text-amber-400">${escapeHtml(line)}</span>`);
    plainText += `${line}\n\n`;
  }
  if (isStateAfterActive && stateAfterText) {
    htmlText += row(`<span class="text-amber-400">${escapeHtml(stateAfterText)}</span>`);
    plainText += `${stateAfterText}\n\n`;
  }

  template.fields.forEach((f: BuilderField) => {
    if (deletedFieldIds.includes(f.id)) return;

    if (f.type === 'header') return;

    const val = fieldsData[f.id];
    const plainLabel = uppercaseLabels ? (f.label || '').toUpperCase() : (f.label || '');
    const label = escapeHtml(plainLabel);

    if ((f.type === 'text' || f.type === 'conclusion') && isFieldEmpty(f, val) && !f.placeholder) {
      return;
    }

    let displayHtml = val ? escapeHtml(val) : '';
    let displayPlain = val || '';

    if (!val && f.placeholder) {
      displayHtml = `<span style="color: #9ca3af;">${escapeHtml(f.placeholder)}</span>`;
      displayPlain = f.placeholder;
    }

    let coloredHtml = displayHtml;
    if (val && ['text', 'number', 'select', 'checkbox', 'formula', 'conclusion'].includes(f.type)) {
      coloredHtml = `<span class="text-amber-400">${escapeHtml(val)}</span>`;
    }

    if (f.type === 'text' || f.type === 'conclusion') {
      // Берём реальное значение пользователя (или placeholder)
      let textValue = (val || displayPlain || '').trim();
      // Единица (у полей, бывших «Числом», — см. lib/migrateFieldTypes.ts):
      // дописываем к введённому значению, если её там ещё нет.
      if (val && f.unit && textValue && !textValue.endsWith(f.unit)) {
        textValue += ` ${f.unit}`;
      }

      // Автоматически ставим точку, если её (или ! ?) ещё нет
      if (textValue && !/[.!?…]$/.test(textValue)) {
        textValue += '.';
      }

      // HTML-версия (с подсветкой, если есть значение)
      let finalHtml: string;
      if (val) {
        finalHtml = `<span class="text-amber-400">${escapeHtml(textValue)}</span>`;
      } else {
        // placeholder — тоже с точкой (если она была добавлена)
        finalHtml = textValue
          ? `<span style="color: #9ca3af;">${escapeHtml(textValue)}</span>`
          : displayHtml;
      }

      htmlText += row(`${label}: ${finalHtml}`);
      plainText += `${plainLabel}: ${textValue}\n\n`;
    }

    else if (f.type === 'checkbox') {
      const isChecked = fieldsData[f.id] === true;
      const checkboxText = isChecked ? (f.checkedPhrase || 'Да') : (f.uncheckedPhrase || 'Нет');
      htmlText += row(`${label}: <span class="text-amber-400">${escapeHtml(checkboxText)}</span>`);
      plainText += `${plainLabel}: ${checkboxText}\n\n`;
    }
    else if (f.type === 'number') {
      if (!val) return;
      const unitHtml = f.unit ? ` <span class="text-amber-400">${escapeHtml(f.unit)}</span>.` : '.';
      const unitPlain = f.unit ? ` ${f.unit}.` : '.';
      htmlText += row(`${label}: <span class="text-amber-400">${escapeHtml(val)}</span>${unitHtml}`);
      plainText += `${plainLabel}: ${val}${unitPlain}\n\n`;
    }
    else if (f.type === 'select') {
      if (!val) return;
      htmlText += row(`${label}: ${coloredHtml}`);
      plainText += `${plainLabel}: ${val}\n\n`;
    }
    else if (f.type === 'rating') {
      if (!val || val === 0) return;
      const expl = f.showExplanations && f.explanations ? ` — ${f.explanations[val - 1] || ''}` : '';
      htmlText += row(`${label}: <span class="text-amber-400">${escapeHtml(val)}${escapeHtml(expl)}</span>`);
      plainText += `${plainLabel}: ${val}${expl}\n\n`;
    }
    else if (f.type === 'formula') {
      const hasAnyValue = (f.variables || []).some((_v, i: number) =>
        fieldsData[`${f.id}_var_${i}`] && String(fieldsData[`${f.id}_var_${i}`]).trim() !== ''
      );
      if (!hasAnyValue) return;

      const result = val || '';
      if (!result || result === 'NaN') return;

      // Комментарий к результату (вводится на странице заполнения) — в
      // скобках после единицы; пустой — ни скобок, ни пробела.
      const comment = typeof fieldsData[formulaCommentKey(f.id)] === 'string'
        ? fieldsData[formulaCommentKey(f.id)].trim()
        : '';
      const unitHtml = f.unit ? ` <span class="text-amber-400">${escapeHtml(f.unit)}</span>` : '';
      const unitPlain = f.unit ? ` ${f.unit}` : '';
      const commentHtml = comment ? ` (<span class="text-amber-400">${escapeHtml(comment)}</span>)` : '';
      const commentPlain = comment ? ` (${comment})` : '';
      htmlText += row(`${label}: <span class="text-amber-400">${escapeHtml(result)}</span>${unitHtml}${commentHtml}.`);
      plainText += `${plainLabel}: ${result}${unitPlain}${commentPlain}.\n\n`;
    }
  });

  return {
    finalText: htmlText.trim(),
    finalPlainText: plainText.trim(),
  };
}
