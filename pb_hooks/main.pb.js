// pb_hooks/main.pb.js
routerUse((req, res, next) => {
    // Разрешаем запросы с твоего текущего домена Amvera
    res.setHeader("Access-Control-Allow-Origin", "*") // на время можно *, потом заменишь на конкретные домены
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
    res.setHeader("Access-Control-Allow-Credentials", "true")

    // Для preflight запросов (OPTIONS)
    if (req.method === "OPTIONS") {
        res.writeHead(204)
        res.end()
        return
    }

    next()
})
