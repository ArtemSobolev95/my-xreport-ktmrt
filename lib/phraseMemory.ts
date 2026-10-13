// Память фраз для подсказок при наборе (ghost-text, как Google/Gmail Smart
// Compose) — чистая логика без React и PocketBase, хранение см. в
// hooks/usePhraseMemory.ts.
//
// Единица обучения — «фраза»: кусок текста поля между знаками-разделителями
// (. , ; ! ? … и перевод строки). Не целые предложения: в описаниях одни и
// те же обороты («контуры ровные», «структура однородная») встречаются в
// разных сочетаниях, и на уровне предложений они бы не обобщались.
//
// Числа, стоящие отдельно («12×8 мм», «1,5 см»), при обучении заменяются на
// слот SLOT: фраза запоминается как «размерами #×# мм», и подсказка доходит
// только до числа, не навязывая размеры прошлого пациента. Числа, слитые с
// буквами (T2, С1-С7), — часть термина и остаются как есть.

export const SLOT = '#';

export interface PhraseEntry {
  // Текст фразы со слотами вместо чисел, в регистре последнего использования
  // (первая буква всегда строчная — регистр в начале подставляется по месту).
  t: string;
  c: number;          // сколько раз фраза попала в скопированный/сохранённый протокол
  u: number;          // когда использовалась последний раз (ms)
  a?: number;         // сколько раз подсказку с этой фразой приняли (→)
  r?: number;         // сколько раз подсказку явно отклонили (Esc)
  // Какие фразы стояли перед этой в том же поле: ключ предыдущей фразы
  // ('' — начало поля) → сколько раз. Для подсказки следующей фразы.
  p?: Record<string, number>;
}

export type FieldMemory = Record<string, PhraseEntry>;          // ключ фразы → запись
export type TemplateMemory = Record<string, FieldMemory>;       // id поля → память поля

// Сколько фраз хранить на одно поле: при переполнении выбрасываются те, что
// реже всего и давнее всего использовались.
const MAX_PHRASES_PER_FIELD = 300;
const MAX_CONTEXTS_PER_PHRASE = 20;
const MIN_PHRASE_LENGTH = 4;
const MAX_PHRASE_LENGTH = 200;
// За сколько дней вес давно не используемой фразы падает вдвое.
const HALF_LIFE_DAYS = 60;

// Число отдельно от букв: «12», «1,5», «0.8» — но не «T2» и не «С1».
const STANDALONE_NUMBER = /(?<!\p{L})\d+(?:[.,]\d+)?(?!\p{L})/gu;
// Разделители фраз. Точка/запятая перед цифрой — десятичная («1,5»), не разделитель.
const SEPARATOR = /[;!?…\n]|[.,](?!\d)/g;

export const normalizePhrase = (text: string): string =>
  text.replace(STANDALONE_NUMBER, SLOT).replace(/\s+/g, ' ').replace(/^ /, '');

const toKey = (normalized: string): string => normalized.trim().toLowerCase();

// Первая буква строчная, если фраза начинается не с аббревиатуры
// («Печень…» → «печень…», но «КТ-признаки…» остаётся).
const decapitalize = (text: string): string => {
  if (text.length > 1 && text[1] === text[1].toUpperCase() && text[1] !== text[1].toLowerCase()) {
    return text;
  }
  return text.charAt(0).toLowerCase() + text.slice(1);
};

const isLearnable = (key: string): boolean =>
  key.length >= MIN_PHRASE_LENGTH &&
  key.length <= MAX_PHRASE_LENGTH &&
  /\p{L}{2}/u.test(key);

export const splitPhrases = (text: string): string[] =>
  text.split(SEPARATOR).map(s => normalizePhrase(s).trim()).filter(Boolean);

export const phraseKey = (text: string): string => toKey(normalizePhrase(text));

const recencyWeight = (lastUsed: number, now: number): number =>
  Math.pow(0.5, Math.max(0, now - lastUsed) / (HALF_LIFE_DAYS * 24 * 3600 * 1000));

const baseScore = (e: PhraseEntry, now: number): number =>
  Math.max(0.1, e.c + 2 * (e.a || 0) - (e.r || 0)) * recencyWeight(e.u, now);

const prune = (mem: FieldMemory, now: number): FieldMemory => {
  const keys = Object.keys(mem);
  if (keys.length <= MAX_PHRASES_PER_FIELD) return mem;
  const kept = keys
    .sort((a, b) => baseScore(mem[b], now) - baseScore(mem[a], now))
    .slice(0, MAX_PHRASES_PER_FIELD);
  return Object.fromEntries(kept.map(k => [k, mem[k]]));
};

const pruneContexts = (p: Record<string, number>): Record<string, number> => {
  const entries = Object.entries(p);
  if (entries.length <= MAX_CONTEXTS_PER_PHRASE) return p;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_CONTEXTS_PER_PHRASE));
};

// Обучение на финальном тексте поля. skip — ключи фраз, уже выученные из
// этого же протокола (повторное копирование того же протокола не должно
// удваивать счётчики); возвращает обновлённую память и ключи, выученные сейчас.
export function learnField(
  mem: FieldMemory,
  text: string,
  skip: Set<string>,
  now = Date.now(),
): { mem: FieldMemory; learned: string[] } {
  const phrases = splitPhrases(text);
  const next: FieldMemory = { ...mem };
  const learned: string[] = [];
  let prevKey = '';

  for (const phrase of phrases) {
    const key = toKey(phrase);
    if (!isLearnable(key)) continue;
    if (!skip.has(key) && !learned.includes(key)) {
      const prev = next[key];
      const p = { ...(prev?.p || {}) };
      p[prevKey] = (p[prevKey] || 0) + 1;
      next[key] = {
        ...prev,
        t: decapitalize(phrase),
        c: (prev?.c || 0) + 1,
        u: now,
        p: pruneContexts(p),
      };
      learned.push(key);
    }
    prevKey = key;
  }

  return { mem: learned.length ? prune(next, now) : mem, learned };
}

