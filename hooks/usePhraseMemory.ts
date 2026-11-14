import { useCallback, useEffect, useRef, useState } from 'react';
import pb from '../lib/pocketbase';
import {
  emptyStat,
  forget as forgetPhrase,
  forgiveRejected,
  learnField,
  rememberRejected,
  rememberText,
  rememberConclusionEdit,
  isEdited,
  emptyRules,
  RULES_EVERY,
  type ConclusionEdits,
  type ConclusionRules,
  type ConclusionRulesMap,
  type FieldMemory,
  type RecentTexts,
  type RejectedTexts,
  type SuggestStat,
  type SuggestStats,
  type TemplateMemory,
} from '../lib/phraseMemory';

// Память пользователя для одного шаблона (коллекция phrase_memory, одна
// запись на пару user+template — см. миграции 0005/0006):
//   data   — выученные фразы по полям (примеры формулировок для модели);
//   recent — последние целые тексты полей;
//   stats  — статистика ИИ-подсказок (показано/принято/время ответа);
//   rejected — отклонённые/проигнорированные подсказки (миграция 0007);
//   conclusion_edits / conclusion_rules — правки автозаключения врачом и
//            сведённые из них правила (миграция 0009).
// Логика — в lib/phraseMemory.ts, UI и запрос ИИ-подсказок — в pages/filler.tsx.
//
// Запись создаётся лениво, при первом сохранении: просто открыть шаблон —
// не повод заводить пустую запись. Статистика и удаления из окна
// «Выученные фразы» сохраняются с задержкой (SAVE_DELAY_MS) — пачкой;
// обучение после копирования протокола — сразу.
const SAVE_DELAY_MS = 1500;

interface MemoryState {
  data: TemplateMemory;
  recent: RecentTexts;
  stats: SuggestStats;
  rejected: RejectedTexts;
  conclusionEdits: ConclusionEdits;
  conclusionRules: ConclusionRulesMap;
}
const EMPTY: MemoryState = { data: {}, recent: {}, stats: {}, rejected: {}, conclusionEdits: {}, conclusionRules: {} };

