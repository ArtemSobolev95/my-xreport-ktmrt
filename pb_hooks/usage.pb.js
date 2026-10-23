/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/usage.pb.js
//
// Счётчик протоколов для учёта расхода ИИ (коллекция ai_usage, маршрут
// REPORT): filler вызывает его при первом копировании/сохранении каждого
// протокола. Расход на одно исследование = токены за день / REPORT за день.
routerAdd("POST", "/api/usage/report", (e) => {
    const ai = require(`${__hooks}/ai.js`);
    // Живой врач не скопирует больше нескольких протоколов в минуту.
    if (ai.rateLimited("usage_report", e.auth.id, 10)) {
        return e.json(429, { message: "Слишком много запросов" });
    }
    ai.recordUsage(e.auth.id, "REPORT", "", 0, 0);
    return e.json(200, { ok: true });
}, $apis.requireAuth("users"))
