/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/correct.pb.js
//
// ИИ-проверка текстового поля в filler (вызывается, когда курсор уходит из
// поля): опечатки и согласование — род, число, падеж. Возвращает
// исправленный текст; показывать/применять правку решает пользователь.
//
// Модель отвечает не всем текстом заново, а коротким списком правок
// [["было","стало"], …] — ответ в разы короче, и проверка приходит быстрее.
// Правки применяются к тексту здесь.
//
// Медицинский текст: модель не должна «улучшать» описание. Поэтому ответ
// проверяется здесь же и отбрасывается (возвращается исходный текст), если
// изменились числа, аббревиатуры и термины с цифрами, число строк или
// заменено слишком много слов.
//
// Провайдер (YandexGPT / Claude), вызов модели и лимит запросов — в
// pb_hooks/ai.js. Инструкция — на английском, язык текста модель не меняет.
routerAdd("POST", "/api/correct", (e) => {
    const ai = require(`${__hooks}/ai.js`);
    if (!ai.isConfigured()) {
        return e.json(503, { message: "ИИ-проверка не настроена" });
    }
    // Проверка — после паузы в наборе: 20 в минуту с запасом.
    if (ai.rateLimited("correct", e.auth.id, 20)) {
        return e.json(429, { message: "Слишком много запросов" });
    }

    const body = e.requestInfo().body || {};
    const text = String(body.text == null ? "" : body.text);
    const fieldLabel = String(body.fieldLabel == null ? "" : body.fieldLabel).slice(0, 200);
    if (!text.trim() || text.length > 3000) {
        return e.json(200, { corrected: text });
    }

    const system = [
        "You are a proofreader of diagnostic imaging reports (radiography, CT, MRI).",
        "Fix ONLY: typos and spelling; agreement of words in gender, number and case (in languages that have them); obvious grammatical errors; accidentally duplicated words or phrases.",
        "Do not rephrase or add anything. Do not change the meaning, medical terms, word order, numbers or units.",
        "Keep abbreviations and Latin-script terms (T2, STIR, PD, Stoller, CT, MRI) exactly as they are.",
        "Keep line breaks and punctuation; change punctuation only if the phrase is grammatically wrong without it.",
        "Do NOT capitalize the first letter of the text, do NOT replace the Russian letter \u0435 with \u0451, do NOT replace hyphens with dashes, do NOT touch spaces around hyphens - keep them as the doctor wrote.",
        "Keep the text in its original language.",
        "Answer ONLY with a JSON array of edits: [[\"wrong fragment\", \"fixed fragment\"], ...].",
        "Copy each wrong fragment exactly as it appears in the text (a word or a few words); if it occurs more than once, include a neighbouring word so it is unique.",
        "To remove a duplicate, include it in the fragment and leave it out of the fix.",
        "If there are no errors, answer [].",
        "No explanations, no code fences.",
    ].join("\n");
    const user = (fieldLabel ? "Report field: " + fieldLabel + "\n\n" : "") + "Text:\n" + text;

    // Ответ — только правки: несколько десятков токенов, с запасом на
    // длинный текст с множеством ошибок.
    const res = ai.complete(system, user, {
        route: "CORRECT",
        maxTokens: Math.min(800, Math.ceil(text.length / 4) + 60),
        timeout: 15,
    });
    if (!res.ok) {
        return e.json(502, { message: "ИИ-сервис недоступен" });
    }

    // Список правок — с запасом на обёртку (```json, пояснение вокруг).
    let edits = [];
    const raw = res.text.trim();
    const json = raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1);
    try {
        const parsed = JSON.parse(json || "[]");
        if (Array.isArray(parsed)) edits = parsed;
    } catch (err) {
        console.log("[correct] не разобран список правок:", raw.slice(0, 200));
    }
    // Правки — по порядку: каждая ищется после предыдущей (так одинаковые
    // фрагменты исправляются по очереди), иначе — с начала текста. Фрагмент,
    // которого в тексте нет, пропускается.
    let corrected = text;
    let cursor = 0;
    for (const edit of edits) {
        const from = Array.isArray(edit) ? edit[0] : edit && edit.from;
        const to = Array.isArray(edit) ? edit[1] : edit && edit.to;
        if (typeof from !== "string" || typeof to !== "string" || !from || from === to) continue;
        let at = corrected.indexOf(from, cursor);
        if (at === -1) at = corrected.indexOf(from);
        if (at === -1) continue;
        corrected = corrected.slice(0, at) + to + corrected.slice(at + from.length);
        cursor = at + to.length;
    }
    // Удалённый повтор оставляет двойной пробел — убирается ниже вместе с
    // остальными.

    // Правки, которые врачу не нужны, модель иногда делает вопреки
    // инструкции — возвращаем их обратно сами:
    // ё вместо е — только если у врача в тексте «ё» нет вообще;
    if (!/[ёЁ]/.test(text)) corrected = corrected.replace(/ё/g, "е").replace(/Ё/g, "Е");
    // тире вместо дефиса — только если у врача тире нет;
    if (!/[—–]/.test(text)) corrected = corrected.replace(/[—–]/g, "-");
    // пробелы вокруг дефисов — как у врача, если дефисов столько же;
    const hyphenGaps = text.match(/\s*-\s*/g) || [];
    const parts = corrected.split(/\s*-\s*/);
    if (parts.length === hyphenGaps.length + 1) {
        corrected = parts.reduce((acc, part, i) => acc + hyphenGaps[i - 1] + part);
    }
    // заглавная первая буква — если у врача текст начинался со строчной.
    const first = text.search(/\S/);
    if (first !== -1 && corrected[first] && text[first] !== corrected[first] &&
        text[first] === corrected[first].toLowerCase() && text[first] !== text[first].toUpperCase()) {
        corrected = corrected.slice(0, first) + text[first] + corrected.slice(first + 1);
    }

    const numbers = (s) => (s.match(/\d+(?:[.,]\d+)?/g) || []).join("|");
    // Аббревиатуры и термины с цифрами (T2, STIR, PD, CT, C1-C7) — не трогать.
    // Не вся латиница: в англоязычном протоколе это были бы все слова.
    // Перед сравнением похожие кириллические буквы приводятся к латинским:
    // «Т2» и «STIR», набранные кириллицей, модель законно исправляет на
    // латиницу — это та же аббревиатура, а не изменённый термин.
    const HOMOGLYPHS = { "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "У": "Y",
        "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x" };
    // Только внутри «слов», где есть латиница или цифры (Т2, СТIR), — обычные
    // русские слова не трогаем.
    const toLatin = (s) => s.replace(/[A-Za-zА-Яа-яЁё0-9-]+/g, (w) =>
        /[A-Za-z0-9]/.test(w) || /^[АВЕКМНОРСТХУ]{2,}$/.test(w)
            ? w.replace(/[АВЕКМНОРСТХУаеорсух]/g, (ch) => HOMOGLYPHS[ch] || ch)
            : w);
    const latinTokens = (s) => toLatin(s).match(/\b(?:[A-Za-z]*\d[A-Za-z0-9-]*|[A-Z]{2,}[A-Z0-9-]*)\b/g) || [];
    const latin = (s) => latinTokens(s).join("|");
    const lines = (s) => s.split("\n").length;
    const words = (s) => s.split(/\s+/).filter(Boolean);

    let rejectReason = "";
    if (!corrected.trim()) rejectReason = "пустой ответ";
    else if (numbers(corrected) !== numbers(text)) rejectReason = "изменились числа";
    else if (latin(corrected) !== latin(text)) {
        rejectReason = "изменилась латиница: [" + latinTokens(text).join(", ") + "] → [" + latinTokens(corrected).join(", ") + "]";
    }
    else if (lines(corrected) !== lines(text)) rejectReason = "изменились строки";
    else {
        const a = words(text);
        const b = words(corrected);
        // Сколько слов не совпало — через наибольшую общую подпоследовательность
        // (а не по позициям: удаление задвоенного слова сдвигало бы все
        // остальные). Коррекция почти не меняет число слов и меняет немногие.
        const prev = new Array(b.length + 1).fill(0);
        for (let i = 1; i <= a.length; i++) {
            let diag = 0;
            for (let j = 1; j <= b.length; j++) {
                const up = prev[j];
                prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j], prev[j - 1]);
                diag = up;
            }
        }
        const changed = Math.max(a.length, b.length) - prev[b.length];
        if (Math.abs(a.length - b.length) > 2 || changed > Math.max(3, Math.ceil(a.length * 0.3))) {
            rejectReason = "слишком много изменений";
        }
    }

    if (rejectReason) {
        console.log("[correct] ответ модели отброшен:", rejectReason);
    }

    // Размеры, набранные через пробел («12 8 мм», «12 8 5»), — через знак
    // умножения. Точное правило, а не модель (та могла бы пропустить), и
    // применяется после проверки её ответа (склейка меняет «числа» и
    // «термины с цифрами», и проверка отбросила бы правку целиком) — в том
    // числе к исходному тексту, если ответ модели отброшен. Знак — тот, что
    // уже есть в размерах этого текста (×, х или x), иначе русская «х».
    const base = rejectReason ? text : corrected;
    const NUM = "\\d+(?:[.,]\\d+)?";
    const usedSep = (base.match(new RegExp(NUM + "\\s*([×хx])\\s*" + NUM)) || [])[1] || "х";
    // 2–3 числа подряд только через пробелы, не слитые с буквами, не
    // продолжающие уже записанный размер («12х8 5» не трогаем) и не часть
    // более длинного ряда чисел («1 2 3 4 5» — не размер).
    const SPACED = new RegExp("(?<![\\p{L}\\d.,×хx])(?<!\\d[ \\t]+)(" + NUM + ")((?:[ \\t]+" + NUM + "){1,2})(?![\\d\\p{L}×хx])(?![ \\t]+\\d)", "gu");
    const withDimensions = base.replace(SPACED, (m) => m.trim().split(/[ \t]+/).join(usedSep));

    // Случайные повторы — тоже точным правилом: если модель уберёт длинный
    // повтор, проверка её ответа его отклонит («слишком много изменений»).
    // Повтор слова или фразы до 6 слов подряд (в том числе через запятую,
    // без учёта регистра): «рога рога», «контуры ровные, контуры ровные».
    // Только слова из букв — числа («6 6 мм») не трогаем, это размер.
    const WORD = "\\p{L}[\\p{L}-]*";
    const REPEATED = new RegExp("(?<!\\p{L})(" + WORD + "(?:[ \\t]+" + WORD + "){0,5})(?:[ \\t]*,?[ \\t]+\\1)+(?!\\p{L})", "giu");
    let deduped = withDimensions;
    let previous;
    do {
        previous = deduped;
        deduped = deduped.replace(REPEATED, "$1");
    } while (deduped !== previous);
    deduped = deduped
        .replace(/([,;:])(?:[ \t]*\1)+/g, "$1")      // «,,» → «,»
        .replace(/(?<!\.)\.\.(?!\.)/g, ".")          // «..» → «.», многоточие не трогаем
        .replace(/(\S)[ \t]{2,}(?=\S)/g, "$1 ");     // двойные пробелы внутри строки

    return e.json(200, { corrected: deduped });
}, $apis.requireAuth("users"))
