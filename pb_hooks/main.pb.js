/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/main.pb.js
//
// Раньше здесь стоял CORS-хук в старом (Express-подобном) синтаксисе
// routerUse((req, res, next) => {...}), который не соответствует API
// текущей версии PocketBase (0.37) — routerUse отдаёт один объект события
// `e`, а не (req, res, next). Из-за этого хук фактически не выполнял свою
// работу так, как задумано. Плюс "*" вместе с Allow-Credentials: true —
// комбинация, которую браузеры всё равно отклоняют, и просто лишний риск.
routerUse((e) => {
    const allowedOrigins = [
        "https://smartreporting.ru",
        "https://my-project-artemsobolev.amvera.io",
        "http://localhost:3000",
    ];

    const origin = e.request?.header.get("Origin");

    if (origin && allowedOrigins.includes(origin)) {
        e.response.header().set("Access-Control-Allow-Origin", origin);
        e.response.header().set("Access-Control-Allow-Credentials", "true");
    }

    e.response.header().set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    e.response.header().set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

    if (e.request?.method === "OPTIONS") {
        e.response.writeHeader(204);
        return;
    }

    return e.next();
})

// Проверка hCaptcha при регистрации — без этого форма /register была
// полностью открыта для автоматического создания аккаунтов ботами.
// HCAPTCHA_SECRET задаётся только как переменная окружения на сервере
// (никогда не коммитить в git) — если её нет, регистрация отклоняется,
// а не тихо пропускается, чтобы не оставить защиту случайно выключенной.
onRecordCreateRequest((e) => {
    const secret = $os.getenv("HCAPTCHA_SECRET");
    if (!secret) {
        throw new BadRequestError("Регистрация временно недоступна (не настроена проверка капчи)");
    }

    const token = e.requestInfo().body["h-captcha-response"];
    if (!token) {
        throw new BadRequestError("Пройдите проверку капчи");
    }

    const res = $http.send({
        method: "POST",
        url: "https://hcaptcha.com/siteverify",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "secret=" + encodeURIComponent(secret) + "&response=" + encodeURIComponent(token),
    });

    if (!res.json || res.json.success !== true) {
        throw new BadRequestError("Проверка капчи не пройдена, попробуйте ещё раз");
    }

    return e.next();
}, "users")
