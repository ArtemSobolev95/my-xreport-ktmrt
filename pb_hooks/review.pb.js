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
    // Поля, которые врач заполнил: { id, label, section, text }.
    const fields = (Array.isArray(body.fields) ? body.fields : [])
        .slice(0, 80)
        .map((f) => ({
            id: clip(f && f.id, 100),
            label: clip(f && f.label, 200),
            section: clip(f && f.section, 200),
            text: clip(f && f.text, 3000),
        }))
        .filter((f) => f.id && f.text.trim());
    if (!fields.length && !report.trim()) {
        return e.json(200, { corrections: [], issues: [] });
    }

    const system = [
        "You check a diagnostic imaging report (radiography, CT, MRI) before the radiologist signs it. Two tasks.",
        "1) Proofreading of each field: fix ONLY typos and spelling; agreement of words in gender, number and case (in languages that have them); obvious grammatical errors; accidentally duplicated words or phrases.",
        "Do not rephrase or add anything. Do not change the meaning, medical terms, word order, numbers or units. Keep abbreviations and Latin-script terms (T2, STIR, PD, Stoller, CT, MRI) exactly as they are.",
        "Do NOT capitalize the first letter of a field, do NOT replace the Russian letter е with ё, do NOT replace hyphens with dashes, do NOT touch spaces around hyphens.",
        "2) Consistency of the report as a whole - report only real problems: contradictions between fields (e.g. \"no pathology\" next to a described lesion); left/right or sex mismatches; significant findings that are missing from the conclusion; diagnoses in the conclusion that the findings do not support; different measurements of the same structure.",
        "Do not comment on style, on how detailed the normal descriptions are, or on patient management. If there is nothing to report, return empty lists.",
        "Answer ONLY with JSON, no code fences: {\"edits\": [[\"field id\", \"wrong fragment\", \"fixed fragment\"], ...], \"issues\": [[\"field id or empty\", \"short description\"], ...]}.",
        "Copy each wrong fragment exactly as it appears in that field (a word or a few words); if it occurs more than once in the field, include a neighbouring word so it is unique. To remove a duplicate, include it in the fragment and leave it out of the fix.",
        "Write issue descriptions in the language of the report, in one short sentence; point the issue to the field that should be changed (usually the conclusion), or leave the id empty.",
    ].join("\n");

    const parts = [];
    if (templateTitle) parts.push("Template: " + templateTitle);
    if (fields.length) {
        parts.push("Fields filled by the doctor (id, section / label, text):\n\n" + fields.map((f) =>
            "[" + f.id + "] " + (f.section ? f.section + " / " : "") + (f.label || "field") + ":\n" + f.text).join("\n\n"));
    }
    if (report) parts.push("The whole report as it will be signed (normal values from the template included):\n" + report);

    const res = ai.complete(system, parts.join("\n\n"), { route: "CORRECT", maxTokens: 1500, timeout: 30 });
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
    const corrections = [];
    for (const f of fields) {
        const corrected = proofread.finalize(f.text, editsByField[f.id] || [], "review");
        if (corrected !== f.text) corrections.push({ field: f.id, original: f.text, corrected: corrected });
    }

    const issues = (Array.isArray(answer.issues) ? answer.issues : [])
        .slice(0, 12)
        .map((x) => {
            const id = Array.isArray(x) ? x[0] : x && x.field;
            const text = Array.isArray(x) ? x[1] : x && (x.text || x.message);
            return { field: typeof id === "string" ? id : "", text: clip(text, 400).trim() };
        })
        .filter((x) => x.text);

    return e.json(200, { corrections: corrections, issues: issues, model: ai.modelFor("CORRECT") });
}, $apis.requireAuth("users"))
