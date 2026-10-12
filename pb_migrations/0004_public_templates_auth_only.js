/// <reference path="../pb_data/types.d.ts" />
// Публичные шаблоны видны только вошедшим пользователям. Раньше условие
// `... || isPublic = true` стояло вне проверки авторизации, и публичные
// шаблоны целиком (со всей структурой полей) отдавались любому анонимному
// запросу к /api/collections/templates/records — без токена.
//
// Менять/удалять шаблон по-прежнему может только автор (updateRule/
// deleteRule не трогаем): чужой публичный шаблон можно заполнить или
// сохранить копию — новую запись со своим user (createRule).
migrate((app) => {
  // На пустой базе (новый инстанс до восстановления бэкапа) коллекций
  // ещё нет — коллекции создаются через админку/бэкап, не миграциями.
  // Без этой проверки PocketBase падает при старте и уходит в цикл
  // перезапусков. Бэкап прода уже содержит эту миграцию как применённую.
  try {
    app.findCollectionByNameOrId("templates");
  } catch (_) {
    console.log("0004_public_templates_auth_only.js: коллекции templates нет — миграция пропущена (пустая база)");
    return;
  }

  const collection = app.findCollectionByNameOrId("templates");
  unmarshal({
    "listRule": "@request.auth.id != \"\" && (user = @request.auth.id || isPublic = true)",
    "viewRule": "@request.auth.id != \"\" && (user = @request.auth.id || isPublic = true)"
  }, collection);
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("templates");
  unmarshal({
    "listRule": "(@request.auth.id != \"\" && user = @request.auth.id) || isPublic = true",
    "viewRule": "(@request.auth.id != \"\" && user = @request.auth.id) || isPublic = true"
  }, collection);
  return app.save(collection);
})
