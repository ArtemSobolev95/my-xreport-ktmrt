/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/suggest.pb.js
//
// ИИ-подсказки при наборе в filler (ghost-text): браузер шлёт сюда текст
// поля до курсора и примеры формулировок пользователя (его же память фраз,
// см. lib/phraseMemory.ts), сервер спрашивает модель и возвращает
// продолжение. Запрос идёт с сервера, а не из браузера: ключ API не
// попадает к пользователям.
//
// Провайдер (YandexGPT / Claude), вызов модели и лимит запросов — в
// pb_hooks/ai.js. Без ключа маршрут отвечает 503 — фронтенд в этом случае
// просто не показывает подсказки.
//
// Инструкции модели — на английском: протоколы пишут на разных языках, и
// модель отвечает на языке самого текста поля.
routerAdd("POST", "/api/suggest", (e) => {
    const ai = require(`${__hooks}/ai.js`);
    const style = require(`${__hooks}/style.js`);
    if (!ai.isConfigured()) {
        return e.json(503, { message: "ИИ-подсказки не настроены" });
    }
    // Фронтенд шлёт запрос только после паузы в наборе, так что живому
    // человеку 40 в минуту хватает с запасом, а скрипту — нет.
    if (ai.rateLimited("suggest", e.auth.id, 40)) {
        return e.json(429, { message: "Слишком много запросов" });
    }

    const body = e.requestInfo().body || {};
    const clip = (v, max) => String(v == null ? "" : v).slice(0, max);
    // Берём хвост, а не начало: продолжение зависит от последних слов.
    const textBefore = String(body.textBefore == null ? "" : body.textBefore).slice(-2000);
    const fieldLabel = clip(body.fieldLabel, 200);
    const templateTitle = clip(body.templateTitle, 200);
    const isConclusion = body.isConclusion === true;
    const findings = clip(body.findings, 2500);
    const list = (v, maxItems, maxLen) => (Array.isArray(v) ? v : [])
        .slice(0, maxItems)
        .map((x) => clip(x, maxLen).trim())
        .filter(Boolean);
    // Фразы пользователя, отобранные под набранный текст (lib/phraseMemory.ts → selectExamples).
    const examples = list(body.examples, 25, 200);
    // Последние целые тексты этого поля — как пользователь строит описание.
    const recent = list(body.recent, 3, 1000);
    // Заготовки шаблона для поля: норма (placeholder) и — только пока у поля
    // мало выученных фраз — подходящие к набранному фразы быстрых кнопок
    // (отбор — на клиенте).
    const vocabulary = list(body.vocabulary, 30, 200);
    // Подсказки, которые врач в этом поле отклонил или проигнорировал.
    const avoid = list(body.avoid, 10, 300);
    // Уже заполненные другие поля протокола — чтобы не противоречить им.
    const context = clip(body.context, 2500);

    const system = [
        "You help a radiologist write an imaging report faster: you complete the text of a report field, like an autocomplete suggestion while typing.",
        "Return ONLY the continuation from the cursor position: no quotes, no explanations, never repeat what is already written.",
        "Write in the same language as the field text (for example Russian or English). Keep the doctor's terminology, including English terms and abbreviations exactly as they use them.",
        "If the cursor is inside an unfinished word, start your answer with that whole word.",
        "The continuation is at most one phrase, up to the nearest comma or period (do not write the punctuation mark itself).",
        "Sources of wording, in order of priority: 1) this doctor's own wording - how they filled this field before and their typical phrases (below); always prefer it when it fits. 2) The template phrases. 3) Standard terminology of radiology literature and international structured reporting (RSNA RadReport templates, ACR lexicons, established classifications such as Stoller, Outerbridge, Fleischner, TI-RADS, Bosniak) - use it when the doctor's phrases do not cover what is being described, in the field's language and with the terms conventionally used in that language.",
        "Use a classification grade or a diagnosis only if the text already describes findings that justify it.",
        "Do not invent numbers or measurements: if a number should come next, stop right before it.",
        "If there is no confident continuation, return an empty answer - not a single character. Never write explanations such as \"there is no continuation\".",
        "Never describe the cursor, the field, the text or your reasoning, and never answer in another language than the field text: your answer is pasted into the report as is.",
    ].concat(style.FORBIDDEN).join("\n");

    const parts = [];
    if (templateTitle) parts.push("Template: " + templateTitle);
    parts.push("Field: " + (fieldLabel || (isConclusion ? "Conclusion" : "text field")));
    if (recent.length) {
        parts.push("How the doctor filled this field in previous reports (N stands for a number):\n" + recent.map((x, i) => (i + 1) + ") " + x).join("\n"));
    }
    if (examples.length) {
        parts.push("The doctor's typical phrases for this field, most relevant first (N stands for a number):\n" + examples.map((x) => "- " + x).join("\n"));
    }
    if (vocabulary.length) {
        parts.push("Template phrases for this field:\n" + vocabulary.map((x) => "- " + x).join("\n"));
    }
    if (context) {
        parts.push("Findings already described in other fields of this report (the continuation must not contradict them):\n" + context);
    }
    if (avoid.length) {
        parts.push("The doctor rejected these suggestions for this field - do not suggest them or anything close to them:\n" + avoid.map((x) => "- " + x).join("\n"));
    }
    if (isConclusion && findings) {
        parts.push("Study findings - what differs from normal (the conclusion must match them):\n" + findings);
    }
    parts.push("Field text, the cursor is marked \u27e8|\u27e9:\n" + textBefore + "\u27e8|\u27e9");
    // Курсор сразу после буквы — слово недописано. Без явного указания
    // модель часто возвращает только окончание слова, и на стыке не понять,
    // нужен ли пробел; с ним — начинает ответ со слова целиком.
    const partial = (textBefore.match(/[^\s.,;:!?()«»"'\/]+$/) || [""])[0];
    if (partial) {
        parts.push("The cursor is inside the unfinished word \"" + partial + "\". Start your answer with this whole word (e.g. \"" + partial + "...\"), with no space before it.");
    }

    const model = ai.modelFor("SUGGEST");
    const res = ai.complete(system, parts.join("\n\n"), { route: "SUGGEST", maxTokens: 60, userId: e.auth.id });
    if (!res.ok) {
        return e.json(502, { message: "ИИ-сервис недоступен" });
    }

    // Модель иногда вместо пустого ответа пишет пояснение («в данном случае
    // продолжения нет», "there is no continuation") — это не подсказка.
    const META_ANSWER = /(продолжени[яе]\s+(нет|отсутству)|нет\s+(подходящ|уместн|продолжени)|не\s+(могу|удаётся|удается)\s+(предлож|продолж|подобр)|невозможно\s+(предлож|продолж)|извин|к\s+сожалению|недостаточно\s+(данных|информац|контекст)|no\s+(suitable\s+|confident\s+|clear\s+)?continuation|(cannot|can't|unable\s+to)\s+(suggest|continue|complete|provide)|\bsorry\b|not\s+enough\s+(context|information))/i;
    // То же по-английски — о курсоре, поле, тексте: «the cursor is after a
    // space», «nothing to add», «the text is complete». Без оборотов, которые
    // бывают в английском протоколе («no further abnormality»).
    const META_ANSWER_EN = /\b(cursor|nothing\s+(more\s+)?to\s+(add|suggest)|already\s+(complete|finished|ends)|(field|text|sentence|phrase)\s+(is|seems|appears|looks)\s+(complete|finished|empty)|empty\s+(answer|response|string)|n\/a)\b/i;
    // Ответ на другом языке, чем текст врача: в русском протоколе — целые
    // английские слова без единой кириллической буквы. Короткие термины
    // латиницей (T2, STIR, PD) так не отсекаются: в них нет строчных слов.
    const fieldText = textBefore + " " + recent.join(" ") + " " + examples.join(" ");
    const wrongLanguage = /[\u0400-\u04FF]/.test(fieldText) && !/[\u0400-\u04FF]/.test(res.text) &&
        (res.text.match(/\b[a-z]{3,}\b/g) || []).length >= 2;
    const isMeta = META_ANSWER.test(res.text) || META_ANSWER_EN.test(res.text) || wrongLanguage;
    if (isMeta && res.text.trim()) console.log("[suggest] отброшен ответ-пояснение:", res.text.slice(0, 120));
    const text = isMeta ? "" : res.text;

    // model — для статистики на клиенте: точность моделей видна раздельно.
    return e.json(200, { text: text.slice(0, 300), model: model });
}, $apis.requireAuth("users"))
