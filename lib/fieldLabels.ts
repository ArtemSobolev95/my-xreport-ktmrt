// Общее для строк «Название: [содержимое]» на странице заполнения и в
// конструкторе шаблонов: точная ширина плашки названия (колонка названий
// общая в разделе) и настройка «названия ЗАГЛАВНЫМИ».

// Ключ localStorage переключателя «ЗАГЛАВНЫЕ» (страница заполнения; в
// конструкторе — только для показа, чтобы строки выглядели так же).
export const LABELS_UPPERCASE_KEY = 'filler_labels_uppercase';

// Точная ширина текста в px шрифтом страницы (14px) — для полей, которые
// должны быть ровно по тексту: плашка названия, комментарий формулы. Ширина
// в ch не годится: кириллица в среднем уже «0», поля выходили шире текста.
let textMeasureCtx: CanvasRenderingContext2D | null = null;
export const measureTextPx = (text: string, fontWeight: number): number => {
  if (typeof document === 'undefined') return text.length * 8;
  textMeasureCtx ??= document.createElement('canvas').getContext('2d');
  if (!textMeasureCtx) return text.length * 8;
  textMeasureCtx.font = `${fontWeight} 14px ${getComputedStyle(document.body).fontFamily}`;
  return Math.ceil(textMeasureCtx.measureText(text).width);
};

// Название поля (font-medium); tracking-wide у заглавных — +0.025em на символ.
export const measureLabelPx = (text: string, uppercase: boolean): number => {
  const shown = uppercase ? text.toUpperCase() : text;
  return measureTextPx(shown, 500) + (uppercase ? Math.ceil(shown.length * 0.35) : 0);
};

// Плашка названия: текст + px-2 с обеих сторон + запас на курсор.
export const LABEL_CHIP_PADDING_PX = 20;
// Двоеточие и зазор до содержимого.
export const LABEL_COLON_PX = 14;

// Ширина колонки названий по разделам: id заголовка раздела (null — поля до
// первого заголовка) → px самой широкой плашки. По разделу, а не по всему
// шаблону: одно длинное название не отодвигает содержимое везде.
export function sectionLabelWidths(
  fields: { id: string; type: string; label?: string }[],
  uppercase: boolean,
): { widths: Map<string | null, number>; sectionOf: Map<string, string | null> } {
  const widths = new Map<string | null, number>();
  const sectionOf = new Map<string, string | null>();
  let section: string | null = null;
  for (const f of fields) {
    if (f.type === 'header') { section = f.id; continue; }
    if (f.type === 'notes') continue;
    sectionOf.set(f.id, section);
    const w = measureLabelPx(f.label || 'Название поля', uppercase) + LABEL_CHIP_PADDING_PX;
    widths.set(section, Math.max(widths.get(section) || 0, w));
  }
  return { widths, sectionOf };
}

// CSS-ширина колонки названий строки: по разделу, но не больше 40% строки.
export const labelColumnWidth = (sectionPx: number): string => `min(${sectionPx + LABEL_COLON_PX}px, 40%)`;
