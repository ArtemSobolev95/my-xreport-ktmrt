/// <reference path="../pb_data/types.d.ts" />
// Два новых JSON-поля в phrase_memory (см. hooks/usePhraseMemory.ts):
//   stats  — статистика ИИ-подсказок по полям и моделям: сколько показано,
//            сколько принято, сколько запросов и суммарное время ответа —
//            чтобы точность было видно цифрой, а Lite/Pro можно было сравнить;
//   recent — последние целые тексты каждого поля (числа заменены на N) —
//            примеры того, как пользователь строит описание целиком.
// Если поле уже есть — не трогаем.
migrate((app) => {
  let collection;
  try {
    collection = app.findCollectionByNameOrId("phrase_memory");
  } catch (_) {
    console.log("0006_phrase_memory_stats_recent.js: коллекции phrase_memory нет — пропускаем");
    return;
  }

  for (const name of ["stats", "recent"]) {
    if (collection.fields.getByName(name)) continue;
    collection.fields.add(new JSONField({ name: name, maxSize: 2097152 }));
  }
  return app.save(collection);
}, (app) => {
  let collection;
  try {
    collection = app.findCollectionByNameOrId("phrase_memory");
  } catch (_) {
    return;
  }
  for (const name of ["stats", "recent"]) {
    if (collection.fields.getByName(name)) collection.fields.removeByName(name);
  }
  return app.save(collection);
})
