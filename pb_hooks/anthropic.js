// pb_hooks/anthropic.js
//
// Вызов Claude (Anthropic Messages API) для ИИ-маршрутов — выбирается в
// pb_hooks/ai.js при AI_PROVIDER=anthropic. Прямой HTTP через $http.send:
// хуки PocketBase работают в JS-движке без npm, официальный SDK здесь не
// подключить.
//
// Claude API доступен не во всех странах — используйте этот провайдер в
// развёртываниях для пользователей из поддерживаемых регионов
// (https://www.anthropic.com/supported-countries); для остальных —
// AI_PROVIDER=yandex.
//
// Переменные окружения:
//   ANTHROPIC_API_KEY  — ключ API
//   ANTHROPIC_MODEL    — необязательно, модель для всех маршрутов (по умолчанию claude-opus-5-5)
//   ANTHROPIC_MODEL_SUGGEST, ANTHROPIC_MODEL_CORRECT, ANTHROPIC_MODEL_CONCLUDE —
//                        необязательно, модель отдельно для подсказок /
//                        проверки / автозаключения (важнее ANTHROPIC_MODEL)
//   ANTHROPIC_EFFORT_<МАРШРУТ> — необязательно, low | medium | high (по
//                        умолчанию low, у автозаключения medium)
//   ANTHROPIC_THINKING_<МАРШРУТ> — необязательно, on | off: «размышление»
//                        модели перед ответом (по умолчанию off у подсказок и
//                        проверки, on у автозаключения).
//                        Выключить можно у Claude Haiku 5.5 и Sonnet 5.5 —
//                        главный выигрыш в задержке; у Opus 5.5 оно всегда
//                        включено (остаётся effort).
//   ANTHROPIC_BASE_URL — необязательно, адрес Messages API (для прокси/тестов)

const DEFAULT_MODEL = "claude-opus-5-5";
const DEFAULT_EFFORT = { SUGGEST: "low", CORRECT: "low", CONCLUDE: "medium" };
const DEFAULT_THINKING = { SUGGEST: "off", CORRECT: "off", CONCLUDE: "on" };
// Сверх длины самого ответа — место под «размышление» модели: оно
// учитывается в max_tokens.
const THINKING_HEADROOM_TOKENS = 4000;

// Как выключить «размышление» у модели, если она это позволяет: у Haiku 5.5
// — disabled (допустимо при effort не выше high), у Sonnet 5.5 — только
// between_tools (без других полей thinking). null — выключить нельзя.
const thinkingOffFor = (model) => {
    if (/^claude-haiku-5/.test(model)) return { type: "disabled" };
    if (/^claude-sonnet-5-5/.test(model)) return { type: "between_tools" };
    return null;
};

module.exports = {
    isConfigured() {
        return !!$os.getenv("ANTHROPIC_API_KEY");
    },

    // route — "SUGGEST" | "CORRECT" | "CONCLUDE".
    modelFor(route) {
        return $os.getenv("ANTHROPIC_MODEL_" + route) || $os.getenv("ANTHROPIC_MODEL") || DEFAULT_MODEL;
    },

    // options: { route, maxTokens (длина самого ответа), timeout? }.
    // Возвращает { ok: true, text } или { ok: false }.
    complete(system, user, options) {
        const model = this.modelFor(options.route);
        const effort = $os.getenv("ANTHROPIC_EFFORT_" + options.route) || DEFAULT_EFFORT[options.route] || "medium";
        const url = $os.getenv("ANTHROPIC_BASE_URL") || "https://api.anthropic.com/v1/messages";

        const headers = {
            "content-type": "application/json",
            "x-api-key": $os.getenv("ANTHROPIC_API_KEY"),
            "anthropic-version": "2023-06-01",
        };
        // temperature не передаём: у текущих моделей параметры сэмплирования
        // отклоняются; глубину и скорость задаёт effort.
        const wantThinking = ($os.getenv("ANTHROPIC_THINKING_" + options.route) || DEFAULT_THINKING[options.route] || "on").toLowerCase() !== "off";
        const thinkingOff = wantThinking ? null : thinkingOffFor(model);
        const body = {
            model: model,
            max_tokens: options.maxTokens + (thinkingOff ? 0 : THINKING_HEADROOM_TOKENS),
            system: system,
            messages: [{ role: "user", content: user }],
        };
        if (thinkingOff) body.thinking = thinkingOff;
        // effort не поддерживает Claude Haiku 4.5 — для него не передаём.
        if (!/^claude-haiku-4/.test(model)) body.output_config = { effort: effort };
        // Если классификатор безопасности модели отклонит запрос (бывает и на
        // безобидном медицинском тексте), сервер повторит его на
        // рекомендованной запасной модели. Для Haiku серверного запасного
        // варианта нет.
        if (/^claude-(opus-5|fable-5|sonnet-5-5)/.test(model)) {
            headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
            body.fallbacks = "default";
        }

        let res;
        try {
            res = $http.send({
                method: "POST",
                url: url,
                timeout: options.timeout || 15,
                headers: headers,
                body: JSON.stringify(body),
            });
        } catch (err) {
            console.log("[anthropic] запрос не удался:", err);
            return { ok: false };
        }

        if (res.statusCode !== 200 || !res.json) {
            console.log("[anthropic] ответ", res.statusCode, JSON.stringify(res.json));
            return { ok: false };
        }

        // Отказ (в том числе после запасной модели) — подсказки просто нет.
        if (res.json.stop_reason === "refusal") {
            console.log("[anthropic] отказ модели:", JSON.stringify(res.json.stop_details));
            return { ok: true, text: "" };
        }
        const text = (res.json.content || [])
            .filter((b) => b && b.type === "text")
            .map((b) => b.text || "")
            .join("");
        return { ok: true, text: text };
    },
};
