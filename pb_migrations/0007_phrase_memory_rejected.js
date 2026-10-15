/// <reference path="../pb_data/types.d.ts" />
// Новое JSON-поле rejected в phrase_memory (см. hooks/usePhraseMemory.ts):
// по полям — последние ИИ-подсказки, которые пользователь отклонил (Esc)
// или проигнорировал (напечатал другое). Уходят в запрос модели как «так
// не пиши». Если такую фразу пользователь потом всё же написал сам и
// скопировал протокол — она из списка убирается.
// Если поле уже есть — не трогаем.
migrate((app) => {
  let collection;
  try {
    collection = app.findCollectionByNameOrId("phrase_memory");
  } catch (_) {
    console.log("0007_phrase_memory_rejected.js: коллекции phrase_memory нет — пропускаем");
    return;
  }
  if (collection.fields.getByName("rejected")) return;
  collection.fields.add(new JSONField({ name: "rejected", maxSize: 1048576 }));
  return app.save(collection);
}, (app) => {
  let collection;
  try {
    collection = app.findCollectionByNameOrId("phrase_memory");
  } catch (_) {
    return;
  }
  if (collection.fields.getByName("rejected")) collection.fields.removeByName("rejected");
  return app.save(collection);
})