export interface Suggestion {
  key: string;     // ключ фразы в памяти поля
  ghost: string;   // что дописать после курсора
}

// Подсказка для текста до курсора. isSentenceStartCapital — писать ли
// фразу с большой буквы в самом начале поля (для «Заключения» — да, для
// остальных полей — нет: в протоколе они идут после «Название поля:»,
// та же логика, что у быстрых кнопок в insertPhrase).
export function suggest(
  mem: FieldMemory | undefined,
  textBeforeCaret: string,
  options: { capitalizeAtFieldStart: boolean; dismissed?: Set<string>; now?: number },
): Suggestion | null {
  if (!mem) return null;
  const now = options.now ?? Date.now();

  // Текущая (недописанная) фраза — после последнего разделителя.
  let lastSep = -1;
  let lastSepChar = '';
  for (const m of textBeforeCaret.matchAll(SEPARATOR)) {
    lastSep = m.index!;
    lastSepChar = m[0];
  }
  const rawCurrent = textBeforeCaret.slice(lastSep + 1);
  const current = normalizePhrase(rawCurrent);
  const currentKey = current.toLowerCase();

  // Фразы, уже стоящие в поле, повторно не предлагаем.
  const completed = splitPhrases(textBeforeCaret.slice(0, lastSep + 1)).map(toKey);
  const present = new Set(completed);
  const prevKey = completed.length ? completed[completed.length - 1] : '';

  const candidates = Object.entries(mem).filter(([key]) =>
    !present.has(key) && !options.dismissed?.has(key)
  );

  // 1) Начата фраза — дописываем её. Сначала ищем совпадение с начала
  // фразы, затем — с каждого следующего слова: перед запомненной фразой
  // может стоять другой текст без разделителя («контуры ровные гор…»).
  // Чем раньше начало совпадения, тем больше контекста — первое найденное
  // и берём. Для хвоста — минимум 3 символа, чтобы короткое слово («в»,
  // «на») не тянуло случайные подсказки.
  if (current.trim().length >= 2) {
    const starts = [0];
    for (let i = 1; i < current.length; i++) {
      if (current[i - 1] === ' ' && current[i] !== ' ') starts.push(i);
    }
    for (const start of starts) {
      const sub = currentKey.slice(start);
      if (sub.trim().length < (start === 0 ? 2 : 3)) continue;
      let best: { key: string; score: number } | null = null;
      for (const [key, e] of candidates) {
        if (key.length <= sub.length || !key.startsWith(sub)) continue;
        const context = start === 0 ? (e.p?.[prevKey] || 0) : 0;
        const score = baseScore(e, now) * (1 + context);
        if (!best || score > best.score) best = { key, score };
      }
      if (!best) continue;
      const ghost = cutAtSlot(mem[best.key].t.slice(sub.length));
      if (ghost.trim()) return { key: best.key, ghost };
    }
    return null;
  }

  // 2) Фраза ещё не начата — предлагаем следующую целиком, если после
  // предыдущей фразы (или в начале поля) что-то уже встречалось. Только
  // сразу после пробела/перевода строки: после «.» без пробела курсор ещё
  // «внутри» набора знака, а в пустом поле — в самом начале.
  const atFieldStart = textBeforeCaret.trim() === '';
  if (!atFieldStart && !/\s$/.test(textBeforeCaret)) return null;
  if (current.trim() !== '') return null;

  let best: { key: string; score: number } | null = null;
  for (const [key, e] of candidates) {
    const context = e.p?.[atFieldStart ? '' : prevKey] || 0;
    if (!context) continue;
    const score = context * baseScore(e, now);
    if (!best || score > best.score) best = { key, score };
  }
  if (!best) return null;

  const capitalize = atFieldStart
    ? options.capitalizeAtFieldStart
    : /[.!?…\n]/.test(lastSepChar);
  let text = mem[best.key].t;
  if (capitalize) text = text.charAt(0).toUpperCase() + text.slice(1);
  const ghost = cutAtSlot(text);
  return ghost.trim() ? { key: best.key, ghost } : null;
}

// Подсказка обрывается перед числовым слотом — число пользователь вводит сам.
const cutAtSlot = (text: string): string => {
  const i = text.indexOf(SLOT);
  return i === -1 ? text : text.slice(0, i);
};

// Первое слово подсказки (для Ctrl/Alt+→) — вместе с пробелом перед ним.
export const firstWord = (ghost: string): string => {
  const m = ghost.match(/^\s*\S+/);
  return m ? m[0] : ghost;
};

export function markAccepted(mem: FieldMemory, key: string, now = Date.now()): FieldMemory {
  const e = mem[key];
  if (!e) return mem;
  return { ...mem, [key]: { ...e, a: (e.a || 0) + 1, u: now } };
}

export function markRejected(mem: FieldMemory, key: string): FieldMemory {
  const e = mem[key];
  if (!e) return mem;
  return { ...mem, [key]: { ...e, r: (e.r || 0) + 1 } };
}

export function forget(mem: FieldMemory, key: string): FieldMemory {
  if (!mem[key]) return mem;
  const next = { ...mem };
  delete next[key];
  return next;
}

// Для окна «Выученные фразы»: сначала самые «сильные».
export function rankedPhrases(mem: FieldMemory | undefined, now = Date.now()) {
  if (!mem) return [];
  return Object.entries(mem)
    .map(([key, e]) => ({ key, entry: e, score: baseScore(e, now) }))
    .sort((a, b) => b.score - a.score);
}
