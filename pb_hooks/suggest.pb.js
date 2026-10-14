/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/suggest.pb.js
//
// ИИ-подсказки при наборе в filler (ghost-text): браузер шлёт сюда текст
// поля до курсора и примеры формулировок пользователя (его же память фраз,
// см. lib/phraseMemory.ts), сервер спрашивает YandexGPT и возвращает
// продолжение. Запрос идёт с сервера, а не из браузера: ключ API не
// попадает к пользователям, и им не нужен VPN.
//
// Вызов модели и лимит запросов — в pb_hooks/yandexgpt.js. Без ключа
// маршрут отвечает 503 — фронтенд в этом случае просто не показывает
// подсказки.
routerAdd("POST", "/api/suggest", (e) => {
    const ygpt = require(`${__hooks}/yandexgpt.js`);
    if (!ygpt.isConfigured()) {
        return e.json(503, { message: "ИИ-подсказки не настроены" });
    }
    // Фронтенд шлёт запрос только после паузы в наборе, так что живому
    // человеку 40 в минуту хватает с запасом, а скрипту — нет.
    if (ygpt.rateLimited("suggest", e.auth.id, 40)) {
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
    // Курсор сразу после буквы — слово недописано. Без явного указания
    // модель часто возвращает только окончание слова, и на стыке не понять,
    // нужен ли пробел; с ним — начинает ответ со слова целиком.
    const partial = (textBefore.match(/[^\s.,;:!?()«»"'\/]+$/) || [""])[0];
    if (partial) {
        parts.push("Курсор стоит внутри недописанного слова «" + partial + "». Начни ответ с этого слова целиком (например: «" + partial + "…»), без пробела перед ним.");
    }

    const res = ygpt.complete(system, parts.join("\n\n"), { temperature: 0.2, maxTokens: 60 });
    if (!res.ok) {
        return e.json(502, { message: "ИИ-сервис недоступен" });
    }
    const text = res.text;

    return e.json(200, { text: text.slice(0, 300) });
}, $apis.requireAuth("users"))
