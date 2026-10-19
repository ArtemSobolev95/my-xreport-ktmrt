/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/conclude.pb.js
//
// Автозаключение в filler: по находкам протокола модель формулирует
// «Заключение» словами самого врача (его прошлые заключения и фразы из
// памяти фраз, lib/phraseMemory.ts). Ничего не вставляет само — врач видит
// предложенный текст и вставляет или отклоняет его.
//
// Провайдер (YandexGPT / Claude), вызов модели и лимит запросов — в
// pb_hooks/ai.js. Здесь задержка менее важна, чем у подсказок, — важнее
// качество: у Claude по умолчанию «размышление» включено (effort medium).
routerAdd("POST", "/api/conclude", (e) => {
    const ai = require(`${__hooks}/ai.js`);
    if (!ai.isConfigured()) {
        return e.json(503, { message: "ИИ-заключение не настроено" });
    }
    // Запрос — по кнопке: 10 в минуту с запасом.
    if (ai.rateLimited("conclude", e.auth.id, 10)) {
        return e.json(429, { message: "Слишком много запросов" });
    }

    const body = e.requestInfo().body || {};
    const clip = (v, max) => String(v == null ? "" : v).slice(0, max);
    const list = (v, maxItems, maxLen) => (Array.isArray(v) ? v : [])
        .slice(0, maxItems)
        .map((x) => clip(x, maxLen).trim())
        .filter(Boolean);
    const templateTitle = clip(body.templateTitle, 200);
    const fieldLabel = clip(body.fieldLabel, 200);
    // Находки — поля, которые врач изменил относительно нормы шаблона.
    const findings = clip(body.findings, 4000);
    // Протокол целиком (с нормами) — чтобы понимать, что осталось в норме.
    const report = clip(body.report, 8000);
    // То, что врач уже написал в заключении, — сохранить и дополнить.
    const current = clip(body.current, 2000);
    // Прошлые заключения по этому шаблону и типичные фразы заключения.
    const recent = list(body.recent, 6, 1500);
    const examples = list(body.examples, 40, 200);
    const normal = clip(body.normal, 500);
    if (!findings.trim()) {
        return e.json(200, { conclusion: "", model: "" });
    }

    const system = [
        "You are a radiologist's assistant. Write the Conclusion (impression) section of a diagnostic imaging report based on its findings.",
        "Write in the language of the report. Copy the doctor's style: wording, order, abbreviations, punctuation, capitalization, how diagnoses are phrased and joined - follow their previous conclusions and typical phrases closely.",
        "Include every significant finding, most clinically important first; group related findings. Use established diagnostic terms and classification grades only when the findings support them.",
        "Do not invent findings, measurements, sides or diagnoses that are not in the findings. Do not mention normal structures unless the doctor's previous conclusions usually do.",
        "Add recommendations only if the doctor's previous conclusions contain them.",
        "If the doctor has already started the conclusion, keep their text as is and complete it.",
        "Return only the conclusion text, without a heading, quotes or explanations.",
    ].join("\n");

    const parts = [];
    if (templateTitle) parts.push("Template: " + templateTitle);
    if (recent.length) {
        parts.push("The doctor's previous conclusions for this template (N stands for a number):\n" + recent.map((x, i) => (i + 1) + ") " + x).join("\n"));
    }
    if (examples.length) {
        parts.push("The doctor's typical conclusion phrases (N stands for a number):\n" + examples.map((x) => "- " + x).join("\n"));
    }
    if (normal) parts.push("The template's conclusion for a normal study: " + normal);
    // В протоколе может стоять и старый текст заключения (или норма шаблона) —
    // это не находка.
    if (report) parts.push("Full report (normal values included; ignore any conclusion already in it - you are writing a new one):\n" + report);
    parts.push("Findings - what differs from normal in this study:\n" + findings);
    if (current.trim()) parts.push("The doctor has already written in the " + (fieldLabel || "Conclusion") + " field:\n" + current);

    const model = ai.modelFor("CONCLUDE");
    const res = ai.complete(system, parts.join("\n\n"), { route: "CONCLUDE", maxTokens: 600, timeout: 40 });
    if (!res.ok) {
        return e.json(502, { message: "ИИ-сервис недоступен" });
    }
    const conclusion = res.text
        .trim()
        .replace(/^(\*\*)?(Заключение|Conclusion|Impression)(\*\*)?\s*:\s*/i, "")
        .replace(/^["«]+|["»]+$/g, "")
        .trim();
    return e.json(200, { conclusion: conclusion.slice(0, 3000), model: model });
}, $apis.requireAuth("users"))
