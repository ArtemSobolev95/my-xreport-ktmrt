'use client';
import pb from '../lib/pocketbase';
import { LogOut, User } from 'lucide-react';

export default function UserHeader() {
  const user = pb.authStore.record;

  const handleLogout = () => {
    pb.authStore.clear();
    window.location.href = '/login';
  };

  if (!user) return null;

  return (
    <div className="flex items-center justify-between w-full px-4 md:px-8 py-1 bg-zinc-900 border-b border-white/10">
      
      {/* Левая часть — можно добавить название проекта */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-amber-400/10 rounded-2xl flex items-center justify-center text-amber-400">
          <User size={25} />
        </div>
        <span className="font-semibold text-white tracking-tight text-sm hidden sm:block">
          Smart Reporting
        </span>
      </div>

      {/* Правая часть — пользователь */}
      <div className="flex items-center gap-4">
        
        {/* Email с автоматическим укорачиванием */}
        <div className="max-w-[160px] sm:max-w-[220px] md:max-w-[280px] truncate text-sm text-amber-400 font-medium">
          {user.email}
        </div>

        {/* Кнопка выхода */}
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white hover:text-red-400 rounded-3xl transition-all active:scale-95 cursor-pointer"
        >
          <LogOut size={18} />
          <span className="hidden sm:inline">Выйти</span>
        </button>
      </div>
    </div>
  );
}