import { useEffect, useState } from 'react';
import pb from '../lib/pocketbase';

export interface AbbreviationEntry {
  full: string;
  category: string;
  usage: number;
}
export type AbbreviationMap = Record<string, AbbreviationEntry>;

// Хранит и синхронизирует с PocketBase словарь сокращений пользователя
// (коллекция abbreviations, одна запись на пользователя — см. миграцию
// 0003_dedupe_and_unique_index_user.js). UI (модалка настройки, автодополнение
// при наборе текста) остаётся в filler.tsx — здесь только данные и мутации.
export function useAbbreviations() {
  const [abbreviations, setAbbreviations] = useState<AbbreviationMap>({});
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    const loadAbbr = async () => {
      if (!pb.authStore.record?.id) return;

      const userId = pb.authStore.record.id;

      try {
        const records = await pb.collection('abbreviations').getList(1, 1, {
          filter: `user = "${userId}"`,
          $autoCancel: false
        });

        if (records.items.length > 0) {
          const record = records.items[0];
          setAbbreviations(record.abbreviations || {});
          setCategories(record.categories || ['Общие']);
        } else {
          throw { status: 404 };
        }
      } catch (err: unknown) {
        const error = err as { status?: number };
        if (error?.status === 404) {
          try {
            const defaultData = {
              user: userId,
              abbreviations: {},
              categories: []
            };
            const newRecord = await pb.collection('abbreviations').create(defaultData);
            setAbbreviations(newRecord.abbreviations);
            setCategories(newRecord.categories);
          } catch {
            // Параллельный запрос (другая вкладка/повторный рендер) уже успел
            // создать запись первым — уникальный индекс на user не даёт создать
            // вторую, вместо гонки просто читаем ту, что уже есть.
            try {
              const records = await pb.collection('abbreviations').getList(1, 1, {
                filter: `user = "${userId}"`,
                $autoCancel: false
              });
              const record = records.items[0];
              setAbbreviations(record?.abbreviations || {});
              setCategories(record?.categories || ['Общие']);
            } catch (retryErr) {
              console.error("Ошибка загрузки аббревиатур после гонки:", retryErr);
              setAbbreviations({});
              setCategories(['Общие']);
            }
          }
        } else {
          console.error("Ошибка загрузки:", err);
          setAbbreviations({});
          setCategories(['Общие']);
        }
      }
    };
    loadAbbr();
  }, []);

  const saveData = async (newAbbr: AbbreviationMap, newCats: string[]) => {
    setAbbreviations(newAbbr);
    setCategories(newCats);

    if (!pb.authStore.record?.id) return;

    const userId = pb.authStore.record.id;
    const payload = {
      abbreviations: newAbbr,
      categories: newCats,
      user: userId
    };

    try {
      const records = await pb.collection('abbreviations').getList(1, 1, {
        filter: `user = "${userId}"`,
        $autoCancel: false
      });

      if (records.items.length > 0) {
        await pb.collection('abbreviations').update(records.items[0].id, payload);
      } else {
        try {
          await pb.collection('abbreviations').create(payload);
        } catch (createErr) {
          // Гонка: запись уже создана параллельным запросом — обновляем её.
          const retry = await pb.collection('abbreviations').getList(1, 1, {
            filter: `user = "${userId}"`,
            $autoCancel: false
          });
          if (retry.items[0]) {
            await pb.collection('abbreviations').update(retry.items[0].id, payload);
          } else {
            throw createErr;
          }
        }
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("❌ Ошибка сохранения:", errorMessage);
    }
  };

  const addNewGroup = () => {
    let newName = 'Новая группа';
    let counter = 1;

    while (categories.includes(newName)) {
      counter++;
      newName = `Новая группа ${counter}`;
    }

    saveData(abbreviations, [...categories, newName]);
    return newName;
  };

  const addNewAbbreviation = (key: string, full: string, selectedCategory: string) => {
    if (!key || !full) return;
    const cat = selectedCategory !== 'Все' ? selectedCategory : 'Общие';
    saveData({ ...abbreviations, [key]: { full, category: cat, usage: 0 } }, categories);
  };

  const deleteCategory = (cat: string) => {
    const newAbbr = { ...abbreviations };
    Object.keys(newAbbr).forEach(key => {
      if (newAbbr[key].category === cat) {
        delete newAbbr[key];
      }
    });

    const newCats = categories.filter(c => c !== cat);
    saveData(newAbbr, newCats);
  };

  const deleteAbbreviation = (key: string) => {
    const newAbbr = { ...abbreviations };
    delete newAbbr[key];
    saveData(newAbbr, categories);
  };

  // Инкремент счётчика использования при автодополнении во время набора текста
  // (см. handleKeyDown/selectVariant в filler.tsx).
  const recordUsage = (key: string) => {
    if (!abbreviations[key]) return;
    const updated = JSON.parse(JSON.stringify(abbreviations));
    updated[key].usage = (updated[key].usage || 0) + 1;
    saveData(updated, categories);
  };

  const exportAbbreviations = () => {
    const dataStr = JSON.stringify({ abbreviations, categories }, null, 2);
    const link = document.createElement('a');
    link.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    link.download = 'xreport-abbreviations.json';
    link.click();
  };

  const importAbbreviations = (file: File): Promise<void> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const imported = JSON.parse(event.target?.result as string);
          saveData(imported.abbreviations || {}, imported.categories || ['Общие']);
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      reader.readAsText(file);
    });
  };

  return {
    abbreviations,
    categories,
    saveData,
    addNewGroup,
    addNewAbbreviation,
    deleteCategory,
    deleteAbbreviation,
    recordUsage,
    exportAbbreviations,
    importAbbreviations,
  };
}