export function usePhraseMemory(templateId: string | undefined) {
  const [state, setState] = useState<MemoryState>(EMPTY);
  const stateRef = useRef<MemoryState>(EMPTY);
  const recordIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  // Что уже выучено из текущего протокола — чтобы повторное «Копировать»
  // того же протокола не удваивало счётчики фраз и не плодило дубли текстов.
  // Сбрасывается startNewReport() (сброс/очистка протокола).
  const learnedThisReportRef = useRef<Record<string, Set<string>>>({});
  const recentThisReportRef = useRef<Set<string>>(new Set());
  // Пара «черновик → итог» этого протокола уже записана / уже учтена в
  // счётчике правок до сводки правил.
  const editThisReportRef = useRef<Set<string>>(new Set());
  const editCountedRef = useRef<Set<string>>(new Set());

  const flush = useCallback(async () => {
    if (!dirtyRef.current || !templateId) return;
    const userId = pb.authStore.record?.id;
    if (!userId) return;
    dirtyRef.current = false;
    const { data, recent, stats, rejected, conclusionEdits, conclusionRules } = stateRef.current;
    const payload = { data, recent, stats, rejected, conclusion_edits: conclusionEdits, conclusion_rules: conclusionRules };

    try {
      if (recordIdRef.current) {
        await pb.collection('phrase_memory').update(recordIdRef.current, payload);
        return;
      }
      try {
        const rec = await pb.collection('phrase_memory').create({ user: userId, template: templateId, ...payload });
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
        await pb.collection('phrase_memory').update(recordIdRef.current, payload);
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
        const loaded: MemoryState = {
          data: (rec?.data as TemplateMemory) || {},
          recent: (rec?.recent as RecentTexts) || {},
          stats: (rec?.stats as SuggestStats) || {},
          rejected: (rec?.rejected as RejectedTexts) || {},
          conclusionEdits: (rec?.conclusion_edits as ConclusionEdits) || {},
          conclusionRules: (rec?.conclusion_rules as ConclusionRulesMap) || {},
        };
        stateRef.current = loaded;
        setState(loaded);
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

  const commit = useCallback((next: MemoryState, immediately = false) => {
    stateRef.current = next;
    setState(next);
    dirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (immediately) flush();
    else saveTimerRef.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [flush]);

  // Обучение на финальном протоколе (Копировать / Сохранить): фразы и
  // целые тексты полей, а для «Заключения», куда вставлялся черновик ИИ
  // (drafts: id поля → вставленный черновик), — пара «черновик → итог».
  // Возвращает id полей, правила которых пора свести заново (RULES_EVERY
  // правок с изменениями после прошлой сводки).
  const learnFromReport = useCallback((fields: { id: string; text: string }[], drafts: Record<string, string> = {}): string[] => {
    const now = Date.now();
    let { data, recent, rejected, conclusionEdits, conclusionRules } = stateRef.current;
    let changed = false;
    const rulesDue: string[] = [];
    for (const { id, text } of fields) {
      const draft = drafts[id];
      if (!draft || !text?.trim()) continue;
      const replaceFirst = editThisReportRef.current.has(id);
      const list = rememberConclusionEdit(conclusionEdits[id], draft, text, replaceFirst, now);
      if (list === conclusionEdits[id] || !list.length) continue;
      conclusionEdits = { ...conclusionEdits, [id]: list };
      editThisReportRef.current.add(id);
      changed = true;
      // Счётчик правок до сводки: пара этого протокола считается один раз,
      // даже если её перезаписали повторным копированием.
      const counted = editCountedRef.current.has(id);
      const rules: ConclusionRules = { ...emptyRules(), ...conclusionRules[id] };
      let pending = rules.pending;
      if (isEdited(list[0]) && !counted) { pending++; editCountedRef.current.add(id); }
      else if (!isEdited(list[0]) && counted) { pending = Math.max(0, pending - 1); editCountedRef.current.delete(id); }
      if (pending !== rules.pending) conclusionRules = { ...conclusionRules, [id]: { ...rules, pending } };
      if (pending >= RULES_EVERY) rulesDue.push(id);
    }
    for (const { id, text } of fields) {
      if (!text?.trim()) continue;

      const skip = learnedThisReportRef.current[id] || new Set<string>();
      const { mem, learned } = learnField(data[id] || {}, text, skip, now);
      if (learned.length) {
        learned.forEach(k => skip.add(k));
        learnedThisReportRef.current[id] = skip;
        data = { ...data, [id]: mem };
        changed = true;
      }

      const nextRecent = rememberText(recent[id], text, recentThisReportRef.current.has(id));
      if (JSON.stringify(nextRecent) !== JSON.stringify(recent[id] || [])) {
        recent = { ...recent, [id]: nextRecent };
        recentThisReportRef.current.add(id);
        changed = true;
      }

      // Отклонённую раньше фразу пользователь в итоге написал сам — она
      // ему подходит, «так не пиши» для неё больше не нужно.
      const nextRejected = forgiveRejected(rejected[id], text);
      if (nextRejected !== rejected[id]) {
        rejected = { ...rejected, [id]: nextRejected || [] };
        changed = true;
      }
    }
    // Сразу, без задержки: протокол часто копируют и тут же закрывают вкладку.
    if (changed) commit({ ...stateRef.current, data, recent, rejected, conclusionEdits, conclusionRules }, true);
    return rulesDue;
  }, [commit]);

  const startNewReport = useCallback(() => {
    learnedThisReportRef.current = {};
    recentThisReportRef.current = new Set();
    editThisReportRef.current = new Set();
    editCountedRef.current = new Set();
  }, []);

  // Правила заключения поля: правка врачом в окне «Выученные фразы» или
  // новая сводка ИИ (тогда patch.pending = 0).
  const updateConclusionRules = useCallback((fieldId: string, update: (rules: ConclusionRules) => ConclusionRules) => {
    const current: ConclusionRules = { ...emptyRules(), ...stateRef.current.conclusionRules[fieldId] };
    const next = update(current);
    if (next === current) return;
    commit({ ...stateRef.current, conclusionRules: { ...stateRef.current.conclusionRules, [fieldId]: next } });
  }, [commit]);

  // Текущие правки и правила поля — сразу после learnFromReport, когда
  // state компонента ещё не обновился.
  const conclusionSnapshot = useCallback((fieldId: string) => ({
    edits: stateRef.current.conclusionEdits[fieldId] || [],
    rules: { ...emptyRules(), ...stateRef.current.conclusionRules[fieldId] } as ConclusionRules,
  }), []);

  const forget = useCallback((fieldId: string, key: string) => {
    const current: FieldMemory = stateRef.current.data[fieldId] || {};
    const next = forgetPhrase(current, key);
    if (next === current) return;
    commit({ ...stateRef.current, data: { ...stateRef.current.data, [fieldId]: next } });
  }, [commit]);

  // Счётчики ИИ-подсказок для поля и модели (добавляются к текущим).
  const recordSuggestStat = useCallback((fieldId: string, model: string, delta: Partial<SuggestStat>) => {
    const byModel = stateRef.current.stats[fieldId] || {};
    const cur = byModel[model] || emptyStat();
    const next: SuggestStat = {
      shown: cur.shown + (delta.shown || 0),
      accepted: cur.accepted + (delta.accepted || 0),
      requests: cur.requests + (delta.requests || 0),
      ms: cur.ms + (delta.ms || 0),
    };
    commit({
      ...stateRef.current,
      stats: { ...stateRef.current.stats, [fieldId]: { ...byModel, [model]: next } },
    });
  }, [commit]);

  // ИИ-подсказку отклонили (Esc) или проигнорировали (напечатали другое).
  const recordRejected = useCallback((fieldId: string, phrase: string) => {
    const list = stateRef.current.rejected[fieldId];
    const next = rememberRejected(list, phrase);
    if (next === list) return;
    commit({ ...stateRef.current, rejected: { ...stateRef.current.rejected, [fieldId]: next } });
  }, [commit]);

  return {
    memory: state.data,
    recent: state.recent,
    stats: state.stats,
    rejected: state.rejected,
    conclusionEdits: state.conclusionEdits,
    conclusionRules: state.conclusionRules,
    learnFromReport,
    updateConclusionRules,
    conclusionSnapshot,
    startNewReport,
    forget,
    recordSuggestStat,
    recordRejected,
  };
}
