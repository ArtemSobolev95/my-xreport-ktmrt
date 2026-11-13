'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import pb from '../lib/pocketbase';
import Link from 'next/link';
import withAuth from '../components/withAuth';
import UserHeader from '../components/UserHeader';
import { Copy, FileText, Globe, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TemplateListItem } from '../types/builder';
import { useDialog } from '../components/DialogProvider';
import { templateLastUsed, templateScores } from '../lib/templateUsage';
import { matchesLayoutSearch } from '../lib/layoutSearch';

function HomePage() {
  const router = useRouter();
  const dialog = useDialog();
  const currentUserId = pb.authStore.record?.id;
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Открытое меню «⋯» строки (id шаблона).
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Сразу в поиск — только с мышью/клавиатурой: на телефоне фокус при
  // открытии страницы выдвигал бы экранную клавиатуру поверх списка.
  useEffect(() => {
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      searchRef.current?.focus();
    }
  }, []);

  // Порядок, в котором шаблоны пришли с сервера, — запасной ключ сортировки.
  // Поля created у коллекции может не быть (в PocketBase ≥0.23 автодаты
  // больше не добавляются сами — так и в локальной базе): тогда сравнение
  // дат давало NaN, и порядок получался случайным.
  const serverOrderRef = useRef(new Map<string, number>());

  const isMine = (t: TemplateListItem) => t.user === currentUserId;

  // Сверху — свои шаблоны (ими пользуются каждый день), ниже — публичные
  // шаблоны других авторов. Внутри группы — по использованию в этом
  // браузере (часто и недавно открываемые — первыми, lib/templateUsage.ts),
  // затем новые, а без дат — в исходном порядке сервера.
  const sortTemplates = (list: TemplateListItem[]) => {
    const scores = templateScores();
    return [...list].sort((a, b) => {
      if (isMine(a) !== isMine(b)) return isMine(a) ? -1 : 1;
      const byUse = (scores[b.id] || 0) - (scores[a.id] || 0);
      if (byUse) return byUse;
      const byDate = new Date(b.created).getTime() - new Date(a.created).getTime();
      if (byDate) return byDate;
      return (serverOrderRef.current.get(a.id) ?? 0) - (serverOrderRef.current.get(b.id) ?? 0);
    });
  };

          const loadTemplates = async () => {
    setLoading(true);
    try {
      // Список показывает только title/created/user/isPublic — тяжёлое поле
      // fields (вся структура шаблона) здесь не нужно и грузится только при
      // открытии конкретного шаблона в builder/filler. Какие записи видны
      // (свои + публичные), решает listRule коллекции на сервере; фильтр
      // ниже — лишь страховка.
      const records = await pb.collection('templates').getFullList({
        fields: 'id,title,created,user,isPublic',
      });

      const visibleTemplates = (records as unknown as TemplateListItem[]).filter(
        (t) => isMine(t) || t.isPublic === true
      );

      serverOrderRef.current = new Map(visibleTemplates.map((t, i) => [t.id, i]));
      setTemplates(sortTemplates(visibleTemplates));
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
    // Загрузка — один раз при открытии страницы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const normalizeTitle = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');

  // Публикация своего шаблона (переключатель в строке). Свой шаблон при
  // этом остаётся в группе "Мои" — список не пересортировывается.
  const togglePublic = async (t: TemplateListItem) => {
    const makePublic = !t.isPublic;

    if (makePublic) {
      // Та же проверка, что при сохранении в билдере: среди публичных
      // шаблонов название должно быть уникальным.
      const clash = templates.find(o =>
        o.id !== t.id && o.isPublic && normalizeTitle(o.title) === normalizeTitle(t.title)
      );
      if (clash) {
        await dialog.alert(
          `Публичный шаблон «${clash.title}» уже есть. Переименуйте свой шаблон, чтобы опубликовать его.`,
          { title: 'Название занято' }
        );
        return;
      }
      const confirmed = await dialog.confirm(
        `Шаблон «${t.title}» увидят все пользователи. Изменять его сможете только вы — остальные смогут заполнять его и сохранять копии.`,
        { title: 'Сделать шаблон публичным?', confirmText: 'Опубликовать' }
      );
      if (!confirmed) return;
    }

    setTemplates(prev => prev.map(x => (x.id === t.id ? { ...x, isPublic: makePublic } : x)));
    try {
      await pb.collection('templates').update(t.id, { isPublic: makePublic });
    } catch (err) {
      setTemplates(prev => prev.map(x => (x.id === t.id ? { ...x, isPublic: !makePublic } : x)));
      const message = err instanceof Error ? err.message : String(err);
      await dialog.alert('Не удалось изменить видимость шаблона: ' + message);
    }
  };

  const deleteTemplate = async (id: string, title: string) => {
  const confirmed = await dialog.confirm(`Шаблон «${title}» будет удалён без возможности восстановления.`, { title: 'Удалить шаблон?', danger: true, confirmText: 'Удалить' });
  if (!confirmed) return;

  try {
    await pb.collection('templates').delete(id);
    // Убираем из списка локально, а не перезагружаем его: loadTemplates
    // показывает полноэкранный спиннер — страница мигала, и карточка не
    // успевала проиграть анимацию исчезновения.
    setTemplates(prev => prev.filter(t => t.id !== id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await dialog.alert('Ошибка при удалении: ' + message);
  }
};


  const filteredTemplates = templates.filter(t => matchesLayoutSearch(t.title, searchTerm));

  // Когда шаблоны открывали (этот браузер) — для «Недавних» и подписи на
  // карточке. Читается один раз: за время на странице не меняется.
  const [lastUsed] = useState<Record<string, number>>(() =>
    typeof window === 'undefined' ? {} : templateLastUsed()
  );
  const now = Date.now();

  // Сетка: «Недавние» (без поиска — до одной строки карточек, открытые за
  // последний месяц), затем «Мои шаблоны» и «Публичные». Недавний шаблон
  // остаётся и в своей группе — у карточки свой ключ (`recent-…`).
  const recent = !searchTerm.trim() && templates.length > RECENT_LIMIT + 2
    ? templates
        .filter(t => lastUsed[t.id] && now - lastUsed[t.id] < RECENT_DAYS * DAY_MS)
        .sort((a, b) => lastUsed[b.id] - lastUsed[a.id])
        .slice(0, RECENT_LIMIT)
    : [];
  const items: GridItem[] = [
    ...recent.map(t => ({ key: `recent-${t.id}`, t, group: 'recent' as const })),
    ...filteredTemplates.map(t => ({ key: t.id, t, group: isMine(t) ? 'mine' as const : 'public' as const })),
  ];

  // Выделение — всегда в пределах текущего списка. Пока список фильтруется,
  // уходящие карточки (AnimatePresence) проезжают под неподвижным курсором, и
  // их onMouseEnter выставлял номер, которого в новом списке уже нет — Enter
  // тогда ничего не открывал, а выделение пропадало.
  const activeIndex = Math.min(selectedIndex, Math.max(items.length - 1, 0));

  const openFiller = (t: TemplateListItem) => router.push(`/filler?id=${t.id}`);
  const openBuilder = (t: TemplateListItem) => router.push(`/builder?edit=${t.id}`);

  // ↑↓ в сетке — к карточке строкой выше/ниже, ближайшей по горизонтали.
  // По реальному положению карточек, а не по числу колонок: строки групп
  // бывают неполными, а колонок на разных экранах разное число.
  const moveVertical = (dir: 1 | -1) => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-template-index]'));
    const cur = els.find(el => Number(el.dataset.templateIndex) === activeIndex);
    if (!cur) return setSelectedIndex(0);
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    let best: { idx: number; dy: number; dx: number } | null = null;
    for (const el of els) {
      const idx = Number(el.dataset.templateIndex);
      if (idx === activeIndex || idx >= items.length) continue;
      const er = el.getBoundingClientRect();
      const dy = dir === 1 ? er.top - r.bottom : r.top - er.bottom;
      if (dy < -1) continue;
      const dx = Math.abs(er.left + er.width / 2 - cx);
      if (!best || dy < best.dy - 4 || (Math.abs(dy - best.dy) <= 4 && dx < best.dx)) best = { idx, dy, dx };
    }
    if (best) setSelectedIndex(best.idx);
  };

  // Клавиши в поле поиска: ←↑↓→ — выбор (← → — только при пустом поиске,
  // иначе они двигают курсор в тексте), Enter — заполнить, Shift+Enter —
  // редактировать (чужой — создать копию), Esc — очистить поиск.
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveVertical(e.key === 'ArrowDown' ? 1 : -1);
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !searchTerm) {
      e.preventDefault();
      setSelectedIndex(e.key === 'ArrowRight'
        ? Math.min(activeIndex + 1, Math.max(items.length - 1, 0))
        : Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = items[activeIndex];
      if (selected) (e.shiftKey ? openBuilder : openFiller)(selected.t);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setSearchTerm('');
    }
  };

  // Набор текста с любого места страницы попадает в поиск — как раньше,
  // но теперь это настоящее поле: в него можно кликнуть, вставить текст,
  // исправить букву в середине.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (menuFor && e.key === 'Escape') {
        e.preventDefault();
        setMenuFor(null);
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (active === searchRef.current) return;
      const tag = active?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key.length === 1 || ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Backspace'].includes(e.key)) {
        // Фокус в поле — сам символ браузер вставит уже туда.
        searchRef.current?.focus();
        if (e.key !== 'Backspace' && e.key.length !== 1) {
          e.preventDefault();
          handleSearchKeyDown(e as unknown as React.KeyboardEvent<HTMLInputElement>);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // Новый поиск — выбираем первый результат
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchTerm]);

  // Список укоротился (удаление) — выделение остаётся на той же позиции,
  // а не прыгает в начало; только не выходит за конец списка.
  useEffect(() => {
    setSelectedIndex(prev => Math.min(prev, Math.max(items.length - 1, 0)));
  }, [items.length]);

  // Прокрутка выбранного шаблона в видимую область
  useEffect(() => {
    const el = document.querySelector(`[data-template-index="${activeIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex]);

  // Меню «⋯» закрывается кликом мимо.
  useEffect(() => {
    if (!menuFor) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-row-menu]')) setMenuFor(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuFor]);

  // Подписи групп — когда групп больше одной: если все шаблоны свои и
  // «Недавних» нет, подпись «Мои шаблоны» ничего не добавляет.
  const showGroupLabels = new Set(items.map(i => i.group)).size > 1;

  return (
    <div className="min-h-screen bg-zinc-950 text-white selection:bg-amber-400/30 selection:text-white">
      <div className="sticky top-0 z-50 bg-zinc-900/90 backdrop-blur-xl border-b border-white/10">
        <UserHeader />
      </div>

      <div className="max-w-6xl mx-auto pt-8 px-4 sm:px-6 pb-32">
        <div className="flex items-center gap-3">
          <label className="flex-1 min-w-0 h-9 px-3 flex items-center gap-2 rounded-xl bg-zinc-900/75 border border-white/10 focus-within:border-white/20 transition-colors cursor-text">
            <Search className="w-4 h-4 shrink-0 text-zinc-500" strokeWidth={1.75} />
            <input
              ref={searchRef}
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Найти шаблон"
              aria-label="Поиск шаблона"
              className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder:text-zinc-500 outline-none"
              data-custom-focus
            />
            {searchTerm && (
              <button
                type="button"
                tabIndex={-1}
                onClick={() => { setSearchTerm(''); searchRef.current?.focus(); }}
                className="shrink-0 h-5 px-1.5 inline-flex items-center rounded-md bg-white/5 border border-white/10 text-[10px] font-medium text-zinc-400 hover:text-white cursor-pointer"
              >
                Esc
              </button>
            )}
          </label>

          {/* Единственный янтарный акцент страницы. */}
          <Link
            href="/builder"
            tabIndex={-1}
            className="h-9 px-3.5 shrink-0 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium bg-amber-400 text-zinc-950 hover:bg-amber-300 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" strokeWidth={2} />
            <span className="sm:hidden">Новый</span>
            <span className="hidden sm:inline">Новый шаблон</span>
          </Link>
        </div>

        {/* Подсказка по клавишам — чтобы о них можно было узнать. На
            сенсорных экранах клавиатуры нет — там только отступ. */}
        <div className="mt-2 mb-5 px-1 flex pointer-coarse:*:hidden flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-600">
          <span><Kbd>←</Kbd><Kbd>↑</Kbd><Kbd>↓</Kbd><Kbd>→</Kbd> выбор</span>
          <span><Kbd>Enter</Kbd> заполнить</span>
          <span><Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> редактировать</span>
        </div>

        {loading ? (
          <ListSkeleton />
        ) : (
          <>
            {/* Список в разметке всегда, пустое состояние — под ним: иначе
                AnimatePresence размонтировался бы вместе с последней строкой. */}
            <div className={GRID_CLASS}>
              <AnimatePresence initial={false} mode="popLayout">
                {items.flatMap((item, idx) => {
                  const { t } = item;
                  const isSelected = idx === activeIndex;
                  const mine = isMine(t);
                  const nodes = [];
                  if (showGroupLabels && item.group !== items[idx - 1]?.group) {
                    nodes.push(groupLabel(`label-${item.group}`, GROUP_TITLES[item.group], idx > 0 ? 'mt-4' : ''));
                  }
                  const used = lastUsed[t.id];

                  nodes.push(
                    <motion.div
                      key={item.key}
                      layout="position"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                      data-template-index={idx}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      // Карточка целиком — «Заполнить» (одним кликом).
                      onClick={() => openFiller(t)}
                      title={t.title}
                      className={`group relative flex flex-col min-[440px]:h-[88px] pl-3 pr-1.5 pt-2 pb-2.5 rounded-xl border cursor-pointer transition-colors duration-100 ${
                        isSelected ? 'bg-white/[0.07] border-amber-400/40' : 'bg-zinc-900/60 border-white/[0.07]'
                      } ${menuFor === item.key ? 'z-30' : ''}`}
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        <FileText className={`w-4 h-4 mt-1.5 shrink-0 ${isSelected ? 'text-amber-400' : 'text-zinc-600'}`} strokeWidth={1.75} />
                        <span className={`flex-1 min-w-0 pt-1 text-sm leading-snug line-clamp-2 break-words ${isSelected ? 'text-white' : 'text-zinc-200'}`}>
                          {t.title}
                        </span>

                        {/* Второстепенные действия — у выбранной/наведённой карточки. */}
                        <div
                          // На сенсорных экранах наведения нет — действия видны всегда.
                          className={`flex items-center gap-0.5 shrink-0 transition-opacity ${isSelected || menuFor === item.key ? 'opacity-100' : 'opacity-0 pointer-coarse:opacity-100'}`}
                          onClick={e => e.stopPropagation()}
                        >
                          <Link
                            href={`/builder?edit=${t.id}`}
                            tabIndex={-1}
                            className={`${ICON_BUTTON_CLASS} text-zinc-400 hover:text-white hover:bg-white/10`}
                            data-tip={mine ? 'Редактировать (Shift+Enter)' : 'Создать копию (Shift+Enter)'}
                          >
                            {mine ? <Pencil className="w-4 h-4" strokeWidth={1.75} /> : <Copy className="w-4 h-4" strokeWidth={1.75} />}
                          </Link>
                          {mine && (
                            <div className="relative" data-row-menu>
                              <button
                                type="button"
                                tabIndex={-1}
                                onClick={() => setMenuFor(menuFor === item.key ? null : item.key)}
                                aria-label="Ещё"
                                aria-expanded={menuFor === item.key}
                                className={`${ICON_BUTTON_CLASS} text-zinc-400 hover:text-white hover:bg-white/10 ${menuFor === item.key ? 'bg-white/10 text-white' : ''}`}
                              >
                                <MoreHorizontal className="w-4 h-4" strokeWidth={1.75} />
                              </button>
                              <AnimatePresence>
                                {menuFor === item.key && (
                                  <motion.div
                                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                                    transition={{ duration: 0.12 }}
                                    className="absolute right-0 top-full mt-1 z-40 w-52 rounded-xl bg-zinc-900 border border-white/10 shadow-2xl p-1 origin-top-right"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => { setMenuFor(null); togglePublic(t); }}
                                      className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-200 hover:bg-white/10 cursor-pointer"
                                    >
                                      <Globe className="w-4 h-4 text-zinc-400" strokeWidth={1.75} />
                                      {t.isPublic ? 'Сделать личным' : 'Сделать публичным'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { setMenuFor(null); deleteTemplate(t.id, t.title); }}
                                      className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-red-400 hover:bg-red-400/10 cursor-pointer"
                                    >
                                      <Trash2 className="w-4 h-4" strokeWidth={1.75} />
                                      Удалить
                                    </button>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-0.5 min-[440px]:mt-auto pl-6 flex items-center gap-2 min-w-0 text-[11px] text-zinc-500">
                        <span className="truncate">{used ? `Открывали ${formatAgo(used, now)}` : 'Ещё не открывали'}</span>
                        {t.isPublic && (mine || item.group === 'recent') && (
                          <span className="shrink-0 inline-flex items-center gap-1" title="Виден всем пользователям">
                            <Globe className="w-3 h-3" strokeWidth={1.75} />
                            публичный
                          </span>
                        )}
                      </div>
                    </motion.div>
                  );
                  return nodes;
                })}
              </AnimatePresence>
            </div>

            {items.length === 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.2 }}>
                <EmptyState
                  icon={searchTerm ? <Search className="w-5 h-5" strokeWidth={1.75} /> : <FileText className="w-5 h-5" strokeWidth={1.75} />}
                  title={searchTerm ? 'Ничего не найдено' : 'Пока нет ни одного шаблона'}
                  text={searchTerm
                    ? `Нет шаблонов, содержащих «${searchTerm}». Esc — очистить поиск.`
                    : 'Создайте первый шаблон — кнопка «Новый шаблон» справа вверху.'}
                />
              </motion.div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Сетка карточек: на телефоне — одна колонка компактных карточек (высота
// по содержимому), шире — до четырёх колонок карточек одной высоты.
const GRID_CLASS = 'grid grid-cols-1 min-[440px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2';

const DAY_MS = 86400000;
// «Недавние» — одна строка карточек на широком экране, за последний месяц.
const RECENT_LIMIT = 4;
const RECENT_DAYS = 30;

type GridItem = { key: string; t: TemplateListItem; group: 'recent' | 'mine' | 'public' };

const GROUP_TITLES: Record<GridItem['group'], string> = {
  recent: 'Недавние',
  mine: 'Мои шаблоны',
  public: 'Публичные',
};

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

// «сегодня», «вчера», «3 дня назад», «2 недели назад», дальше — дата.
const formatAgo = (ts: number, now: number): string => {
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.ceil((startOfToday.getTime() - ts) / DAY_MS));
  if (days === 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  if (days < 30) { const w = Math.floor(days / 7); return `${w} ${plural(w, 'неделю', 'недели', 'недель')} назад`; }
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: new Date(ts).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
};

// Иконки 16px в квадратах 32px.
const ICON_BUTTON_CLASS = 'tooltip tooltip-top w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-lg transition-colors cursor-pointer focus:outline-none';

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 h-4 min-w-4 px-1 inline-flex items-center justify-center rounded bg-white/5 border border-white/10 font-sans text-[10px] text-zinc-500">
      {children}
    </kbd>
  );
}

// Заготовка списка на время загрузки — вместо спиннера на весь экран.
function ListSkeleton() {
  return (
    <div className={GRID_CLASS} aria-label="Загрузка" aria-busy="true">
      {[62, 48, 71, 40, 55, 66, 52, 44].map((w, i) => (
        <div key={i} className="h-16 min-[440px]:h-[88px] p-3 flex flex-col rounded-xl border border-white/[0.05] bg-zinc-900/40">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-white/5 animate-pulse" />
            <div className="h-3 rounded bg-white/5 animate-pulse" style={{ width: `${w}%` }} />
          </div>
          <div className="mt-auto ml-6 h-2.5 w-24 rounded bg-white/5 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// Подпись группы. motion + layout — плавно сдвигается вместе со строками.
// Обычная функция, а не компонент: AnimatePresence mode="popLayout"
// передаёт ref своим детям.
const groupLabel = (key: string, children: React.ReactNode, className = '') => (
  <motion.div
    key={key}
    layout="position"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1, transition: { delay: 0.16, duration: 0.15 } }}
    exit={{ opacity: 0, transition: { duration: 0.08 } }}
    transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
    className={`col-span-full px-1 pb-0.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500 ${className}`}
  >
    {children}
  </motion.div>
);

// Пустое состояние — тот же вид, что в билдере ("Шаблон пока пуст").
function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center text-center py-16 px-6">
      <div className="w-11 h-11 mb-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400">
        {icon}
      </div>
      <div className="text-sm font-medium text-zinc-200">{title}</div>
      <div className="mt-1 max-w-xs text-sm leading-relaxed text-zinc-500">{text}</div>
    </div>
  );
}

export default withAuth(HomePage);
