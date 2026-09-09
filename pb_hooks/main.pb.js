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
