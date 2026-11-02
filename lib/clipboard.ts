// Копирование текста в буфер обмена.
//
// navigator.clipboard есть только в «безопасном контексте» (HTTPS или
// localhost) — при открытии dev-сервера с телефона по IP в локальной сети
// его нет. Запасной путь — скрытая textarea и document.execCommand('copy'):
// устарел, но работает везде, в том числе в iOS Safari.
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const active = document.activeElement as HTMLElement | null;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  // Вне экрана, но не display: none — иначе выделение не сработает.
  // font-size 16px — чтобы iOS не приближал страницу при фокусе.
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;font-size:16px;';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  active?.focus?.({ preventScroll: true });
  if (!ok) throw new Error('copy failed');
}
