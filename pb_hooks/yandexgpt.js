// pb_hooks/yandexgpt.js
//
// Вызов YandexGPT для ИИ-маршрутов — выбирается в pb_hooks/ai.js при
// AI_PROVIDER=yandex (по умолчанию).
//
// Переменные окружения (Amvera → Переменные):
//   YANDEX_API_KEY    — API-ключ сервисного аккаунта (роль ai.languageModels.user)
//   YANDEX_FOLDER_ID  — id каталога Yandex Cloud
//   YANDEX_GPT_MODEL  — необязательно, модель для всех маршрутов, по умолчанию
//                       "yandexgpt-lite/latest" (Pro — "yandexgpt/latest")
//   YANDEX_GPT_MODEL_SUGGEST, YANDEX_GPT_MODEL_CORRECT, YANDEX_GPT_MODEL_CONCLUDE —
//                       необязательно, модель отдельно для подсказок / проверки /
//                       автозаключения (важнее YANDEX_GPT_MODEL):
//                       проверке задержка не важна — ей можно Pro, подсказкам —
//                       быструю Lite
//   YANDEX_GPT_URL    — необязательно, адрес completion API (для прокси/тестов)

module.exports = {
    isConfigured() {
        return !!($os.getenv("YANDEX_API_KEY") && $os.getenv("YANDEX_FOLDER_ID"));
    },

    // route — "SUGGEST" | "CORRECT" | "CONCLUDE".
    modelFor(route) {
        return $os.getenv("YANDEX_GPT_MODEL_" + route) || $os.getenv("YANDEX_GPT_MODEL") || "yandexgpt-lite/latest";
    },

    // options: { model, temperature, maxTokens, timeout? }.
    // Возвращает { ok: true, text } или { ok: false }.
    complete(system, user, options) {
        const apiKey = $os.getenv("YANDEX_API_KEY");
        const folderId = $os.getenv("YANDEX_FOLDER_ID");
        const model = options.model;
        const url = $os.getenv("YANDEX_GPT_URL") || "https://ai.api.cloud.yandex.net/foundationModels/v1/completion";

        let res;
        try {
            res = $http.send({
                method: "POST",
                url: url,
                timeout: options.timeout || 10,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Api-Key " + apiKey,
                    "x-folder-id": folderId,
                },
                body: JSON.stringify({
                    modelUri: "gpt://" + folderId + "/" + model,
                    completionOptions: {
                        stream: false,
                        temperature: options.temperature,
                        maxTokens: String(options.maxTokens),
                    },
                    messages: [
                        { role: "system", text: system },
                        { role: "user", text: user },
                    ],
                }),
            });
        } catch (err) {
            console.log("[yandexgpt] запрос не удался:", err);
            return { ok: false };
        }

        if (res.statusCode !== 200 || !res.json) {
            console.log("[yandexgpt] ответ", res.statusCode, JSON.stringify(res.json));
            return { ok: false };
        }

        // REST-ответ обёрнут в result; на всякий случай поддерживаем и без обёртки.
        const result = res.json.result || res.json;
        const alt = result.alternatives && result.alternatives[0];
        if (!alt || alt.status === "ALTERNATIVE_STATUS_CONTENT_FILTER" || !alt.message) {
            return { ok: true, text: "" };
        }
        return { ok: true, text: String(alt.message.text || "") };
    },
};
