// Общая раскладка страниц заполнения и конструктора шаблонов: док действий
// слева, строки полей по центру, боковая панель справа. Та же сетка
// повторяется во второй строке липкой шапки — её кнопки стоят ровно над
// колонкой полей.
//
// Мобильная версия (уже lg, < 1024px): боковых колонок нет — строки полей
// на всю ширину. В конструкторе док превращается в нижнюю панель, а правая
// панель — во всплывающую над ним карточку; у страницы заполнения своя
// нижняя зона (лента быстрых кнопок + действия, см. pages/filler.tsx).
export const PAGE_COLUMNS_CLASS = 'max-w-[1400px] mx-auto px-3 lg:px-6 flex gap-6';
// Пустая колонка-распорка во второй строке шапки — только на десктопе.
export const DOCK_COLUMN_CLASS = 'hidden lg:block w-12 shrink-0';
// Сама колонка дока. На мобильном — display: contents: колонки нет, а
// панель внутри (position: fixed) прижата к низу экрана.
export const DOCK_ASIDE_CLASS = 'contents lg:block lg:w-12 lg:shrink-0';
// Боковые панели липнут под шапкой (UserHeader + строка действий).
// (В DOCK_PANEL_CLASS это значение продублировано как lg:top-28 — Tailwind
// ищет классы в исходнике как есть, подстановку из переменной не увидит.)
export const SIDE_PANEL_TOP_CLASS = 'top-28';
export const DOCK_BUTTON_CLASS = 'tooltip tooltip-right w-10 h-10 shrink-0 flex items-center justify-center rounded-xl transition-colors cursor-pointer focus:outline-none';
// z-40: док липкий, а у липкого элемента свой контекст наложения — без
// z-index подсказки его кнопок оказывались под строками полей (те идут в
// разметке позже). Ниже шапки (z-50), выше содержимого страницы.
// Мобильный: фиксированная полоса внизу экрана, кнопки в ряд; учитывает
// «домашнюю полоску» iPhone (safe-area-inset-bottom).
export const DOCK_PANEL_CLASS = [
  'z-40 flex items-center',
  'fixed inset-x-0 bottom-0 flex-row justify-around sm:justify-center gap-0 sm:gap-4 px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] bg-zinc-900/95 backdrop-blur-md border-t border-white/10',
  'lg:sticky lg:top-28 lg:bottom-auto lg:inset-x-auto lg:flex-col lg:justify-start lg:gap-1 lg:p-1 lg:rounded-2xl lg:bg-zinc-900/75 lg:backdrop-blur-none lg:border lg:shadow-2xl',
].join(' ');
// Разделитель групп кнопок дока: вертикальный на мобильном, горизонтальный
// на десктопе.
export const DOCK_SEPARATOR_CLASS = 'shrink-0 bg-white/10 w-px h-5 lg:h-px lg:w-5 lg:my-1';
// Правая колонка на мобильном не занимает места (display: contents) — её
// панель становится всплывающей карточкой (конструктор: data-mobile-sheet).
export const SIDE_ASIDE_CLASS = 'contents lg:block lg:shrink-0';
