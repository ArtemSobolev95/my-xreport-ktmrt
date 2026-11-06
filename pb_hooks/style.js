// pb_hooks/style.js
//
// Формулировки, которых врач не пишет, — общие правила для подсказок
// (suggest.pb.js), автозаключения (conclude.pb.js) и проверки протокола
// (review.pb.js: там они исправляются правками). Не *.pb.js — подключается
// внутри обработчика:
//   const style = require(`${__hooks}/style.js`)

// Названия позвонков и сегментов — всегда «C», «Th», «L», «S», «Co»
// (C5, Th12, L4-L5, L5-S1, Co1), где бы они ни стояли, даже в начале поля.
// Точное правило, а не модель: исправляет только регистр и не меняет
// раскладку (кириллическую «С5» оставляет кириллической). Только сразу
// перед номером, чтобы не задеть обычные слова («с 2020 года» — с пробелом).
const fixSegmentCase = (text) => String(text == null ? "" : text)
    .replace(/(?<![\p{L}\d])(th|TH|tH)(?=\d)/gu, "Th")
    .replace(/(?<![\p{L}\d])(co|CO|cO)(?=\d)/gu, "Co")
    .replace(/(?<![\p{L}\d])([cс]|l|s)(?=\d)/gu, (m) => m.toUpperCase());

module.exports = {
    FORBIDDEN: [
        "Never write \"нельзя исключить\", \"не исключается\", \"не исключено\" (or \"cannot be excluded\"); write \"подозрение на …\" or \"изменения, подозрительные на …\" instead.",
        "Never write modality prefixes such as \"МР-признаки\", \"КТ-признаки\", \"МСКТ-признаки\", \"МР-картина\", \"КТ-картина\" (or \"MRI signs of\", \"CT signs of\"): it is obvious the findings come from this study - name the finding itself (\"разрыв мениска\", not \"МР-признаки разрыва мениска\").",
    ],
    // Английские термины в русском протоколе — норма, а не ошибка.
    ENGLISH_TERMS: "English (Latin-script) words inside a Russian report are normal and correct: medical terms, sequence names, eponymous signs, diseases and classifications named after their authors (e.g. \"Stoller\", \"Outerbridge\", \"Baker\", \"Hill-Sachs\", \"Bankart\", \"Modic\", \"Pfirrmann\", \"Osgood-Schlatter\", \"bone bruise\", \"bucket handle\"). Never treat them as errors, never translate or transliterate them into Russian, never change their spelling.",
    SEGMENTS: "Vertebra and spinal segment names are always written exactly as C, Th, L, S, Co with the number (C5, Th12, L4-L5, L5-S1, Co1) - wherever they stand, including the very beginning of a field or sentence. This is correct, never an error; never change their case.",
    fixSegmentCase: fixSegmentCase,
};
