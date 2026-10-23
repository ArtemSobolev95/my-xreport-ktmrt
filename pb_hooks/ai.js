// pb_hooks/ai.js
//
// Общий код ИИ-маршрутов (suggest.pb.js, correct.pb.js): выбор провайдера,
// лимит запросов, вызов модели. Не *.pb.js — PocketBase его сам не
// загружает; подключается внутри обработчика:
//   const ai = require(`${__hooks}/ai.js`)
// (обработчики выполняются изолированно, переменные верхнего уровня других
// файлов им не видны).
//
// Провайдер — настройка развёртывания (Amvera → Переменные):
//   AI_PROVIDER = yandex (по умолчанию) | anthropic
// Маршруты: SUGGEST (подсказки), CORRECT (проверка), CONCLUDE (автозаключение).
// Ключи и модели — в pb_hooks/yandexgpt.js и pb_hooks/anthropic.js.

// Длина самого ответа модели (без «размышления») и температура для
// провайдеров, которые её принимают.
const ROUTE_SETTINGS = {
    SUGGEST: { temperature: 0.2 },
    CORRECT: { temperature: 0 },
    CONCLUDE: { temperature: 0.2 },
};

module.exports = {
    provider() {
        return ($os.getenv("AI_PROVIDER") || "yandex").trim().toLowerCase() === "anthropic" ? "anthropic" : "yandex";
    },

    backend() {
        return require(`${__hooks}/${this.provider() === "anthropic" ? "anthropic" : "yandexgpt"}.js`);
    },

    isConfigured() {
        return this.backend().isConfigured();
    },

    // route — "SUGGEST" | "CORRECT" | "CONCLUDE". Имя модели — и для статистики на клиенте.
    modelFor(route) {
        return this.backend().modelFor(route);
    },

    // true — лимит превышен. Окно — календарная минута, счётчик в памяти
    // процесса ($app.store()), отдельный на каждый name.
    rateLimited(name, userId, perMinute) {
        const minute = Math.floor(Date.now() / 60000);
        const key = name + "_rl:" + userId;
        const [rlMinute, rlCount] = String($app.store().get(key) || "0:0").split(":").map(Number);
        const count = rlMinute === minute ? rlCount + 1 : 1;
        $app.store().set(key, minute + ":" + count);
        return count > perMinute;
    },

    // Учёт расхода: запись ai_usage за день + пользователь + маршрут +
    // модель (миграция 0008), счётчики прибавляются. Ошибка учёта не должна
    // ломать сам ответ — только пишется в лог.
    recordUsage(userId, route, model, input, output) {
        if (!userId) return;
        try {
            const day = new Date().toISOString().slice(0, 10);
            let rec;
            try {
                rec = $app.findFirstRecordByFilter("ai_usage", "day = {:day} && user = {:user} && route = {:route} && model = {:model}",
                    { day: day, user: userId, route: route, model: model });
            } catch (_) {
                rec = new Record($app.findCollectionByNameOrId("ai_usage"));
                rec.set("day", day);
                rec.set("user", userId);
                rec.set("route", route);
                rec.set("model", model);
            }
            rec.set("requests", (rec.getInt("requests") || 0) + 1);
            rec.set("input_tokens", (rec.getInt("input_tokens") || 0) + input);
            rec.set("output_tokens", (rec.getInt("output_tokens") || 0) + output);
            $app.save(rec);
        } catch (err) {
            console.log("[ai] учёт расхода не записан:", err);
        }
    },

    // options: { route, maxTokens (длина самого ответа), timeout?, userId? }.
    // Возвращает { ok: true, text } или { ok: false }.
    complete(system, user, options) {
        const settings = ROUTE_SETTINGS[options.route] || {};
        const model = this.modelFor(options.route);
        const startedAt = Date.now();
        const res = this.backend().complete(system, user, {
            route: options.route,
            model: model,
            temperature: settings.temperature,
            maxTokens: options.maxTokens,
            timeout: options.timeout,
        });
        // Время ответа и токены — в логах: «[ai] SUGGEST claude-haiku-5-5
        // 640 мс, 1120 → 14 токенов».
        const usage = res.usage || { input: 0, output: 0 };
        console.log("[ai] " + options.route + " " + model + " " + (Date.now() - startedAt) + " мс" +
            (res.ok ? ", " + usage.input + " → " + usage.output + " токенов" : " (ошибка)"));
        if (res.ok) this.recordUsage(options.userId, options.route, model, usage.input, usage.output);
        return res;
    },
};
