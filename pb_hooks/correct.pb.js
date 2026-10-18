/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/correct.pb.js
//
// ИИ-проверка текстового поля в filler (вызывается, когда курсор уходит из
// поля): опечатки и согласование — род, число, падеж. Возвращает
// исправленный текст; показывать/применять правку решает пользователь.
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
        "Fix ONLY: typos and spelling; agreement of words in gender, number and case (in languages that have them); obvious grammatical errors.",
        "Do not rephrase or add anything. Do not change the meaning, medical terms, word order, numbers or units.",
        "Keep abbreviations and Latin-script terms (T2, STIR, PD, Stoller, CT, MRI) exactly as they are.",
        "Keep line breaks and punctuation; change punctuation only if the phrase is grammatically wrong without it.",
        "Do NOT capitalize the first letter of the text, do NOT replace the Russian letter \u0435 with \u0451, do NOT replace hyphens with dashes, do NOT touch spaces around hyphens - keep them as the doctor wrote.",
        "Keep the text in its original language.",
        "If there are no errors, return the text unchanged.",
        "Return only the resulting text, without quotes or explanations.",
    ].join("\n");
    const user = (fieldLabel ? "Report field: " + fieldLabel + "\n\n" : "") + "Text:\n" + text;

    // Ответ — тот же текст: токенов нужно примерно столько же, сколько во входе
    // (~3 символа на токен), с запасом.
    const res = ai.complete(system, user, {
        route: "CORRECT",
        maxTokens: Math.min(2000, Math.ceil(text.length / 2) + 50),
        timeout: 20,
    });
    if (!res.ok) {
        return e.json(502, { message: "ИИ-сервис недоступен" });
    }

    let corrected = res.text.replace(/^\s*((Текст|Text):\s*)?/, "").replace(/^["«»]+|["«»]+$/g, "");
    // Модель обычно отрезает пробелы/переносы по краям — возвращаем исходные.
    corrected = text.match(/^\s*/)[0] + corrected.trim() + text.match(/\s*$/)[0];

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
        return e.json(200, { corrected: text });
    }
    return e.json(200, { corrected: corrected });
}, $apis.requireAuth("users"))
