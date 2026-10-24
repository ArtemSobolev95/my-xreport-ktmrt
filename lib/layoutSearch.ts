// Поиск, не зависящий от раскладки: «rjktyj» (набрано в английской
// раскладке вместо русской) находит «колено», и наоборот. ё = е, регистр
// не важен.

const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';

const map = (s: string, from: string, to: string) =>
  [...s].map(ch => {
    const i = from.indexOf(ch);
    return i === -1 ? ch : to[i];
  }).join('');

export const normalizeSearch = (s: string) => s.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

// Варианты запроса: как набран, в русской раскладке, в английской.
export function searchVariants(query: string): string[] {
  const q = query.toLocaleLowerCase('ru');
  return [...new Set([q, map(q, EN, RU), map(q, RU, EN)].map(normalizeSearch))].filter(Boolean);
}

export const matchesLayoutSearch = (title: string, query: string) => {
  const variants = searchVariants(query);
  if (!variants.length) return true;
  const t = normalizeSearch(title);
  return variants.some(v => t.includes(v));
};
