// Общая раскладка страниц заполнения и конструктора шаблонов: док действий
// слева, строки полей по центру, боковая панель справа. Та же сетка
// повторяется во второй строке липкой шапки — её кнопки стоят ровно над
// колонкой полей.
export const PAGE_COLUMNS_CLASS = 'max-w-[1400px] mx-auto px-6 flex gap-6';
export const DOCK_COLUMN_CLASS = 'w-12 shrink-0';
// Боковые панели липнут под шапкой (UserHeader + строка действий).
export const SIDE_PANEL_TOP_CLASS = 'top-28';
export const DOCK_BUTTON_CLASS = 'tooltip tooltip-right w-10 h-10 flex items-center justify-center rounded-xl transition-colors cursor-pointer focus:outline-none';
export const DOCK_PANEL_CLASS = 'flex flex-col items-center gap-1 p-1 rounded-2xl bg-zinc-900/75 border border-white/10 shadow-2xl';
