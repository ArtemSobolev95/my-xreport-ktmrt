/// <reference path="../pb_data/types.d.ts" />
// Память фраз для подсказок при наборе в filler (hooks/usePhraseMemory.ts):
// одна запись на пару пользователь + шаблон, в data — выученные фразы по
// полям (формат — TemplateMemory в lib/phraseMemory.ts).
//
// В отличие от остальных коллекций (они созданы через админку), эта
// создаётся миграцией — чтобы появилась на проде сама при деплое. Если
// коллекция уже есть (создали вручную или миграцию откатывали частично) —
// ничего не делаем.
migrate((app) => {
  try {
    app.findCollectionByNameOrId("phrase_memory");
    console.log("0005_create_phrase_memory.js: коллекция уже есть — пропускаем");
    return;
  } catch (_) {
    // нет — создаём
  }

  const users = app.findCollectionByNameOrId("users");
  const ownRecord = "@request.auth.id != \"\" && user = @request.auth.id";

  const collection = new Collection({
    "type": "base",
    "name": "phrase_memory",
    "listRule": ownRecord,
    "viewRule": ownRecord,
    "createRule": "@request.auth.id != \"\" && @request.body.user = @request.auth.id",
    // Перенести запись другому пользователю нельзя.
    "updateRule": ownRecord + " && (@request.body.user:isset = false || @request.body.user = @request.auth.id)",
    "deleteRule": ownRecord,
    "fields": [
      {
        "name": "user",
        "type": "relation",
        "required": true,
        "collectionId": users.id,
        "cascadeDelete": true,
        "maxSelect": 1
      },
      {
        // id шаблона текстом, а не relation: память не должна мешать
        // удалению шаблона и не должна зависеть от прав на чужой
        // публичный шаблон.
        "name": "template",
        "type": "text",
        "required": true,
        "max": 64
      },
      {
        "name": "data",
        "type": "json",
        // 300 фраз на поле × десятки полей укладываются с запасом.
        "maxSize": 5242880
      },
      {
        "name": "created",
        "type": "autodate",
        "onCreate": true,
        "onUpdate": false
      },
      {
        "name": "updated",
        "type": "autodate",
        "onCreate": true,
        "onUpdate": true
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_phrase_memory_user_template ON phrase_memory (user, template)"
    ]
  });

  return app.save(collection);
}, (app) => {
  try {
    const collection = app.findCollectionByNameOrId("phrase_memory");
    return app.delete(collection);
  } catch (_) {
    // уже нет
  }
})
