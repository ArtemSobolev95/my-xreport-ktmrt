/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/suggest.pb.js
//
// ИИ-подсказки при наборе в filler (ghost-text): браузер шлёт сюда текст
// поля до курсора и примеры формулировок пользователя (его же память фраз,
// см. lib/phraseMemory.ts), сервер спрашивает YandexGPT и возвращает
// продолжение. Запрос идёт с сервера, а не из браузера: ключ API не
// попадает к пользователям, и им не нужен VPN.
//
// Переменные окружения (Amvera → Переменные):
//   YANDEX_API_KEY    — API-ключ сервисного аккаунта (роль ai.languageModels.user)
//   YANDEX_FOLDER_ID  — id каталога Yandex Cloud
//   YANDEX_GPT_MODEL  — необязательно, по умолчанию "yandexgpt-lite/latest"
//   YANDEX_GPT_URL    — необязательно, адрес completion API (для прокси/тестов)
//
// Без ключа маршрут отвечает 503 — фронтенд в этом случае просто не
// показывает подсказки.
routerAdd("POST", "/api/suggest", (e) => {
    const apiKey = $os.getenv("YANDEX_API_KEY");
    const folderId = $os.getenv("YANDEX_FOLDER_ID");
    if (!apiKey || !folderId) {
        return e.json(503, { message: "ИИ-подсказки не настроены" });
    }

    // Не больше RATE_LIMIT запросов в минуту на пользователя: фронтенд
    // шлёт запрос только после паузы в наборе, так что живому человеку
    // этого с запасом хватает, а скрипту — нет.
    const RATE_LIMIT = 40;
    const userId = e.auth.id;
    const minute = Math.floor(Date.now() / 60000);
    const rlKey = "suggest_rl:" + userId;
    const [rlMinute, rlCount] = String($app.store().get(rlKey) || "0:0").split(":").map(Number);
    const count = rlMinute === minute ? rlCount + 1 : 1;
    $app.store().set(rlKey, minute + ":" + count);
    if (count > RATE_LIMIT) {
        return e.json(429, { message: "Слишком много запросов" });
    }

    const body = e.requestInfo().body || {};
    const clip = (v, max) => String(v == null ? "" : v).slice(0, max);
    // Берём хвост, а не начало: продолжение зависит от последних слов.
    const textBefore = String(body.textBefore == null ? "" : body.textBefore).slice(-2000);
    const fieldLabel = clip(body.fieldLabel, 200);
    const templateTitle = clip(body.templateTitle, 200);
    const isConclusion = body.isConclusion === true;
    const findings = clip(body.findings, 4000);
    const examples = (Array.isArray(body.examples) ? body.examples : [])
        .slice(0, 40)
        .map((x) => clip(x, 200).trim())
        .filter(Boolean);

    const system = [
        "Ты помогаешь врачу-рентгенологу быстрее писать протокол исследования: дописываешь текст поля, как подсказка при наборе.",
        "Верни ТОЛЬКО продолжение текста с места курсора: без кавычек, пояснений и без повторения уже написанного.",
        "Если курсор стоит внутри недописанного слова, начни ответ с этого слова целиком.",
        "Продолжение — не длиннее одной фразы, до ближайшей запятой или точки (сам знак не пиши).",
        "Пиши терминологией и в стиле этого врача — его типичные формулировки для поля даны ниже; предпочитай их.",
        "Не придумывай числа и размеры: если дальше должно идти число, оборви продолжение перед ним.",
        "Если уверенного продолжения нет, верни пустой ответ.",
    ].join("\n");

    const parts = [];
    if (templateTitle) parts.push("Шаблон: " + templateTitle);
    parts.push("Поле: " + (fieldLabel || (isConclusion ? "Заключение" : "текстовое поле")));
    if (examples.length) {
        parts.push("Типичные формулировки врача для этого поля (N — число):\n" + examples.map((x) => "- " + x).join("\n"));
    }
    if (isConclusion && findings) {
        parts.push("Описание исследования (заключение должно ему соответствовать):\n" + findings);
    }
    parts.push("Текст поля, курсор обозначен ⟨|⟩:\n" + textBefore + "⟨|⟩");

    const model = $os.getenv("YANDEX_GPT_MODEL") || "yandexgpt-lite/latest";
    const url = $os.getenv("YANDEX_GPT_URL") || "https://ai.api.cloud.yandex.net/foundationModels/v1/completion";

    let res;
    try {
        res = $http.send({
            method: "POST",
            url: url,
            timeout: 10,
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Api-Key " + apiKey,
                "x-folder-id": folderId,
            },
            body: JSON.stringify({
                modelUri: "gpt://" + folderId + "/" + model,
                completionOptions: { stream: false, temperature: 0.2, maxTokens: "60" },
                messages: [
                    { role: "system", text: system },
                    { role: "user", text: parts.join("\n\n") },
                ],
            }),
        });
    } catch (err) {
        console.log("[suggest] запрос к YandexGPT не удался:", err);
        return e.json(502, { message: "ИИ-сервис недоступен" });
    }

    if (res.statusCode !== 200 || !res.json) {
        console.log("[suggest] YandexGPT ответил", res.statusCode, JSON.stringify(res.json));
        return e.json(502, { message: "ИИ-сервис недоступен" });
    }

    // REST-ответ обёрнут в result; на всякий случай поддерживаем и без обёртки.
    const result = res.json.result || res.json;
    const alt = result.alternatives && result.alternatives[0];
    const text = alt && alt.status !== "ALTERNATIVE_STATUS_CONTENT_FILTER" && alt.message
        ? String(alt.message.text || "")
        : "";

    return e.json(200, { text: text.slice(0, 300) });
}, $apis.requireAuth("users"))
