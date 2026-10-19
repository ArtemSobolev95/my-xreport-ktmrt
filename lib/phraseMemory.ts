// Память фраз пользователя — примеры его формулировок для ИИ-подсказок
// (pb_hooks/suggest.pb.js): чистая логика без React и PocketBase, хранение
// см. в hooks/usePhraseMemory.ts.
//
// Единица обучения — «фраза»: кусок текста поля между знаками-разделителями
// (. , ; ! ? … и перевод строки). Не целые предложения: в описаниях одни и
// те же обороты («контуры ровные», «структура однородная») встречаются в
// разных сочетаниях, и на уровне предложений они бы не обобщались.
//
// Числа, стоящие отдельно («12×8 мм», «1,5 см»), при обучении заменяются на
// слот SLOT: фраза запоминается как «размерами #×# мм» — в примеры для
// модели не попадают размеры конкретных пациентов. Числа, слитые с
// буквами (T2, С1-С7), — часть термина и остаются как есть.

export const SLOT = '#';

export interface PhraseEntry {
  // Текст фразы со слотами вместо чисел, в регистре последнего использования
  // (первая буква всегда строчная — регистр в начале подставляется по месту).
  t: string;
  c: number;          // сколько раз фраза попала в скопированный/сохранённый протокол
  u: number;          // когда использовалась последний раз (ms)
  // Остались в записях от статистических подсказок (до ИИ): учитываются
  // в ранжировании, но больше не пополняются.
  a?: number;
  r?: number;
  // Какие фразы стояли перед этой в том же поле: ключ предыдущей фразы
  // ('' — начало поля) → сколько раз.
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

// Первое слово подсказки (для Ctrl/Alt+→) — вместе с пробелом перед ним.
export const firstWord = (ghost: string): string => {
  const m = ghost.match(/^\s*\S+/);
  return m ? m[0] : ghost;
};

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

// === Примеры для ИИ-подсказки ===

const SLOT_FOR_MODEL = 'N';
const toModelText = (t: string) => t.split(SLOT).join(SLOT_FOR_MODEL);
// Значимые слова фразы — для поиска похожих (короткие предлоги не в счёт).
const contentWords = (key: string) => key.split(/[^\p{L}\p{N}-]+/u).filter(w => w.length >= 4);

// Фразы из памяти поля, подходящие к тому, что набрано сейчас: сначала —
// начинающиеся так же, как текущая (недописанная) фраза; затем — обычно
// идущие после предыдущей фразы; затем — с общими словами; остальное —
// по частоте и свежести. Уже стоящие в поле фразы не повторяем.
export function selectExamples(mem: FieldMemory | undefined, textBefore: string, limit: number, now = Date.now()): string[] {
  if (!mem) return [];
  const parts = textBefore.split(SEPARATOR);
  const currentKey = toKey(normalizePhrase(parts[parts.length - 1] || ''));
  const completed = parts.slice(0, -1).map(p => toKey(normalizePhrase(p))).filter(Boolean);
  const present = new Set(completed);
  const prevKey = completed.length ? completed[completed.length - 1] : '';
  const currentWords = new Set(contentWords(currentKey));

  return Object.entries(mem)
    .filter(([key]) => !present.has(key))
    .map(([key, e]) => {
      let score = baseScore(e, now);
      if (currentKey.length >= 2 && key.startsWith(currentKey)) score *= 10;
      score *= 1 + 2 * (e.p?.[prevKey] || 0);
      const shared = contentWords(key).filter(w => currentWords.has(w)).length;
      score *= 1 + shared;
      return { t: e.t, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => toModelText(x.t));
}

// === Подсказка из памяти, без модели ===
// Если начало текущей фразы однозначно продолжается одной из частых фраз
// врача, подсказка берётся прямо из памяти: мгновенно и без запроса к ИИ.
// Только уверенный случай: фраза использовалась не меньше MIN_USES раз и
// весит не меньше DOMINANCE от всех фраз с тем же началом; набрано не
// меньше MIN_PREFIX символов. Иначе — null, и решает модель.
const LOCAL_MIN_USES = 3;
const LOCAL_MIN_PREFIX = 3;
const LOCAL_DOMINANCE = 0.75;

export function confidentPhrase(mem: FieldMemory | undefined, textBefore: string, avoid: string[] = [], now = Date.now()): string | null {
  if (!mem) return null;
  const parts = textBefore.split(SEPARATOR);
  const current = parts[parts.length - 1] || '';
  const currentKey = toKey(normalizePhrase(current));
  if (currentKey.length < LOCAL_MIN_PREFIX || currentKey.includes(SLOT)) return null;
  const avoidKeys = new Set(avoid.map(phraseKey));
  let total = 0;
  let best: { e: PhraseEntry; key: string; score: number } | null = null;
  for (const [key, e] of Object.entries(mem)) {
    if (key.length <= currentKey.length || !key.startsWith(currentKey)) continue;
    const score = baseScore(e, now);
    total += score;
    if (!best || score > best.score) best = { e, key, score };
  }
  if (!best || best.e.c < LOCAL_MIN_USES || best.score < LOCAL_DOMINANCE * total) return null;
  // Отклонённая подсказка хранится обрезанной (до числа) — сравниваем по началу.
  const bestKey = best.key;
  if ([...avoidKeys].some(k => k.length > currentKey.length && bestKey.startsWith(k))) return null;
  // Дальше числа (слота) подсказка не идёт — размеры врач вводит сам.
  const slot = best.e.t.indexOf(SLOT);
  const phrase = slot === -1 ? best.e.t : best.e.t.slice(0, slot);
  return phrase.trim().length > current.trim().length ? phrase : null;
}

// === Последние целые тексты поля ===
// Фразы теряют структуру описания (порядок, связки, типичную длину), поэтому
// модели показываем и несколько последних текстов поля целиком.

export type RecentTexts = Record<string, string[]>;   // id поля → тексты, новые первыми
const MAX_RECENT_PER_FIELD = 12;
const MAX_RECENT_LENGTH = 1500;

export const normalizeRecentText = (text: string): string =>
  text.replace(STANDALONE_NUMBER, SLOT_FOR_MODEL).replace(/[ \t]+/g, ' ').trim().slice(0, MAX_RECENT_LENGTH);

// replaceFirst — текст из того же протокола уже сохранён первым (протокол
// скопировали повторно после правки): заменяем его, а не добавляем дубль.
export function rememberText(list: string[] | undefined, text: string, replaceFirst: boolean): string[] {
  const normalized = normalizeRecentText(text);
  if (!normalized) return list || [];
  const rest = (list || []).slice(replaceFirst ? 1 : 0).filter(t => t !== normalized);
  return [normalized, ...rest].slice(0, MAX_RECENT_PER_FIELD);
}

// === Статистика подсказок ===
// По полю и модели: показано, принято, запросов к модели и их суммарное
// время — чтобы точность (доля принятых) и задержку было видно цифрой.

export interface SuggestStat { shown: number; accepted: number; requests: number; ms: number }
export type SuggestStats = Record<string, Record<string, SuggestStat>>;   // id поля → модель → счётчики

export const emptyStat = (): SuggestStat => ({ shown: 0, accepted: 0, requests: 0, ms: 0 });

export function sumStats(byModel: Record<string, SuggestStat> | undefined): SuggestStat {
  return Object.values(byModel || {}).reduce((acc, s) => ({
    shown: acc.shown + s.shown,
    accepted: acc.accepted + s.accepted,
    requests: acc.requests + s.requests,
    ms: acc.ms + s.ms,
  }), emptyStat());
}

// === Отклонённые ИИ-подсказки ===
// По полю — последние продолжения, которые пользователь отклонил (Esc) или
// проигнорировал (напечатал другое): уходят в запрос как «так не пиши».

export type RejectedTexts = Record<string, string[]>;   // id поля → фразы, новые первыми
const MAX_REJECTED_PER_FIELD = 20;

// Фраза, которую предлагала подсказка: начало текущей фразы (до курсора) +
// само продолжение. Числа — N, как в остальных примерах для модели.
export function suggestedPhrase(textBefore: string, ghost: string): string {
  const parts = textBefore.split(SEPARATOR);
  return normalizeRecentText((parts[parts.length - 1] || '') + ghost);
}

export function rememberRejected(list: string[] | undefined, phrase: string): string[] {
  const key = phrase.toLowerCase();
  if (phrase.length < 3) return list || [];
  return [phrase, ...(list || []).filter(p => p.toLowerCase() !== key)].slice(0, MAX_REJECTED_PER_FIELD);
}

// Убирает из отклонённых то, что пользователь в итоге написал сам: значит,
// фраза ему всё-таки подходит.
export function forgiveRejected(list: string[] | undefined, finalText: string): string[] | undefined {
  if (!list?.length) return list;
  const text = normalizeRecentText(finalText).toLowerCase();
  const next = list.filter(p => !text.includes(p.toLowerCase()));
  return next.length === list.length ? list : next;
}

// === Заготовки шаблона под набранный текст ===
// Фразы быстрых кнопок поля: в запрос — только подходящие к текущей фразе
// (то же начало, общие слова), а не все подряд: короче запрос — быстрее и
// дешевле ответ. При равенстве — в порядке шаблона.
export function selectVocabulary(items: string[], textBefore: string, limit: number): string[] {
  const parts = textBefore.split(SEPARATOR);
  const currentKey = toKey(normalizePhrase(parts[parts.length - 1] || ''));
  const currentWords = new Set(contentWords(currentKey));
  const allTextWords = new Set(contentWords(toKey(normalizePhrase(textBefore))));
  return items
    .map((t, i) => {
      const key = toKey(t);
      let score = 0;
      if (currentKey.length >= 2 && key.startsWith(currentKey)) score += 10;
      const words = contentWords(key);
      score += 3 * words.filter(w => currentWords.has(w)).length;
      score += words.filter(w => allTextWords.has(w)).length;
      return { t, score, i };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map(x => x.t);
}
