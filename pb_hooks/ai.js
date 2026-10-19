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

    // options: { route, maxTokens (длина самого ответа), timeout? }.
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
        // Время ответа модели — в логах, чтобы ускорение было видно цифрой:
        // «[ai] CORRECT claude-haiku-5-5 640 мс».
        console.log("[ai] " + options.route + " " + model + " " + (Date.now() - startedAt) + " мс" + (res.ok ? "" : " (ошибка)"));
        return res;
    },
};
