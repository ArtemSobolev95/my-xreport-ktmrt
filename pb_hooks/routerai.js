// pb_hooks/routerai.js
//
// Вызов RouterAI (https://routerai.ru) — российского агрегатора моделей с
// OpenAI-совместимым API (/api/v1/chat/completions). Выбирается в
// pb_hooks/ai.js как основной провайдер (AI_PROVIDER=routerai) или как
// резервный (AI_FALLBACK=routerai,...).
//
// Переменные окружения (Amvera → Переменные):
//   ROUTERAI_API_KEY    — ключ из кабинета RouterAI (routerai.ru/settings/keys)
//   ROUTERAI_MODEL      — необязательно, модель для всех маршрутов
//                         (по умолчанию DEFAULT_MODEL); id — как в каталоге
//                         RouterAI: «провайдер/модель», например
//                         "deepseek/deepseek-v4-pro", "qwen/qwen3.7-plus"
//   ROUTERAI_MODEL_SUGGEST, ROUTERAI_MODEL_CORRECT, ROUTERAI_MODEL_CONCLUDE,
//   ROUTERAI_MODEL_RULES — необязательно, модель отдельно для подсказок /
//                         проверки / автозаключения / сводки правил (важнее
//                         ROUTERAI_MODEL)
//   ROUTERAI_REASONING_<МАРШРУТ> — необязательно, off | low | medium | high:
//                         «размышление» у моделей, которые его умеют; без
//                         переменной — как по умолчанию у модели
//   ROUTERAI_RUB_PER_USD — необязательно, курс для учёта расхода в ai_usage
//                         (RouterAI считает в рублях, учёт — в долларах),
//                         по умолчанию 100
//   ROUTERAI_URL        — необязательно, адрес chat/completions (для прокси/тестов)

const DEFAULT_MODEL = "deepseek/deepseek-v4-pro";
// Подсказкам при наборе важна задержка — быстрая модель.
const DEFAULT_ROUTE_MODEL = { SUGGEST: "deepseek/deepseek-v4-flash" };
// Сверх длины самого ответа — место под «размышление» (у моделей, которые
// размышляют, оно учитывается в max_tokens). Подсказкам — без запаса.
const REASONING_HEADROOM_TOKENS = 4000;

module.exports = {
    isConfigured() {
        return !!$os.getenv("ROUTERAI_API_KEY");
    },

    // route — "SUGGEST" | "CORRECT" | "CONCLUDE" | "RULES".
    modelFor(route) {
        return $os.getenv("ROUTERAI_MODEL_" + route) || $os.getenv("ROUTERAI_MODEL") || DEFAULT_ROUTE_MODEL[route] || DEFAULT_MODEL;
    },

    // options: { route, model, temperature, maxTokens, timeout? }.
    // Возвращает { ok: true, text, usage: { input, output, costUsd? } } или { ok: false }.
    complete(system, user, options) {
        const url = $os.getenv("ROUTERAI_URL") || "https://routerai.ru/api/v1/chat/completions";
        const reasoning = ($os.getenv("ROUTERAI_REASONING_" + options.route) || "").trim().toLowerCase();
        const body = {
            model: options.model,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
            max_tokens: options.maxTokens + (options.route === "SUGGEST" || reasoning === "off" ? 0 : REASONING_HEADROOM_TOKENS),
            // Стоимость запроса в ответе (usage.cost) — для учёта расхода.
            usage: { include: true },
        };
        if (typeof options.temperature === "number") body.temperature = options.temperature;
        if (reasoning === "off") body.reasoning = { enabled: false };
        else if (reasoning) body.reasoning = { effort: reasoning };

        let res;
        try {
            res = $http.send({
                method: "POST",
                url: url,
                timeout: options.timeout || 15,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + $os.getenv("ROUTERAI_API_KEY"),
                },
                body: JSON.stringify(body),
            });
        } catch (err) {
            console.log("[routerai] запрос не удался:", err);
            return { ok: false };
        }

        if (res.statusCode !== 200 || !res.json || res.json.error) {
            console.log("[routerai] ответ", res.statusCode, JSON.stringify(res.json).slice(0, 500));
            return { ok: false };
        }

        const u = res.json.usage || {};
        const rubPerUsd = Number($os.getenv("ROUTERAI_RUB_PER_USD")) || 100;
        const usage = {
            input: Number(u.prompt_tokens) || 0,
            output: Number(u.completion_tokens) || 0,
            // usage.cost — в рублях; нет — стоимость посчитается по PRICES в ai.js.
            costUsd: typeof u.cost === "number" ? u.cost / rubPerUsd : undefined,
        };
        const choice = (res.json.choices || [])[0];
        const message = choice && choice.message;
        // Отказ фильтра контента — как отказ модели: ответа нет, пробуем
        // следующего провайдера.
        if (!message || choice.finish_reason === "content_filter") {
            return { ok: true, text: "", usage: usage, refused: true };
        }
        // content бывает строкой или массивом частей.
        const content = Array.isArray(message.content)
            ? message.content.map((p) => (p && typeof p.text === "string" ? p.text : "")).join("")
            : String(message.content || "");
        return { ok: true, text: content, usage: usage };
    },
};
