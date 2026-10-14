/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/correct.pb.js
//
// ИИ-проверка текстового поля в filler (вызывается, когда курсор уходит из
// поля): опечатки и согласование — род, число, падеж. Возвращает
// исправленный текст; показывать/применять правку решает пользователь.
//
// Медицинский текст: модель не должна «улучшать» описание. Поэтому ответ
// проверяется здесь же и отбрасывается (возвращается исходный текст), если
// изменились числа, латинские термины/аббревиатуры, число строк или
// заменено слишком много слов.
//
// Вызов модели и лимит запросов — в pb_hooks/yandexgpt.js.
routerAdd("POST", "/api/correct", (e) => {
    const ygpt = require(`${__hooks}/yandexgpt.js`);
    if (!ygpt.isConfigured()) {
        return e.json(503, { message: "ИИ-проверка не настроена" });
    }
    // Одно поле — один запрос при выходе из него: 20 в минуту с запасом.
    if (ygpt.rateLimited("correct", e.auth.id, 20)) {
        return e.json(429, { message: "Слишком много запросов" });
    }

    const body = e.requestInfo().body || {};
    const text = String(body.text == null ? "" : body.text);
    const fieldLabel = String(body.fieldLabel == null ? "" : body.fieldLabel).slice(0, 200);
    if (!text.trim() || text.length > 3000) {
        return e.json(200, { corrected: text });
    }

    const system = [
        "Ты корректор протоколов лучевой диагностики (рентгенология, КТ, МРТ).",
        "Исправь в тексте ТОЛЬКО: опечатки и орфографию; согласование слов по роду, числу и падежу; явные грамматические ошибки.",
        "Ничего не перефразируй и не дописывай. Не меняй смысл, медицинские термины, порядок слов, числа и единицы измерения.",
        "Латиницу и аббревиатуры (T2, STIR, PD, Stoller, КТ, МРТ) оставляй как есть.",
        "Сохрани переносы строк и пунктуацию; знаки препинания меняй, только если без этого фраза грамматически неверна.",
        "Если ошибок нет — верни текст без изменений.",
        "Верни только итоговый текст, без кавычек и пояснений.",
    ].join("\n");
    const user = (fieldLabel ? "Поле протокола: " + fieldLabel + "\n\n" : "") + "Текст:\n" + text;

    // Ответ — тот же текст: токенов нужно примерно столько же, сколько во входе
    // (для русского ~3 символа на токен), с запасом.
    const res = ygpt.complete(system, user, {
        temperature: 0,
        maxTokens: Math.min(2000, Math.ceil(text.length / 2) + 50),
        timeout: 15,
    });
    if (!res.ok) {
        return e.json(502, { message: "ИИ-сервис недоступен" });
    }

    let corrected = res.text.replace(/^\s*(Текст:\s*)?/, "").replace(/^["«»]+|["«»]+$/g, "");
    // Модель обычно отрезает пробелы/переносы по краям — возвращаем исходные.
    corrected = text.match(/^\s*/)[0] + corrected.trim() + text.match(/\s*$/)[0];

    const numbers = (s) => (s.match(/\d+(?:[.,]\d+)?/g) || []).join("|");
    const latin = (s) => (s.match(/[A-Za-z][A-Za-z0-9-]*/g) || []).join("|");
    const lines = (s) => s.split("\n").length;
    const words = (s) => s.split(/\s+/).filter(Boolean);

    let rejectReason = "";
    if (!corrected.trim()) rejectReason = "пустой ответ";
    else if (numbers(corrected) !== numbers(text)) rejectReason = "изменились числа";
    else if (latin(corrected) !== latin(text)) rejectReason = "изменилась латиница";
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
