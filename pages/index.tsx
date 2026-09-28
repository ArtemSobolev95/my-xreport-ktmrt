'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import pb from '../lib/pocketbase';
import Link from 'next/link';
import withAuth from '../components/withAuth';
import UserHeader from '../components/UserHeader';
import { ArrowRight, Copy, FileText, Globe, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TemplateListItem } from '../types/builder';
import { useDialog } from '../components/DialogProvider';

function HomePage() {
  const router = useRouter();
  const dialog = useDialog();
  const currentUserId = pb.authStore.record?.id;
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Порядок, в котором шаблоны пришли с сервера, — запасной ключ сортировки.
  // Поля created у коллекции может не быть (в PocketBase ≥0.23 автодаты
  // больше не добавляются сами — так и в локальной базе): тогда сравнение
  // дат давало NaN, и порядок получался случайным.
  const serverOrderRef = useRef(new Map<string, number>());

  const isMine = (t: TemplateListItem) => t.user === currentUserId;

  // Сверху — публичные шаблоны других авторов, ниже — свои (в том числе
  // свои публичные: они остаются в "Мои", с меткой). Внутри группы — новые
  // сначала, а без дат — в исходном порядке сервера.
  const sortTemplates = (list: TemplateListItem[]) =>
    [...list].sort((a, b) => {
      if (isMine(a) !== isMine(b)) return isMine(a) ? 1 : -1;
      const byDate = new Date(b.created).getTime() - new Date(a.created).getTime();
      if (byDate) return byDate;
      return (serverOrderRef.current.get(a.id) ?? 0) - (serverOrderRef.current.get(b.id) ?? 0);
    });

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


  const matchesSearch = (t: TemplateListItem) =>
    t.title.toLowerCase().includes(searchTerm.toLowerCase());
  const filteredTemplates = templates.filter(matchesSearch);

    // Глобальный поиск + навигация стрелками + Enter
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Если фокус уже в input / textarea / select — ничего не делаем
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        active?.isContentEditable
      ) {
        return;
      }

      // Игнорируем комбинации с Ctrl / Cmd / Alt
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Escape — очистить поиск
      if (e.key === 'Escape') {
        e.preventDefault();
        setSearchTerm('');
        return;
      }

      // Backspace — удалить последний символ
      if (e.key === 'Backspace') {
        e.preventDefault();
        setSearchTerm(prev => prev.slice(0, -1));
        return;
      }

      // Стрелка вниз
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev =>
          Math.min(prev + 1, Math.max(filteredTemplates.length - 1, 0))
        );
        return;
      }

      // Стрелка вверх
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        return;
      }

      // Enter — открыть выбранный шаблон в режиме заполнения
      if (e.key === 'Enter') {
        e.preventDefault();
        const selected = filteredTemplates[selectedIndex];
        if (selected) {
          router.push(`/filler?id=${selected.id}`);
        }
        return;
      }

      // Печатный символ (буквы, цифры, пробел, кириллица и т.д.)
      if (e.key.length === 1) {
        e.preventDefault();
        setSearchTerm(prev => prev + e.key);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredTemplates, selectedIndex, router]);



      // Новый поиск — выбираем первый результат
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchTerm]);

  // Список укоротился (удаление) — выделение остаётся на той же позиции,
  // а не прыгает в начало; только не выходит за конец списка.
  useEffect(() => {
    setSelectedIndex(prev => Math.min(prev, Math.max(filteredTemplates.length - 1, 0)));
  }, [filteredTemplates.length]);

    // Прокрутка выбранного шаблона в видимую область
  useEffect(() => {
    const el = document.querySelector(`[data-template-index="${selectedIndex}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

    if (loading) return (
  <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
    <div className="w-10 h-10 rounded-full border-4 border-white/15 border-t-amber-400 animate-spin" />
  </div>
);

  // Подписи групп — только когда в выдаче есть чужие публичные шаблоны:
  // если все шаблоны свои, подпись "Мои шаблоны" ничего не добавляет. А вот
  // у пользователя без своих шаблонов подпись "Публичные" нужна — иначе
  // чужой шаблон ничем не отличался бы от своего.
  const publicCount = filteredTemplates.filter(t => !isMine(t)).length;
  const showGroupLabels = publicCount > 0;

                return (
      <div className="min-h-screen bg-zinc-950 text-white select-none selection:bg-amber-400/30 selection:text-white">


        <div className="sticky top-0 z-50 bg-zinc-900/90 backdrop-blur-xl border-b border-white/10">
          <UserHeader />
        </div>


        <div className="max-w-4xl mx-auto pt-8 px-4 pb-32">

          {/* Поиск работает набором текста с любого места страницы (см.
              глобальный keydown выше), поэтому это не настоящий input, а
              его вид — чтобы о поиске вообще можно было догадаться. */}
          <div className="flex items-center gap-3 mb-6">
            <div className={`flex-1 min-w-0 h-9 px-3 flex items-center gap-2 rounded-xl bg-zinc-900/75 border transition-colors ${
              searchTerm ? 'border-white/20' : 'border-white/10'
            }`}>
              <Search className="w-4 h-4 shrink-0 text-zinc-500" strokeWidth={1.75} />
              {searchTerm ? (
                <span className="min-w-0 truncate text-sm text-white">
                  {searchTerm}
                  <span className="inline-block w-[2px] h-4 bg-amber-400 ml-0.5 animate-pulse align-middle" />
                </span>
              ) : (
                <span className="truncate text-sm text-zinc-500">Начните печатать, чтобы найти шаблон</span>
              )}
              {searchTerm && (
                <kbd className="ml-auto shrink-0 h-5 px-1.5 inline-flex items-center rounded-md bg-white/5 border border-white/10 text-[10px] font-medium text-zinc-400">
                  Esc
                </kbd>
              )}
            </div>

            {/* Та же первичная кнопка, что "Сохранить" в билдере — единственный
                янтарный акцент страницы. */}
            <Link
              href="/builder"
              tabIndex={-1}
              className="h-9 px-3.5 shrink-0 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium bg-amber-400 text-zinc-950 hover:bg-amber-300 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" strokeWidth={2} />
              Новый шаблон
            </Link>
          </div>

          {/* Список (и его AnimatePresence) в разметке всегда, а пустое
              состояние — отдельно под ним, а не вместо него: иначе при
              переходе к пустой выдаче AnimatePresence размонтировался вместе
              с последней карточкой, и она пропадала без анимации. */}
            <div className="flex flex-col gap-2">
              {/* initial={false} — при загрузке список появляется сразу, без
                  каскада; анимируются только изменения (поиск, удаление,
                  появление/исчезновение подписей групп). popLayout —
                  уходящая карточка сразу вынимается из потока, и соседи
                  сдвигаются одновременно с её исчезновением, а не после. */}
              <AnimatePresence initial={false} mode="popLayout">
                {filteredTemplates.flatMap((t, idx) => {
                  const isSelected = idx === selectedIndex;
                  const actionColor = isSelected
                    ? 'text-zinc-300'
                    : 'text-zinc-500 group-hover:text-zinc-300';

                  const nodes = [];
                  if (showGroupLabels && idx === 0) {
                    nodes.push(groupLabel('label-public', 'Публичные'));
                  }
                  if (showGroupLabels && idx === publicCount) {
                    nodes.push(groupLabel('label-mine', 'Мои шаблоны', 'mt-3'));
                  }
                  const mine = isMine(t);

                  nodes.push(
                    <motion.div
                      key={t.id}
                      layout="position"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                      onClick={() => setSelectedIndex(idx)}
                      onDoubleClick={() => router.push(`/filler?id=${t.id}`)}
                      data-template-index={idx}
                      // Янтарь = "здесь фокус" и всегда только на одной
                      // карточке; hover намеренно нейтральный. Только внешнее
                      // кольцо-тень, без янтарной рамки: вместе они читались
                      // как двойная рамка. Рамка прозрачная, а не убрана
                      // совсем, — иначе карточка при выделении сдвигала бы
                      // содержимое на 1px.
                      className={`group flex items-center gap-2 pl-4 pr-2 py-2 rounded-2xl border cursor-pointer transition-[border-color,background-color,box-shadow] duration-150 ${
                        isSelected
                          ? 'bg-zinc-900 border-transparent shadow-[0_0_0_4px_rgba(245,158,11,0.3)]'
                          : 'bg-zinc-900/75 border-white/10 hover:bg-zinc-900 hover:border-white/20'
                      }`}
                    >
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <h2 className="min-w-0 truncate text-sm font-medium text-white">
                          {t.title}
                        </h2>
                        {/* Метка — только у своих: в группе "Публичные"
                            она ничего бы не добавила. */}
                        {mine && t.isPublic && (
                          <span className="shrink-0 h-5 px-1.5 inline-flex items-center gap-1 rounded-md bg-white/5 border border-white/10 text-[11px] font-medium text-zinc-400">
                            <Globe className="w-3 h-3" strokeWidth={1.75} />
                            Публичный
                          </span>
                        )}
                      </div>

                      {/* stopPropagation на двойной клик — иначе быстрый
                          двойной клик по "Удалить"/"Редактировать" всплывал
                          до карточки и открывал шаблон на заполнение. */}
                      <div className="flex items-center gap-0.5 shrink-0" onDoubleClick={(e) => e.stopPropagation()}>
                        <Link
                          href={`/filler?id=${t.id}`}
                          tabIndex={-1}
                          className={`${ICON_BUTTON_CLASS} ${actionColor} hover:!text-white hover:bg-white/5`}
                          data-tip="Заполнить"
                        >
                          <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
                        </Link>
                        {/* Чужой публичный шаблон открывается в билдере
                            в режиме копии (см. isOwner в TemplateBuilder) —
                            отсюда и подпись: изменить сам шаблон нельзя. */}
                        <Link
                          href={`/builder?edit=${t.id}`}
                          tabIndex={-1}
                          className={`${ICON_BUTTON_CLASS} ${actionColor} hover:!text-white hover:bg-white/5`}
                          data-tip={mine ? 'Редактировать' : 'Создать копию'}
                        >
                          {mine
                            ? <Pencil className="w-4 h-4" strokeWidth={1.75} />
                            : <Copy className="w-4 h-4" strokeWidth={1.75} />}
                        </Link>
                        {mine ? (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePublic(t);
                              }}
                              tabIndex={-1}
                              aria-pressed={!!t.isPublic}
                              className={`${ICON_BUTTON_CLASS} ${
                                t.isPublic ? 'text-amber-400' : actionColor
                              } hover:!text-amber-400 hover:bg-white/5`}
                              data-tip={t.isPublic ? 'Сделать личным' : 'Сделать публичным'}
                            >
                              <Globe className="w-4 h-4" strokeWidth={1.75} />
                            </button>
                            <div className="w-px h-4 bg-white/10 mx-1" aria-hidden="true" />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteTemplate(t.id, t.title);
                              }}
                              tabIndex={-1}
                              className={`${ICON_BUTTON_CLASS} ${actionColor} hover:!text-red-400 hover:bg-red-400/10`}
                              data-tip="Удалить"
                            >
                              <Trash2 className="w-4 h-4" strokeWidth={1.75} />
                            </button>
                          </>
                        ) : (
                          // Удалять и публиковать чужой шаблон нельзя. Пустое
                          // место той же ширины — чтобы "Заполнить" и
                          // "Копия" стояли в одном столбце с кнопками своих
                          // шаблонов.
                          <div className="w-[77px] shrink-0" aria-hidden="true" />
                        )}
                      </div>
                    </motion.div>
                  );
                  return nodes;
                })}
              </AnimatePresence>
            </div>

          {filteredTemplates.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.2 }}
            >
              <EmptyState
                icon={searchTerm ? <Search className="w-5 h-5" strokeWidth={1.75} /> : <FileText className="w-5 h-5" strokeWidth={1.75} />}
                title={searchTerm ? 'Ничего не найдено' : 'Пока нет ни одного шаблона'}
                text={searchTerm
                  ? `Нет шаблонов, содержащих «${searchTerm}». Esc — очистить поиск.`
                  : 'Создайте первый шаблон — кнопка «Новый шаблон» справа вверху.'}
              />
            </motion.div>
          )}
        </div>
      </div>
    );
}

// Иконки 16px в квадратах 32px — как в панели действий страницы заполнения
// (TOOLBAR_BUTTON_CLASS там, только компактнее для строки списка).
const ICON_BUTTON_CLASS = 'tooltip tooltip-top w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-lg transition-colors cursor-pointer focus:outline-none';

// Подпись группы — в стиле "Добавить поле" в левой панели билдера.
// motion + layout — чтобы подпись "Мои шаблоны" плавно сдвигалась вместе с
// карточками при поиске и удалении. Обычная
// функция, а не компонент: AnimatePresence mode="popLayout" передаёт ref
// своим детям, и функциональный компонент без forwardRef его бы потерял.
const groupLabel = (key: string, children: React.ReactNode, className = '') => (
  <motion.div
    key={key}
    layout="position"
    // Новая подпись сразу занимает своё конечное место, а карточки ещё
    // едут к своим — без задержки она проявлялась бы поверх проезжающей
    // карточки. Поэтому появляется, когда сдвиг почти закончен, а исчезает
    // быстро (popLayout вынимает её из потока, и на её место тут же едут
    // карточки).
    initial={{ opacity: 0 }}
    animate={{ opacity: 1, transition: { delay: 0.16, duration: 0.15 } }}
    exit={{ opacity: 0, transition: { duration: 0.08 } }}
    transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
    className={`px-2 pb-0.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500 ${className}`}
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
