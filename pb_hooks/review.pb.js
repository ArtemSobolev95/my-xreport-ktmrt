/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/review.pb.js
//
// ИИ-проверка протокола целиком (filler: после паузы в «Заключении», кнопка
// в доке или Alt+K). Одним запросом:
//   1) правки текста по полям — опечатки, согласование, повторы; к тексту
//      поля их применяет и проверяет pb_hooks/proofread.js;
//   2) замечания по смыслу — противоречия, право/лево, находки без
//      заключения и заключение без находок, разные размеры одного и того же.
// Ничего не меняет само: врач видит исправления и замечания в правой панели.
//
// Модель — маршрут CORRECT (ANTHROPIC_MODEL_CORRECT / YANDEX_GPT_MODEL_CORRECT):
// та же быстрая модель, что раньше проверяла поле по отдельности.
routerAdd("POST", "/api/review", (e) => {
    const ai = require(`${__hooks}/ai.js`);
    const proofread = require(`${__hooks}/proofread.js`);
    if (!ai.isConfigured()) {
        return e.json(503, { message: "ИИ-проверка не настроена" });
    }
    if (ai.rateLimited("review", e.auth.id, 15)) {
        return e.json(429, { message: "Слишком много запросов" });
    }

    const body = e.requestInfo().body || {};
    const clip = (v, max) => String(v == null ? "" : v).slice(0, max);
    const templateTitle = clip(body.templateTitle, 200);
    const report = clip(body.report, 10000);
    // Язык замечаний — язык интерфейса (сейчас всегда русский), а не языка
    // протокола: модель иногда отвечала по-английски.
    const LANGUAGES = { ru: "Russian", en: "English" };
    const language = LANGUAGES[clip(body.lang, 5)] || "Russian";
    // Поля, которые врач заполнил: { id, label, section, text }.
    const fields = (Array.isArray(body.fields) ? body.fields : [])
        .slice(0, 80)
        .map((f) => ({
            id: clip(f && f.id, 100),
            label: clip(f && f.label, 200),
            section: clip(f && f.section, 200),
            text: clip(f && f.text, 3000),
            isConclusion: !!(f && f.isConclusion),
        }))
        .filter((f) => f.id && f.text.trim());
    if (!fields.length && !report.trim()) {
        return e.json(200, { corrections: [], issues: [] });
    }

    // Проверка сдержанная: только то, что врач просил ловить, без замечаний
    // по стилю, размерам и подробности описания.
    const system = [
        "You check a diagnostic imaging report (radiography, CT, MRI) before the radiologist signs it. Be restrained: report only real errors of the kinds listed below and ignore everything else (style, wording, level of detail, measurements, normal descriptions, patient management). When in doubt, say nothing.",
        "1) Edits inside each field, only: wrong word endings - agreement in gender, number and case; obvious misspellings; punctuation errors inside the text (missing or extra commas). Accidentally duplicated words.",
        "A period at the end of every field is added automatically - never add one. Capital and lowercase letters at the start of fields are handled automatically - do not change them.",
        "Do not rephrase or add anything. Do not change the meaning, medical terms, word order, numbers or units. Keep abbreviations and Latin-script terms (T2, STIR, PD, Stoller, CT, MRI) exactly as they are. Do NOT replace the Russian letter \u0435 with \u0451, do NOT replace hyphens with dashes, do NOT touch spaces around hyphens.",
        "2) Remarks, only two kinds: a clinically significant finding from the descriptive part that is missing from the conclusion; a side mismatch (right/left) between the description and the conclusion or between fields. No other remarks.",
        "Answer ONLY with JSON, no code fences: {\"edits\": [[\"field id\", \"wrong fragment\", \"fixed fragment\"], ...], \"issues\": [[\"field id or empty\", \"short description\"], ...]}. If there is nothing to report, return empty lists.",
        "Copy each wrong fragment exactly as it appears in that field (a word or a few words); if it occurs more than once in the field, include a neighbouring word so it is unique. To remove a duplicate, include it in the fragment and leave it out of the fix.",
        "Write issue descriptions ONLY in " + language + ", in one short sentence; point the issue to the field that should be changed (usually the conclusion), or leave the id empty.",
    ].join("\n");

    const parts = [];
    if (templateTitle) parts.push("Template: " + templateTitle);
    if (fields.length) {
        parts.push("Fields filled by the doctor (id, section / label, text):\n\n" + fields.map((f) =>
            "[" + f.id + "] " + (f.section ? f.section + " / " : "") + (f.label || "field") + (f.isConclusion ? " (CONCLUSION)" : "") + ":\n" + f.text).join("\n\n"));
    }
    if (report) parts.push("The whole report as it will be signed (normal values from the template included):\n" + report);

    const res = ai.complete(system, parts.join("\n\n"), { route: "CORRECT", maxTokens: 1500, timeout: 30, userId: e.auth.id });
    if (!res.ok) {
        return e.json(502, { message: "ИИ-сервис недоступен" });
    }
    const parsed = proofread.parseJson(res.text, null);
    if (!parsed) console.log("[review] не разобран ответ модели:", res.text.slice(0, 300));
    const answer = parsed && typeof parsed === "object" ? parsed : {};

    // Правки — по полям; к каждому полю применяются и точные правила
    // (размеры, повторы), даже если модель его не трогала.
    const editsByField = {};
    for (const edit of Array.isArray(answer.edits) ? answer.edits : []) {
        const id = Array.isArray(edit) ? edit[0] : edit && edit.field;
        const from = Array.isArray(edit) ? edit[1] : edit && edit.from;
        const to = Array.isArray(edit) ? edit[2] : edit && edit.to;
        if (typeof id !== "string") continue;
        (editsByField[id] = editsByField[id] || []).push([from, to]);
    }
    // Регистр и точка в конце — точными правилами, не моделью: текстовое
    // поле начинается со строчной буквы (кроме аббревиатур: «МР-признаки»,
    // «КТ»), заключение — с заглавной; точку в конце поля протокол ставит
    // сам, поэтому добавленная моделью точка убирается.
    const fixCase = (text, isConclusion) => {
        const at = text.search(/\S/);
        if (at === -1) return text;
        const firstWord = (text.slice(at).match(/^[\p{L}\d]+/u) || [""])[0];
        const isAbbreviation = firstWord.length >= 2 && firstWord === firstWord.toUpperCase() && /\p{L}/u.test(firstWord);
        const ch = text[at];
        const fixed = isConclusion ? ch.toUpperCase() : (isAbbreviation ? ch : ch.toLowerCase());
        return text.slice(0, at) + fixed + text.slice(at + 1);
    };
    const corrections = [];
    for (const f of fields) {
        let corrected = proofread.finalize(f.text, editsByField[f.id] || [], "review");
        if (!/[.!?…]\s*$/.test(f.text)) corrected = corrected.replace(/(?<!\.)\.(\s*)$/, "$1");
        corrected = fixCase(corrected, f.isConclusion);
        if (corrected !== f.text) corrections.push({ field: f.id, original: f.text, corrected: corrected });
    }

    const issues = (Array.isArray(answer.issues) ? answer.issues : [])
        .slice(0, 6)
        .map((x) => {
            const id = Array.isArray(x) ? x[0] : x && x.field;
            const text = Array.isArray(x) ? x[1] : x && (x.text || x.message);
            return { field: typeof id === "string" ? id : "", text: clip(text, 400).trim() };
        })
        .filter((x) => x.text)
        // Замечание не на том языке (по-русски — без единой кириллической
        // буквы) отбрасываем, а не показываем.
        .filter((x) => language !== "Russian" || /[\u0400-\u04FF]/.test(x.text));

    return e.json(200, { corrections: corrections, issues: issues, model: ai.modelFor("CORRECT") });
}, $apis.requireAuth("users"))
