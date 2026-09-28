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
