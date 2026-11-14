/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/conclusion_rules.pb.js
//
// Сводка правил автозаключения: по парам «черновик ИИ → что врач в итоге
// скопировал» (hooks/usePhraseMemory.ts, conclusion_edits) модель выводит
// короткие правила — что врач не выносит в заключение, что добавляет,
// какие формулировки предпочитает. Правила уходят в каждый запрос
// автозаключения (conclude.pb.js), врач видит и правит их в окне
// «Выученные фразы» поля «Заключение».
//
// filler вызывает маршрут сам — раз в RULES_EVERY правок с изменениями
// (lib/phraseMemory.ts) — и по кнопке «Обновить по правкам».
// Модель — маршрут RULES (ANTHROPIC_MODEL_RULES / YANDEX_GPT_MODEL_RULES).
routerAdd("POST", "/api/conclusion-rules", (e) => {
    const ai = require(`${__hooks}/ai.js`);
    const proofread = require(`${__hooks}/proofread.js`);
    if (!ai.isConfigured()) {
        return e.json(503, { message: "ИИ не настроен" });
    }
    if (ai.rateLimited("conclusion_rules", e.auth.id, 5)) {
        return e.json(429, { message: "Слишком много запросов" });
    }

    const body = e.requestInfo().body || {};
    const clip = (v, max) => String(v == null ? "" : v).slice(0, max);
    const list = (v, maxItems, maxLen) => (Array.isArray(v) ? v : [])
        .slice(0, maxItems)
        .map((x) => clip(x, maxLen).replace(/\s+/g, " ").trim())
        .filter(Boolean);
    const templateTitle = clip(body.templateTitle, 200);
    const edits = (Array.isArray(body.edits) ? body.edits : [])
        .slice(0, 15)
        .map((x) => ({ draft: clip(x && x.draft, 1500).trim(), final: clip(x && x.final, 1500).trim() }))
        .filter((x) => x.draft && x.final);
    // Текущие правила ИИ — уточнить, а не начинать с нуля; правила врача —
    // не повторять; удалённые врачом — не выводить снова.
    const current = list(body.current, 20, 300);
    const manual = list(body.manual, 30, 300);
    const removed = list(body.removed, 30, 300);
    if (!edits.length) {
        return e.json(200, { rules: current });
    }

    const system = [
        "You help personalize an AI that drafts the Conclusion (impression) section of a radiologist's imaging reports.",
        "You get pairs: the AI draft and the conclusion the doctor finally signed after editing it. Infer the doctor's stable preferences from what they consistently delete, add, merge, reorder or rephrase (e.g. leave out minor degenerative changes, write \"синовит\" instead of \"признаки синовита\", do not mention the side, put the main diagnosis first).",
        "Write rules only for patterns supported by the pairs. Prefer patterns seen in two or more pairs; a single pair is enough only for a clear wording substitution. Pairs where the draft was accepted unchanged confirm the current behaviour - do not write rules against it.",
        "Each rule is one short imperative sentence in Russian (address the AI, e.g. \"Не выносить в заключение ...\", \"Писать «...» вместо «...»\"). Generalize from the specific case to the type of finding or wording, but do not copy patient-specific details, numbers or sides. No more than 12 rules, most important first.",
        "Keep the current rules that are still consistent with the pairs (you may reword or merge them), drop the ones the newer pairs contradict. Do not repeat the doctor's own rules. Never produce rules the doctor has deleted, or rules with the same meaning.",
        "Answer ONLY with JSON, no code fences: {\"rules\": [\"...\", ...]}. If there are no stable preferences, return an empty list.",
    ].join("\n");

    const parts = [];
    if (templateTitle) parts.push("Template: " + templateTitle);
    parts.push("Pairs, newest first (N stands for a number):\n" +
        edits.map((x, i) => (i + 1) + ") Draft: " + x.draft + "\n   Signed: " + x.final + (x.draft === x.final ? "\n   (accepted unchanged)" : "")).join("\n"));
    if (current.length) parts.push("Current rules:\n" + current.map((x) => "- " + x).join("\n"));
    if (manual.length) parts.push("The doctor's own rules (already applied, do not repeat):\n" + manual.map((x) => "- " + x).join("\n"));
    if (removed.length) parts.push("Rules the doctor deleted (never produce them again):\n" + removed.map((x) => "- " + x).join("\n"));

    const res = ai.complete(system, parts.join("\n\n"), { route: "RULES", maxTokens: 1200, timeout: 60, userId: e.auth.id });
    if (!res.ok) {
        return e.json(502, { message: "ИИ-сервис недоступен" });
    }
    const parsed = proofread.parseJson(res.text, null);
    if (!parsed || !Array.isArray(parsed.rules)) {
        console.log("[conclusion-rules] не разобран ответ модели:", res.text.slice(0, 300));
        return e.json(502, { message: "ИИ вернул непонятный ответ" });
    }
    const norm = (x) => x.toLowerCase().replace(/[^\p{L}\d]+/gu, " ").trim();
    const skip = new Set(manual.concat(removed).map(norm));
    const rules = list(parsed.rules, 12, 300).filter((x) => !skip.has(norm(x)));
    return e.json(200, { rules: rules, model: res.model });
}, $apis.requireAuth("users"))
