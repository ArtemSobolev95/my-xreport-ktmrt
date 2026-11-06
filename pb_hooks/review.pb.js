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
    const style = require(`${__hooks}/style.js`);
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
        "You check a diagnostic imaging report (radiography, CT, MRI) before the radiologist signs it. Report only real errors of the kinds listed below and ignore everything else (style, wording, level of detail, measurements, normal descriptions, patient management).",
        "1) Edits inside each field. Language errors must be found completely in ONE pass: go through every field sentence by sentence, word by word, and fix ALL of them at once, not just the first few:",
        "- agreement: every adjective, participle, pronoun and ordinal numeral agrees with its noun in gender, number and case (also in homogeneous and long attributive phrases: \"участок неоднородной структуры\", \"кисты, заполненные жидкостью\"); the verb / short adjective agrees with its subject (\"мениск не изменен\", \"связки прослеживаются\"); a preposition takes the right case (\"по передней поверхности\", \"в области заднего рога\"); a noun after a numeral takes the right form (\"2 кисты\", \"5 кист\", \"1,5 см\");",
        "- obvious misspellings and accidentally duplicated or missing letters; accidentally duplicated words;",
        "- punctuation inside the text: commas around participial and adverbial phrases, between homogeneous members and parts of compound sentences, around introductory words and comparative phrases (\"вероятно,\", \"по-видимому,\"); missing or extra commas; a missing space after a punctuation mark;",
        "- letter case inside a field: a capital letter after a sentence-ending period in the middle of a field; a lowercase letter for a word in the middle of a sentence that was capitalized by mistake (proper names, eponyms and abbreviations keep their capitals);",
        "- forbidden phrasings (below): rewrite them with a minimal edit, keeping the grammar correct.",
        "A period at the end of every field is added automatically - never add one. Capital and lowercase letters at the very start of fields are handled automatically - do not change them.",
        "Do not rephrase or add anything. Do not change the meaning, medical terms, word order, numbers or units. Keep abbreviations and sequence names (T2, STIR, PD, CT, MRI) exactly as they are, including their case. Do NOT replace the Russian letter \u0435 with \u0451, do NOT replace hyphens with dashes, do NOT touch spaces around hyphens.",
        style.ENGLISH_TERMS,
        style.SEGMENTS,
        "2) Remarks, only three kinds. Be restrained here: when in doubt, say nothing.",
        "\"missing\" - a clinically significant finding from the descriptive part that is not reflected in the conclusion at all. The conclusion is a generalized summary, so ALL of the following are NOT missing and must not be reported: a finding named in the conclusion in other words, by a synonym or by a broader / generalizing diagnosis (description \"гиперплазия синовиальной оболочки\" - conclusion \"синовит\"; \"отек жировой клетчатки вокруг сустава\" - \"отек мягких тканей\"; osteophytes, narrowed joint space and subchondral sclerosis - \"остеоартроз\"; disc protrusions, Modic changes and spondylosis - \"остеохондроз\" or \"дегенеративные изменения\"); sizes, measurements, signal or density characteristics, exact location or number of lesions that are absent from the conclusion; several findings combined into one statement; findings the doctor described as of doubtful, uncertain or no clinical significance, as incidental or as a variant of normal. Report \"missing\" only for a separate significant pathology that the conclusion does not mention or imply in any form.",
        "\"side\" - ONLY a real contradiction: the side (right/left) of the same finding is stated explicitly in the description and stated differently in the conclusion (or in two fields). If the side is not stated in one of the places, or not stated anywhere (e.g. the report does not say whether it is the right or the left joint), that is NOT an error - say nothing.",
        "\"detail\" - essential information about a pathological finding that is missing from the WHOLE report (description and conclusion), e.g. the stage of an ischemic stroke or a classification grade where one is clearly expected (only for pathological findings, only what is really expected for this finding, one remark per finding). Never ask for the side. Never ask for sizes or other details to appear in the conclusion: if they are in the descriptive part, everything is fine.",
        "No other remarks.",
        "Answer ONLY with JSON, no code fences: {\"edits\": [[\"field id\", \"wrong fragment\", \"fixed fragment\"], ...], \"issues\": [[\"field id or empty\", \"missing|side|detail\", \"short description\"], ...]}. If there is nothing to report, return empty lists.",
        "One edit per error. Copy each wrong fragment exactly as it appears in that field (the wrong word with one or two neighbouring words, no more); if it occurs more than once in the field, include a neighbouring word so it is unique. To remove a duplicate, include it in the fragment and leave it out of the fix.",
        "Write issue descriptions ONLY in " + language + ", in one short sentence without repeating the kind (e.g. \"Киста Baker\", \"Описание справа, в заключении слева\", \"Не указана стадия инфаркта\"); point the issue to the field that should be changed (usually the conclusion), or leave the id empty.",
        "Forbidden phrasings:",
    ].concat(style.FORBIDDEN).join("\n");

    const parts = [];
    if (templateTitle) parts.push("Template: " + templateTitle);
    if (fields.length) {
        parts.push("Fields filled by the doctor (id, section / label, text):\n\n" + fields.map((f) =>
            "[" + f.id + "] " + (f.section ? f.section + " / " : "") + (f.label || "field") + (f.isConclusion ? " (CONCLUSION)" : "") + ":\n" + f.text).join("\n\n"));
    }
    if (report) parts.push("The whole report as it will be signed (normal values from the template included):\n" + report);

    const res = ai.complete(system, parts.join("\n\n"), { route: "CORRECT", maxTokens: 3000, timeout: 45, userId: e.auth.id });
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
        // Регистр сегментов (Th12, L5-S1) — точным правилом: модель не
        // должна его «исправлять», и правка, которая только портит его,
        // становится пустой.
        if (typeof from !== "string" || typeof to !== "string") continue;
        (editsByField[id] = editsByField[id] || []).push([style.fixSegmentCase(from), style.fixSegmentCase(to)]);
    }
    // Регистр и точка в конце — точными правилами, не моделью: текстовое
    // поле начинается со строчной буквы (кроме аббревиатур: «МР-признаки»,
    // «КТ»), заключение — с заглавной; точку в конце поля протокол ставит
    // сам, поэтому добавленная моделью точка убирается.
    const fixCase = (text, isConclusion) => {
        const at = text.search(/\S/);
        if (at === -1) return text;
        const firstWord = (text.slice(at).match(/^[\p{L}\d]+/u) || [""])[0];
        // Регистр не трогаем у аббревиатур («МР», «КТ») и обозначений с
        // цифрами или заглавной не в начале — позвонки и сегменты «Th12»,
        // «L5-S1», «C2», режимы «T2».
        const isAbbreviation = (firstWord.length >= 2 && firstWord === firstWord.toUpperCase() && /\p{L}/u.test(firstWord)) ||
            /\d/.test(firstWord) || /^\p{L}+\p{Lu}/u.test(firstWord) || /^(C|Co|Th|T|L|S)(?![a-z])/.test(text.slice(at));
        const ch = text[at];
        const fixed = isConclusion ? ch.toUpperCase() : (isAbbreviation ? ch : ch.toLowerCase());
        return text.slice(0, at) + fixed + text.slice(at + 1);
    };
    const corrections = [];
    for (const f of fields) {
        let corrected = proofread.finalize(style.fixSegmentCase(f.text), editsByField[f.id] || [], "review");
        if (!/[.!?…]\s*$/.test(f.text)) corrected = corrected.replace(/(?<!\.)\.(\s*)$/, "$1");
        corrected = fixCase(corrected, f.isConclusion);
        if (corrected !== f.text) corrections.push({ field: f.id, original: f.text, corrected: corrected });
    }

    const issues = (Array.isArray(answer.issues) ? answer.issues : [])
        .slice(0, 8)
        .map((x) => {
            // [id, kind, text] (или старый формат [id, text]).
            const KINDS = ["missing", "side", "detail"];
            const arr = Array.isArray(x) ? x : null;
            const id = arr ? arr[0] : x && x.field;
            const kind = arr ? (arr.length >= 3 ? arr[1] : "") : x && x.kind;
            const text = arr ? arr[arr.length >= 3 ? 2 : 1] : x && (x.text || x.message);
            return {
                field: typeof id === "string" ? id : "",
                kind: KINDS.indexOf(kind) !== -1 ? kind : "",
                text: clip(text, 400).trim(),
            };
        })
        .filter((x) => x.text)
        // Замечание не на том языке (по-русски — без единой кириллической
        // буквы) отбрасываем, а не показываем.
        .filter((x) => language !== "Russian" || /[\u0400-\u04FF]/.test(x.text));

    return e.json(200, { corrections: corrections, issues: issues, model: ai.modelFor("CORRECT") });
}, $apis.requireAuth("users"))
