/// <reference path="../pb_data/types.d.ts" />
// КРИТИЧНО: на проде правила доступа (list/view/create/update/delete) у
// коллекций templates, abbreviations, state_after_phrases и notes_images
// были выставлены в "" (пустая строка). В PocketBase "" означает "разрешено
// всем, включая неавторизованных", а не "нет ограничений по умолчанию".
// Из-за этого любой человек в интернете без токена мог читать, менять и
// удалять данные ЛЮБОГО пользователя — подтверждено анонимным запросом к
// /api/collections/state_after_phrases/records, вернувшим чужую запись.
//
// Здесь правила переводятся на "владелец видит/меняет только своё",
// с публичным просмотром шаблонов, явно помеченных isPublic = true.
//
// Важно: условие обязательно начинается с `@request.auth.id != ""` —
// без этой проверки правило `user = @request.auth.id` пропускает
// анонимные запросы к записям с пустым/неустановленным полем user
// (у notes_images такие записи реально есть — баг загрузки без
// владельца, отдельно исправлен в коде), потому что "" = "" тоже true.
migrate((app) => {
  let collection = app.findCollectionByNameOrId("templates");
  unmarshal({
    "listRule": "(@request.auth.id != \"\" && user = @request.auth.id) || isPublic = true",
    "viewRule": "(@request.auth.id != \"\" && user = @request.auth.id) || isPublic = true",
    "createRule": "@request.auth.id != \"\" && @request.body.user = @request.auth.id",
    "updateRule": "@request.auth.id != \"\" && user = @request.auth.id",
    "deleteRule": "@request.auth.id != \"\" && user = @request.auth.id"
  }, collection);
  app.save(collection);

  collection = app.findCollectionByNameOrId("abbreviations");
  unmarshal({
    "listRule": "@request.auth.id != \"\" && user = @request.auth.id",
    "viewRule": "@request.auth.id != \"\" && user = @request.auth.id",
    "createRule": "@request.auth.id != \"\" && @request.body.user = @request.auth.id",
    "updateRule": "@request.auth.id != \"\" && user = @request.auth.id",
    "deleteRule": "@request.auth.id != \"\" && user = @request.auth.id"
  }, collection);
  app.save(collection);

  collection = app.findCollectionByNameOrId("state_after_phrases");
  unmarshal({
    "listRule": "@request.auth.id != \"\" && user = @request.auth.id",
    "viewRule": "@request.auth.id != \"\" && user = @request.auth.id",
    "createRule": "@request.auth.id != \"\" && @request.body.user = @request.auth.id",
    "updateRule": "@request.auth.id != \"\" && user = @request.auth.id",
    "deleteRule": "@request.auth.id != \"\" && user = @request.auth.id"
  }, collection);
  app.save(collection);

  collection = app.findCollectionByNameOrId("notes_images");
  unmarshal({
    "listRule": "@request.auth.id != \"\" && user = @request.auth.id",
    "viewRule": "@request.auth.id != \"\" && user = @request.auth.id",
    "createRule": "@request.auth.id != \"\" && @request.body.user = @request.auth.id",
    "updateRule": "@request.auth.id != \"\" && user = @request.auth.id",
    "deleteRule": "@request.auth.id != \"\" && user = @request.auth.id"
  }, collection);
  return app.save(collection);
}, (app) => {
  // Откат намеренно НЕ возвращает публичные правила "" — это и была дыра.
  // Откатываемся в "только суперюзер" (null), а не в открытое состояние.
  let collection = app.findCollectionByNameOrId("templates");
  unmarshal({ "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null }, collection);
  app.save(collection);

  collection = app.findCollectionByNameOrId("abbreviations");
  unmarshal({ "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null }, collection);
  app.save(collection);

  collection = app.findCollectionByNameOrId("state_after_phrases");
  unmarshal({ "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null }, collection);
  app.save(collection);

  collection = app.findCollectionByNameOrId("notes_images");
  unmarshal({ "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null }, collection);
  return app.save(collection);
})
