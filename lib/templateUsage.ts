// Как часто и как давно открывали каждый шаблон на заполнение — для порядка
// списка шаблонов (pages/index.tsx): сверху то, чем пользуются. Хранится в
// этом браузере (localStorage): это удобство конкретного рабочего места, а
// не данные протокола; без хранилища список просто идёт по дате создания.

const KEY = 'template_usage';
// За сколько дней «вес» давнего использования падает вдвое.
const HALF_LIFE_DAYS = 14;

type Usage = Record<string, { count: number; last: number }>;

const read = (): Usage => {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

// Отметить открытие шаблона (страница заполнения).
export function recordTemplateUse(id: string, now = Date.now()) {
  try {
    const usage = read();
    const prev = usage[id];
    usage[id] = { count: (prev?.count || 0) + 1, last: now };
    localStorage.setItem(KEY, JSON.stringify(usage));
  } catch {
    // нет хранилища — порядок просто не запоминается
  }
}

// «Частота с учётом давности»: 10 открытий месяц назад весят меньше, чем 3
// вчера. 0 — шаблон в этом браузере ещё не открывали.
export function templateScores(now = Date.now()): Record<string, number> {
  const usage = read();
  const scores: Record<string, number> = {};
  for (const [id, u] of Object.entries(usage)) {
    const ageDays = Math.max(0, now - (u.last || 0)) / 86400000;
    scores[id] = (u.count || 0) * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  }
  return scores;
}
