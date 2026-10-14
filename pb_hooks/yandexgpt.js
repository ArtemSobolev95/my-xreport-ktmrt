// pb_hooks/yandexgpt.js
//
// Общий код для ИИ-маршрутов (suggest.pb.js, correct.pb.js): вызов
// YandexGPT и ограничение частоты запросов. Не *.pb.js — PocketBase его сам
// не загружает; подключается внутри обработчика:
//   const ygpt = require(`${__hooks}/yandexgpt.js`)
// (обработчики выполняются изолированно, переменные верхнего уровня
// других файлов им не видны).
//
// Переменные окружения (Amvera → Переменные):
//   YANDEX_API_KEY    — API-ключ сервисного аккаунта (роль ai.languageModels.user)
//   YANDEX_FOLDER_ID  — id каталога Yandex Cloud
//   YANDEX_GPT_MODEL  — необязательно, по умолчанию "yandexgpt-lite/latest"
//   YANDEX_GPT_URL    — необязательно, адрес completion API (для прокси/тестов)

module.exports = {
    isConfigured() {
        return !!($os.getenv("YANDEX_API_KEY") && $os.getenv("YANDEX_FOLDER_ID"));
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

    // Возвращает { ok: true, text } или { ok: false }.
    complete(system, user, options) {
        const apiKey = $os.getenv("YANDEX_API_KEY");
        const folderId = $os.getenv("YANDEX_FOLDER_ID");
        const model = $os.getenv("YANDEX_GPT_MODEL") || "yandexgpt-lite/latest";
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
