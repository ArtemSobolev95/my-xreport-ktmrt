// Пословное сравнение исходного и исправленного текста (ИИ-проверка поля
// в filler): исправленный текст разбивается на куски, изменённые слова
// помечены, у них — что стояло на этом месте раньше.

export interface DiffSegment {
  text: string;      // кусок исправленного текста (слово или пробелы)
  changed: boolean;
  was?: string;      // для изменённого: что стояло раньше ('' — слово добавлено)
  deleted?: string;  // слова исходного текста, удалённые перед этим куском
}

const tokenize = (s: string) => s.split(/(\s+)/).filter(Boolean);
const isSpace = (t: string) => /^\s+$/.test(t);

export function wordDiff(original: string, corrected: string): DiffSegment[] {
  const a = tokenize(original).filter(t => !isSpace(t));
  const bTokens = tokenize(corrected);
  const b = bTokens.filter(t => !isSpace(t));

  // LCS по словам: lcs[i][j] — длина для a[i..], b[j..].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  // Для каждого слова исправленного текста: совпало ли, и какие слова
  // исходного текста оно заменило.
  const marks: { changed: boolean; was: string[]; deleted?: string[] }[] = [];
  let i = 0;
  let j = 0;
  let removed: string[] = [];
  while (j < b.length) {
    if (i < a.length && a[i] === b[j]) {
      // Слова, удалённые перед совпавшим (без замены) — например, задвоенное.
      marks.push({ changed: false, was: [], deleted: removed.length ? removed : undefined });
      removed = [];
      i++; j++;
    } else if (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1]) {
      removed.push(a[i]);
      i++;
    } else {
      marks.push({ changed: true, was: removed });
      removed = [];
      j++;
    }
  }

  const trailingDeleted = [...removed, ...a.slice(i)];

  let w = 0;
  const segments: DiffSegment[] = bTokens.map(t => {
    if (isSpace(t)) return { text: t, changed: false };
    const m = marks[w++];
    if (m.changed) return { text: t, changed: true, was: m.was.join(' ') };
    return m.deleted ? { text: t, changed: false, deleted: m.deleted.join(' ') } : { text: t, changed: false };
  });
  if (trailingDeleted.length) segments.push({ text: '', changed: false, deleted: trailingDeleted.join(' ') });
  return segments;
}

// Только изменения — пары «было → стало» (для компактного показа в панели
// проверки): подряд идущие изменённые слова — одна пара; удалённые слова —
// пара с пустым «стало».
export function changePairs(original: string, corrected: string): { from: string; to: string }[] {
  const pairs: { from: string; to: string }[] = [];
  let from: string[] = [];
  let to: string[] = [];
  const flush = () => {
    if (from.length || to.length) pairs.push({ from: from.join(' '), to: to.join(' ') });
    from = [];
    to = [];
  };
  for (const seg of wordDiff(original, corrected)) {
    if (/^\s+$/.test(seg.text)) continue;
    if (seg.deleted && !seg.changed) {
      // Удалённое (например, повтор) — с соседним словом, чтобы было видно
      // где: «рога рога → рога».
      flush();
      pairs.push({ from: `${seg.deleted} ${seg.text}`.trim(), to: seg.text });
      continue;
    }
    if (seg.deleted) from.push(seg.deleted);
    if (seg.changed) {
      if (seg.was) from.push(seg.was);
      to.push(seg.text);
    } else {
      flush();
    }
  }
  flush();
  return pairs;
}
