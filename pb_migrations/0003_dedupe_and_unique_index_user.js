/// <reference path="../pb_data/types.d.ts" />
// Тест локально перед тем, как переносить в основной проект: сливаем
// возможные дубликаты "одна запись на пользователя" (гонка при первом
// заходе в filler.tsx создаёт две записи parallel-запросами), затем
// ставим уникальный индекс на user, чтобы гонка стала невозможна.
//
// JSON-поля (object/array) приходят из record.get() обёрнутыми в
// types.JSONMap/JSONArray — goja не даёт перечислить их напрямую через
// for..in (см. комментарий к JSONMap.get() в pb_data/types.d.ts), поэтому
// сначала сериализуем через .string() и парсим как обычный JS.
const readJson = (record, field, fallback) => {
  const raw = record.get(field);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw.string());
  } catch (e) {
    return fallback;
  }
};

migrate((app) => {
  const findAllRecords = (collectionName) => {
    const pageSize = 200;
    let offset = 0;
    let all = [];
    while (true) {
      const page = app.findRecordsByFilter(collectionName, "id != ''", "", pageSize, offset);
      all = all.concat(page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return all;
  };

  const dedupe = (collectionName, mergeFields) => {
    const records = findAllRecords(collectionName);
    const byUser = {};
    for (const r of records) {
      const uid = r.get("user");
      if (!byUser[uid]) byUser[uid] = [];
      byUser[uid].push(r);
    }
    for (const uid in byUser) {
      const group = byUser[uid];
      if (group.length <= 1) continue;
      const keep = group[0];
      mergeFields(keep, group);
      app.save(keep);
      for (let i = 1; i < group.length; i++) {
        app.delete(group[i]);
      }
    }
  };

  dedupe("abbreviations", (keep, group) => {
    const mergedAbbr = {};
    const mergedCats = [];
    const seenCats = {};
    for (const r of group) {
      const abbr = readJson(r, "abbreviations", {});
      for (const k in abbr) mergedAbbr[k] = abbr[k];
      const cats = readJson(r, "categories", []);
      cats.forEach((c) => {
        if (!seenCats[c]) {
          seenCats[c] = true;
          mergedCats.push(c);
        }
      });
    }
    keep.set("abbreviations", mergedAbbr);
    keep.set("categories", mergedCats);
  });

  dedupe("state_after_phrases", (keep, group) => {
    const mergedPhrases = [];
    const seen = {};
    for (const r of group) {
      const phrases = readJson(r, "phrases", []);
      phrases.forEach((p) => {
        if (!seen[p]) {
          seen[p] = true;
          mergedPhrases.push(p);
        }
      });
    }
    keep.set("phrases", mergedPhrases);
  });

  let collection = app.findCollectionByNameOrId("abbreviations");
  collection.indexes = ["CREATE UNIQUE INDEX idx_abbreviations_user ON abbreviations (user)"];
  app.save(collection);

  collection = app.findCollectionByNameOrId("state_after_phrases");
  collection.indexes = ["CREATE UNIQUE INDEX idx_state_after_phrases_user ON state_after_phrases (user)"];
  return app.save(collection);
}, (app) => {
  let collection = app.findCollectionByNameOrId("abbreviations");
  collection.indexes = [];
  app.save(collection);

  collection = app.findCollectionByNameOrId("state_after_phrases");
  collection.indexes = [];
  return app.save(collection);
})
