/// <reference path="../pb_data/types.d.ts" />
// Расход ИИ по дням (pb_hooks/ai.js): одна запись на день + пользователь +
// маршрут + модель — число запросов и токенов. Маршрут REPORT — сколько
// протоколов в этот день скопировали/сохранили: так считается расход на
// одно исследование. Смотреть — в админке (/_/), коллекция ai_usage;
// пользователям она не видна (правила доступа пустые — только суперпользователь).
migrate((app) => {
  try {
    app.findCollectionByNameOrId("ai_usage");
    console.log("0008_create_ai_usage.js: коллекция уже есть — пропускаем");
    return;
  } catch (_) {
    // нет — создаём
  }

  const users = app.findCollectionByNameOrId("users");
  const collection = new Collection({
    "type": "base",
    "name": "ai_usage",
    "listRule": null,
    "viewRule": null,
    "createRule": null,
    "updateRule": null,
    "deleteRule": null,
    "fields": [
      { "name": "day", "type": "text", "required": true, "max": 10 },
      { "name": "user", "type": "relation", "required": true, "collectionId": users.id, "cascadeDelete": true, "maxSelect": 1 },
      { "name": "route", "type": "text", "required": true, "max": 20 },
      { "name": "model", "type": "text", "max": 100 },
      { "name": "requests", "type": "number", "onlyInt": true },
      { "name": "input_tokens", "type": "number", "onlyInt": true },
      { "name": "output_tokens", "type": "number", "onlyInt": true },
      { "name": "created", "type": "autodate", "onCreate": true, "onUpdate": false },
      { "name": "updated", "type": "autodate", "onCreate": true, "onUpdate": true }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_ai_usage_key ON ai_usage (day, user, route, model)"
    ]
  });

  return app.save(collection);
}, (app) => {
  try {
    return app.delete(app.findCollectionByNameOrId("ai_usage"));
  } catch (_) {
    // уже нет
  }
})
