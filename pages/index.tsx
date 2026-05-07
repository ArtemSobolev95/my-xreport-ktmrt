'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import pb from '../lib/pocketbase';
import Link from 'next/link';
import { StarIcon } from '@heroicons/react/24/outline';
import { StarIcon as StarSolidIcon } from '@heroicons/react/24/solid';
import { motion, AnimatePresence } from 'framer-motion';

export default function HomePage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const loadTemplates = async () => {
  setLoading(true);
  try {
    console.log("🔄 Загружаем шаблоны из PocketBase...");

    const records = await pb.collection('templates').getFullList();   // ← без sort

    console.log("✅ Успешно загружено шаблонов:", records.length);
    console.log("📋 Шаблоны:", records);

    setTemplates(records || []);
  } catch (err: any) {
    console.error("❌ Ошибка загрузки шаблонов:", err);
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

  // Оптимистичное обновление
  setTemplates(prev => {
    const updated = prev.map(t =>
      t.id === id ? { ...t, is_favorite: newFavorite } : t
    );

    return updated.sort((a, b) => {
      if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
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

  if (loading) return (
    <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center text-2xl">
      Загрузка шаблонов...
    </div>
  );

    return (
    <div className="min-h-screen bg-zinc-950 text-white p-8">
      <div className="max-w-6xl mx-auto">

        {/* Поиск + кнопка создания */}
        <div className="flex items-center justify-between mb-10">
          <div className="relative w-96">
            <input
              type="text"
              placeholder="Поиск"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-60 bg-zinc-900/75 backdrop-blur-2xl border border-white/10 focus:border-amber-400 rounded-3xl px-6 py-4 text-white placeholder:text-zinc-400 outline-none transition-all"
            />
          </div>

          <Link
            href="/builder"
            className="flex items-center gap-3 bg-transparent border-none hover:text-amber-400 backdrop-blur-2xl px-4 py-4 transition-all tooltip tooltip-top" data-tip="Создать новый шаблон"
          >
          
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </Link>
        </div>

                                {filteredTemplates.length === 0 ? (
          <div className="text-center py-20 text-zinc-400 text-xl">
            {searchTerm ? 'Ничего не найдено' : 'Пока нет ни одного шаблона'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredTemplates.map((t) => (
              <div
                key={t.id}
                className="group flex flex-col bg-zinc-900/75 backdrop-blur-2xl border border-white/10 hover:border-white/30 rounded-3xl p-4 shadow-2xl transition-all hover:shadow-[0_0_0_4px_rgba(245,158,11,0.4)] h-full relative"
              >
                {/* Избранное */}
                <button
                  onClick={() => toggleFavorite(t.id, !!t.is_favorite)}
                  className="absolute top-5 right-5 text-zinc-400 hover:text-amber-400 transition-colors z-10 cursor-pointer"
                >
                  {t.is_favorite ? (
                    <StarSolidIcon className="w-5 h-5 text-amber-400" />
                  ) : (
                    <StarIcon className="w-5 h-5" />
                  )}
                </button>

                <h2 className="text-xl font-semibold mb-6 line-clamp-2 pr-10 text-white">
                  {t.title}
                </h2>

              

                {/* Кнопки действий */}
                <div className="mt-auto flex gap-3 justify-center">
                  <Link
                    href={`/builder?edit=${t.id}`}
                    className="py-4 justify-center gap-2 bg-transparent hover:text-amber-400 border-none transition-all text-white cursor-pointer"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                    </svg>
                  </Link>

                  <Link
                    href={`/filler?id=${t.id}`}
                    className="justify-center gap-2 bg-transparent hover:text-amber-400 border-none py-4 transition-all text-white cursor-pointer"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                    </svg>
                  </Link>

                  <button
                    onClick={() => deleteTemplate(t.id, t.title)}
                    className="justify-center w-12 h-12 bg-transparent hover:text-red-400 border-none transition-all text-white cursor-pointer"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
