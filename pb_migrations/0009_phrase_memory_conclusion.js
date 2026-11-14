/// <reference path="../pb_data/types.d.ts" />
// Два новых JSON-поля в phrase_memory (см. hooks/usePhraseMemory.ts) —
// обучение автозаключения на правках врача:
//   conclusion_edits — по полям «Заключение»: пары «черновик ИИ → что врач
//                      в итоге скопировал» (числа заменены на N), новые первыми;
//   conclusion_rules — по полям: правила врача для заключения — выведенные
//                      ИИ из правок (auto), написанные врачом (manual) и
//                      удалённые врачом (removed, чтобы ИИ их не выводил снова).
// Если поле уже есть — не трогаем.
migrate((app) => {
  let collection;
  try {
    collection = app.findCollectionByNameOrId("phrase_memory");
  } catch (_) {
    console.log("0009_phrase_memory_conclusion.js: коллекции phrase_memory нет — пропускаем");
    return;
  }
  for (const name of ["conclusion_edits", "conclusion_rules"]) {
    if (collection.fields.getByName(name)) continue;
    collection.fields.add(new JSONField({ name: name, maxSize: 1048576 }));
  }
  return app.save(collection);
}, (app) => {
  let collection;
  try {
    collection = app.findCollectionByNameOrId("phrase_memory");
  } catch (_) {
    return;
  }
  for (const name of ["conclusion_edits", "conclusion_rules"]) {
    if (collection.fields.getByName(name)) collection.fields.removeByName(name);
  }
  return app.save(collection);
})
