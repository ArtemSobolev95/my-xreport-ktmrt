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
    // «Состояние после …» из примечания (операция, вмешательство) — первой
    // строкой заключения. Предложение до точки перед следующим предложением
    // (точки в датах «12.05.2024» его не обрывают).
    const note = clip(body.note, 2000);
    const stateAfter = ((note.match(/(?:^|[\n.!?]\s*)((?:состояние|сост\.)\s+после[^\n]*?)(?=\.\s+[А-ЯЁA-Z]|\.?\s*\n|\.?\s*$)/i) || [])[1] || "").trim().replace(/^./, (ch) => ch.toUpperCase());
    if (!findings.trim()) {
        return e.json(200, { conclusion: "", model: "" });
    }

    const system = [
        "You are a radiologist's assistant. Write the Conclusion (impression) section of a diagnostic imaging report based on its findings.",
        "The conclusion is a short, generalized summary: diagnoses and key conclusions only. Do NOT repeat measurements, sizes, volumes, signal or density characteristics, locations in detail or other descriptive details - they stay in the descriptive part. Combine related findings into one diagnostic statement; name each clinically significant finding briefly, most important first.",
        "Write in the language of the report. Follow the doctor's style: wording, abbreviations, how diagnoses are phrased and joined - but keep the conclusion generalized even if their previous conclusions are more detailed.",
        "Use the terminology of radiology literature and international structured reporting (RSNA RadReport templates, ACR lexicons) and established classifications and grades (e.g. Stoller, Outerbridge, Fleischner, TI-RADS, Bosniak) where the findings support them - phrased the way this doctor writes, in the report's language.",
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
    if (stateAfter) parts.push("Start the conclusion with this line from the doctor's note, word for word: " + stateAfter);
    if (current.trim()) parts.push("The doctor has already written in the " + (fieldLabel || "Conclusion") + " field:\n" + current);

    const model = ai.modelFor("CONCLUDE");
    const res = ai.complete(system, parts.join("\n\n"), { route: "CONCLUDE", maxTokens: 600, timeout: 40 });
    if (!res.ok) {
        return e.json(502, { message: "ИИ-сервис недоступен" });
    }
    let conclusion = res.text
        .trim()
        .replace(/^(\*\*)?(Заключение|Conclusion|Impression)(\*\*)?\s*:\s*/i, "")
        .replace(/^["«]+|["»]+$/g, "")
        .trim();
    // «Состояние после …» — первым, даже если модель его пропустила или
    // поставила не туда.
    if (stateAfter && conclusion) {
        const norm = (x) => x.toLowerCase().replace(/[\s.]+/g, " ").trim();
        if (!norm(conclusion).startsWith(norm(stateAfter))) {
            const at = norm(conclusion).indexOf(norm(stateAfter));
            if (at === -1) conclusion = stateAfter.replace(/\.$/, "") + ". " + conclusion;
            else {
                // Модель поставила строку не первой — переносим в начало.
                const re = new RegExp(stateAfter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+") + "\\.?\\s*", "i");
                const rest = conclusion.replace(re, "").trim();
                conclusion = stateAfter.replace(/\.$/, "") + ". " + rest.charAt(0).toUpperCase() + rest.slice(1);
            }
        }
    }
    // Точку в конце поля протокол ставит сам; заглавная — в начале заключения.
    conclusion = conclusion.replace(/(?<!\.)\.$/, "");
    conclusion = conclusion.charAt(0).toUpperCase() + conclusion.slice(1);
    return e.json(200, { conclusion: conclusion.slice(0, 3000), model: model });
}, $apis.requireAuth("users"))
