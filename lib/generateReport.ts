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
}

export function generateReport({
  template,
  fieldsData,
  deletedFieldIds,
  isComparisonActive,
  comparisonDates,
  isStateAfterActive,
  stateAfterText,
}: GenerateReportParams): { finalText: string; finalPlainText: string } {
  if (!template) return { finalText: '', finalPlainText: '' };

  let htmlText = '';
  let plainText = '';

  if (isComparisonActive && comparisonDates.length > 0) {
    const datesStr = comparisonDates.join(', ');
    const label = comparisonDates.length === 1
      ? 'с предыдущим от'
      : 'с предыдущими от';

    htmlText += `<span class="text-amber-400">Описание исследования в сравнении ${escapeHtml(label)} ${escapeHtml(datesStr)}:</span>\n\n`;
    plainText += `Описание исследования в сравнении ${label} ${datesStr}:\n\n`;
  }
  if (isStateAfterActive && stateAfterText) {
    htmlText += `<span class="text-amber-400">Состояние после ${escapeHtml(stateAfterText)}</span>\n\n`;
    plainText += `Состояние после ${stateAfterText}\n\n`;
  }

  template.fields.forEach((f: BuilderField) => {
    if (deletedFieldIds.includes(f.id)) return;

    if (f.type === 'header') return;

    const val = fieldsData[f.id];
    const label = escapeHtml(f.label);

    if (f.type === 'text' && isFieldEmpty(f, val) && !f.placeholder) {
      return;
    }

    let displayHtml = val ? escapeHtml(val) : '';
    let displayPlain = val || '';

    if (!val && f.placeholder) {
      displayHtml = `<span style="color: #9ca3af;">${escapeHtml(f.placeholder)}</span>`;
      displayPlain = f.placeholder;
    }

    let coloredHtml = displayHtml;
    if (val && ['text', 'number', 'select', 'checkbox', 'formula'].includes(f.type)) {
      coloredHtml = `<span class="text-amber-400">${escapeHtml(val)}</span>`;
    }

    if (f.type === 'text') {
      // Берём реальное значение пользователя (или placeholder)
      let textValue = (val || displayPlain || '').trim();

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

      htmlText += `${label}: ${finalHtml}\n\n`;
      plainText += `${f.label}: ${textValue}\n\n`;
    }

    else if (f.type === 'checkbox') {
      const isChecked = fieldsData[f.id] === true;
      const checkboxText = isChecked ? (f.checkedPhrase || 'Да') : (f.uncheckedPhrase || 'Нет');
      htmlText += `${label}: <span class="text-amber-400">${escapeHtml(checkboxText)}</span>\n\n`;
      plainText += `${f.label}: ${checkboxText}\n\n`;
    }
    else if (f.type === 'number') {
      if (!val) return;
      const unitHtml = f.unit ? ` <span class="text-amber-400">${escapeHtml(f.unit)}</span>.` : '.';
      const unitPlain = f.unit ? ` ${f.unit}.` : '.';
      htmlText += `${label}: <span class="text-amber-400">${escapeHtml(val)}</span>${unitHtml}\n\n`;
      plainText += `${f.label}: ${val}${unitPlain}\n\n`;
    }
    else if (f.type === 'select') {
      if (!val) return;
      htmlText += `${label}: ${coloredHtml}\n\n`;
      plainText += `${f.label}: ${val}\n\n`;
    }
    else if (f.type === 'rating') {
      if (!val || val === 0) return;
      const expl = f.showExplanations && f.explanations ? ` — ${f.explanations[val - 1] || ''}` : '';
      htmlText += `${label}: <span class="text-amber-400">${escapeHtml(val)}${escapeHtml(expl)}</span>\n\n`;
      plainText += `${f.label}: ${val}${expl}\n\n`;
    }
    else if (f.type === 'formula') {
      const hasAnyValue = (f.variables || []).some((_v, i: number) =>
        fieldsData[`${f.id}_var_${i}`] && String(fieldsData[`${f.id}_var_${i}`]).trim() !== ''
      );
      if (!hasAnyValue) return;

      const result = val || '';
      if (!result || result === 'NaN') return;

      const unitHtml = f.unit ? ` <span class="text-amber-400">${escapeHtml(f.unit)}</span>.` : '.';
      const unitPlain = f.unit ? ` ${f.unit}.` : '.';
      htmlText += `${label}: <span class="text-amber-400">${escapeHtml(result)}</span>${unitHtml}\n\n`;
      plainText += `${f.label}: ${result}${unitPlain}\n\n`;
    }
  });

  return {
    finalText: htmlText.trim(),
    finalPlainText: plainText.trim(),
  };
}
