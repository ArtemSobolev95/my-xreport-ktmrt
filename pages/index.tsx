'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import pb from '../lib/pocketbase';
import Link from 'next/link';
import { StarIcon } from '@heroicons/react/24/outline';
import { StarIcon as StarSolidIcon } from '@heroicons/react/24/solid';
import withAuth from '../components/withAuth';
import UserHeader from '../components/UserHeader';
import { PlusIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

function HomePage() {
  const router = useRouter();
  const user = pb.authStore.record;
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

          const loadTemplates = async () => {
    setLoading(true);
    try {
      

      const records = await pb.collection('templates').getFullList({});

      

      // Фильтруем на клиенте — только свои + публичные
      const myTemplates = records.filter((t: any) => {
        const isMyTemplate = t.user === pb.authStore.record?.id;
        const isPublicTemplate = t.isPublic === true;
        return isMyTemplate || isPublicTemplate;
      });

      

      setTemplates(
  [...myTemplates].sort((a, b) => {
    if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
    return new Date(b.created).getTime() - new Date(a.created).getTime();
  })
);
    } catch (err: any) {
      
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const toggleFavorite = async (id: string, currentFavorite: boolean) => {
  const newFavorite = !currentFavorite;

  // Оптимистичное обновление + плавная сортировка
  setTemplates(prev => {
    const updated = prev.map(t =>
      t.id === id ? { ...t, is_favorite: newFavorite } : t
    );

    return [...updated].sort((a, b) => {
      // 1. Избранные всегда сверху
      if (a.is_favorite !== b.is_favorite) {
        return a.is_favorite ? -1 : 1;
      }
      // 2. Внутри группы — новые сначала (по дате создания)
      return new Date(b.created).getTime() - new Date(a.created).getTime();
    });
  });

  try {
    await pb.collection('templates').update(id, { is_favorite: newFavorite });
  } catch (err) {
    console.error('Ошибка обновления избранного:', err);
    loadTemplates(); // откат
  }
};

  const deleteTemplate = async (id: string, title: string) => {
  if (!confirm(`Удалить шаблон "${title}"?`)) return;

  try {
    await pb.collection('templates').delete(id);
    loadTemplates();
  } catch (err: any) {
    alert('Ошибка при удалении: ' + (err?.message || err));
  }
};


    const filteredTemplates = templates.filter(t =>
    t.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

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



      // При изменении поиска или списка — всегда выбираем первый
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchTerm, filteredTemplates.length]);

    // Прокрутка выбранного шаблона в видимую область
  useEffect(() => {
    const el = document.querySelector(`[data-template-index="${selectedIndex}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

    if (loading) return (
    <div className="min-h-screen bg-zinc-950 text-white p-8 flex items-center justify-center">
      <div className="text-2xl">Проверка доступа...</div>
    </div>
  );


                return (
      <div className="min-h-screen bg-zinc-950 text-white">

        
        <div className="sticky top-0 z-50 bg-zinc-900/90 backdrop-blur-xl border-b border-white/10">
          <UserHeader />
        </div>

        
        <div className="max-w-6xl mx-auto pt-8 px-4 pb-32">

          
          <div className="flex items-center gap-4 mb-8">
            <div className="relative w-96">
              <input
                type="text"
                placeholder="Поиск"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-14 bg-zinc-900/75 border border-white/10 focus:border-amber-400 rounded-3xl px-6 text-white placeholder:text-zinc-400 outline-none transition-all"
              />
            </div>

            <Link
              href="/builder"
              className="flex items-center gap-2 h-4 px-0 bg-transparent hover:text-amber-400 text-white rounded-3xl font-medium transition-all group tooltip tooltip-top" data-tip="Добавить шаблон"
            >
              <PlusIcon className="w-5 h-5 text-white group-hover:text-amber-400 transition-colors" />
            </Link>
          </div>

          {/* === ВСЁ ОСТАЛЬНОЕ ОСТАЁТСЯ БЕЗ ИЗМЕНЕНИЙ === */}
          {filteredTemplates.length === 0 ? (
  <div className="text-center py-20 text-zinc-400 text-xl">
    {searchTerm ? 'Ничего не найдено' : 'Пока нет ни одного шаблона'}
  </div>
) : (
  <AnimatePresence>
    <div className="flex flex-col gap-3">
            {filteredTemplates.map((t, idx) => (
        <motion.div
          key={t.id}
          layout
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{
            duration: 0.25,
            ease: [0.4, 0, 0.2, 1],
            layout: { duration: 0.18, ease: [0.4, 0, 0.2, 1] }
          }}
          whileHover={{
            y: -4,
            scale: 1.015,
            transition: { duration: 0.15, ease: 'easeOut' }
          }}
          onDoubleClick={() => router.push(`/filler?id=${t.id}`)}
                    data-template-index={idx}
          className={`group bg-zinc-900/60 backdrop-blur-3xl border rounded-3xl p-3 shadow-xl flex items-center gap-4 cursor-pointer ${
            idx === selectedIndex
              ? 'border-amber-400 shadow-[0_0_0_3px_rgba(245,158,11,0.25)]'
              : 'border-white/5 hover:border-amber-400/30'
          }`}
        >
          {/* Звёздочка */}
          <motion.button
                onClick={() => toggleFavorite(t.id, !!t.is_favorite)}
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: 1.4, rotate: 25 }}
                transition={{ type: "spring", stiffness: 400, damping: 17 }}
                className="shrink-0 text-zinc-400 hover:text-amber-400 cursor-pointer tooltip tooltip-top"
                data-tip="Добавить в избранное">

            {t.is_favorite ? (
              <StarSolidIcon className="w-5 h-5 text-amber-400" />
            ) : (
              <StarIcon className="w-4 h-4" />
            )}
          </motion.button>

          {/* Название */}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold line-clamp-2 text-white">
              {t.title}
            </h2>
          </div>

          {/* Кнопки действий */}
          <div className="flex items-center gap-1 shrink-0">
            <Link
              href={`/builder?edit=${t.id}`}
              className="p-3 text-white hover:text-amber-400 transition-all cursor-pointer tooltip tooltip-top"
              data-tip="Редактировать"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
              </svg>
            </Link>

            <Link
              href={`/filler?id=${t.id}`}
              className="p-3 text-white hover:text-amber-400 transition-all cursor-pointer tooltip tooltip-top"
              data-tip="Заполнить"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </Link>

            <button
              onClick={() => deleteTemplate(t.id, t.title)}
              className="p-3 text-white hover:text-red-400 transition-all cursor-pointer tooltip tooltip-top"
              data-tip="Удалить"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            </button>
          </div>
        </motion.div>
      ))}
    </div>
  </AnimatePresence>
)}
        </div>
      </div>
    );
}
export default withAuth(HomePage);
