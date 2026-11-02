// Уникальный id (UUID v4) для полей, групп быстрых кнопок и т.п.
//
// crypto.randomUUID есть только в «безопасном контексте» (HTTPS или
// localhost). При открытии dev-сервера с телефона по IP в локальной сети
// (http://192.168.x.x:3000) его нет — и падало всё, что создаёт новые
// элементы. crypto.getRandomValues доступен везде, собираем UUID из него.
export function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // версия 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // вариант RFC 4122
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
