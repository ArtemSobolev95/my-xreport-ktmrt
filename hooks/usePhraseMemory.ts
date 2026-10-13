import { useCallback, useEffect, useRef, useState } from 'react';
import pb from '../lib/pocketbase';
import {
  forget as forgetPhrase,
  learnField,
  markAccepted,
  markRejected,
  type FieldMemory,
  type TemplateMemory,
} from '../lib/phraseMemory';

// Память фраз пользователя для одного шаблона (коллекция phrase_memory,
// одна запись на пару user+template — см. миграцию
// 0005_create_phrase_memory.js). Логика обучения/подсказок — в
// lib/phraseMemory.ts, UI — в pages/filler.tsx.
//
// Запись создаётся лениво, при первом сохранении: просто открыть шаблон —
// не повод заводить пустую запись. Сохранение отложенное (SAVE_DELAY_MS):
// принятия подсказок идут пачками во время набора, а писать в базу на
// каждое — лишняя нагрузка.
const SAVE_DELAY_MS = 1500;

export function usePhraseMemory(templateId: string | undefined) {
  const [memory, setMemory] = useState<TemplateMemory>({});
  const memoryRef = useRef<TemplateMemory>({});
  const recordIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  // Ключи фраз, уже выученных из текущего протокола, по полям — чтобы
  // повторное «Копировать» того же протокола не удваивало счётчики.
  // Сбрасывается startNewReport() (сброс/очистка протокола).
  const learnedThisReportRef = useRef<Record<string, Set<string>>>({});

  const flush = useCallback(async () => {
    if (!dirtyRef.current || !templateId) return;
    const userId = pb.authStore.record?.id;
    if (!userId) return;
    dirtyRef.current = false;
    const data = memoryRef.current;

    try {
      if (recordIdRef.current) {
        await pb.collection('phrase_memory').update(recordIdRef.current, { data });
        return;
      }
      try {
        const rec = await pb.collection('phrase_memory').create({ user: userId, template: templateId, data });
        recordIdRef.current = rec.id;
      } catch (createErr) {
        // Запись уже создана из другой вкладки (уникальный индекс
        // user+template) — обновляем её.
        const existing = await pb.collection('phrase_memory').getList(1, 1, {
          filter: pb.filter('user = {:user} && template = {:template}', { user: userId, template: templateId }),
          $autoCancel: false,
        });
        if (!existing.items[0]) throw createErr;
        recordIdRef.current = existing.items[0].id;
        await pb.collection('phrase_memory').update(recordIdRef.current, { data });
      }
    } catch (err) {
      dirtyRef.current = true;
      console.error('[phrase_memory] не удалось сохранить:', err);
    }
  }, [templateId]);

  useEffect(() => {
    if (!templateId) return;
    const userId = pb.authStore.record?.id;
    if (!userId) return;
    let cancelled = false;

    pb.collection('phrase_memory')
      .getList(1, 1, {
        filter: pb.filter('user = {:user} && template = {:template}', { user: userId, template: templateId }),
        $autoCancel: false,
      })
      .then(res => {
        if (cancelled) return;
        const rec = res.items[0];
        recordIdRef.current = rec?.id ?? null;
        const data = (rec?.data as TemplateMemory) || {};
        memoryRef.current = data;
        setMemory(data);
      })
      .catch(err => console.error('[phrase_memory] не удалось загрузить:', err));

    return () => {
      cancelled = true;
    };
  }, [templateId]);

  // Не теряем несохранённое при уходе со страницы.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      flush();
    };
  }, [flush]);

  const commit = useCallback((next: TemplateMemory) => {
    memoryRef.current = next;
    setMemory(next);
    dirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [flush]);

  const updateFieldMemory = useCallback((fieldId: string, fn: (m: FieldMemory) => FieldMemory) => {
    const current = memoryRef.current[fieldId] || {};
    const next = fn(current);
    if (next === current) return;
    commit({ ...memoryRef.current, [fieldId]: next });
  }, [commit]);

  // Обучение на финальном протоколе (Копировать / Сохранить).
  const learnFromReport = useCallback((fields: { id: string; text: string }[]) => {
    const now = Date.now();
    let next = memoryRef.current;
    let changed = false;
    for (const { id, text } of fields) {
      if (!text?.trim()) continue;
      const skip = learnedThisReportRef.current[id] || new Set<string>();
      const { mem, learned } = learnField(next[id] || {}, text, skip, now);
      if (!learned.length) continue;
      learned.forEach(k => skip.add(k));
      learnedThisReportRef.current[id] = skip;
      next = { ...next, [id]: mem };
      changed = true;
    }
    if (!changed) return;
    // Сразу, без задержки: протокол часто копируют и тут же закрывают вкладку.
    commit(next);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    flush();
  }, [commit, flush]);

  const startNewReport = useCallback(() => {
    learnedThisReportRef.current = {};
  }, []);

  const accept = useCallback((fieldId: string, key: string) => {
    updateFieldMemory(fieldId, m => markAccepted(m, key));
  }, [updateFieldMemory]);

  const reject = useCallback((fieldId: string, key: string) => {
    updateFieldMemory(fieldId, m => markRejected(m, key));
  }, [updateFieldMemory]);

  const forget = useCallback((fieldId: string, key: string) => {
    updateFieldMemory(fieldId, m => forgetPhrase(m, key));
  }, [updateFieldMemory]);

  return { memory, learnFromReport, startNewReport, accept, reject, forget };
}
