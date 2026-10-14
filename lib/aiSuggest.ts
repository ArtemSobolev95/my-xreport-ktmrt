// Превращение ответа модели (pb_hooks/suggest.pb.js) в ghost-подсказку:
// модель не всегда точно следует инструкции, поэтому ответ нормализуется
// здесь, а не принимается как есть.

// Число отдельно от букв («12», «1,5») — до него подсказка не доходит,
// размеры пользователь вводит сам. «T2», «С1» — часть термина.
const STANDALONE_NUMBER = /(?<!\p{L})\d+(?:[.,]\d+)?(?!\p{L})/u;
// Конец фразы: подсказка — не дальше ближайшего знака препинания.
// Точка/запятая перед цифрой — десятичная, не конец фразы.
const PHRASE_END = /[;!?…\n]|[.,](?!\d)/;

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}-]/u.test(ch);

export function toGhost(textBefore: string, raw: string): string {
  const cleaned = raw.replace(/⟨\|⟩/g, '');
  // Пробел в начале ответа — признак, что модель начала новое слово, а не
  // дописывает текущее (см. стык ниже).
  const startsNewWord = /^\s/.test(cleaned.replace(/^["«»'`]+/, ''));
  let text = cleaned.replace(/^[\s"«»'`]+|["«»'`\s]+$/g, '');
  if (!text) return '';

  // Модель могла начать с текущего недописанного слова («Гор» →
  // «Горизонтальный…») или повторить хвост текста. Срезаем самое длинное
  // совпадение конца текста с началом ответа — но только если в тексте оно
  // начинается с начала слова, иначе «…разрыв» + «в заднем роге» срезало
  // бы случайное «в».
  const before = textBefore.toLowerCase();
  const lower = text.toLowerCase();
  let overlap = 0;
  for (let k = Math.min(lower.length, before.length, 200); k > 0; k--) {
    if (!before.endsWith(lower.slice(0, k))) continue;
    if (isWordChar(before[before.length - k - 1]) && isWordChar(before[before.length - k])) continue;
    overlap = k;
    break;
  }
  text = text.slice(overlap);

  const sep = text.search(PHRASE_END);
  if (sep !== -1) text = text.slice(0, sep);
  const num = text.search(STANDALONE_NUMBER);
  if (num !== -1) text = text.slice(0, num);
  if (!text.trim()) return '';

  // Пробел на стыке. После пробела — не нужен. После знака препинания —
  // нужен перед словом (не перед «×», «%», «°» и т.п.). Курсор сразу после
  // буквы: если совпадения не было, ответ — это окончание недописанного
  // слова («Гор» + «изонтальный»), пробел не нужен; новое слово — только
  // если модель сама начала ответ с пробела.
  const last = textBefore.slice(-1);
  if (!textBefore || /\s/.test(last)) {
    text = text.replace(/^\s+/, '');
  } else if (isWordChar(text[0])) {
    const needsSpace = isWordChar(last) ? overlap === 0 && startsNewWord : true;
    if (needsSpace) text = ' ' + text;
  }
  return text.replace(/\s+$/, '') ? text : '';
}
