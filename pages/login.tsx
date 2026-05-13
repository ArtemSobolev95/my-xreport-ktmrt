'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import pb from '../lib/pocketbase';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

        const { token: queryToken } = router.query;

  // Автоматическое подтверждение email при переходе по ссылке из письма
  useEffect(() => {
    // Более надёжный способ получения токена
    let token = queryToken as string | undefined;

    if (!token && typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      token = urlParams.get('token') || undefined;
    }

    console.log('🔍 [Login] useEffect → isReady:', router.isReady, 'token:', token ? token.substring(0, 30) + '...' : 'undefined');

    if (!router.isReady || !token || typeof token !== 'string') {
      return;
    }

    const confirmEmail = async () => {
      try {
        console.log('🚀 Выполняем confirmVerification...');
        await pb.collection('users').confirmVerification(token);
        console.log('✅ Email успешно подтверждён');
        alert('✅ Email успешно подтверждён! Теперь вы можете войти в аккаунт.');
      } catch (err: any) {
        console.error('❌ Ошибка confirmVerification:', err);
        alert('Не удалось подтвердить email. Попробуйте войти вручную.');
      }
    };

    confirmEmail();
  }, [router.isReady, queryToken]);

  

    const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await pb.collection('users').authWithPassword(email, password);

      // ← НОВАЯ ПРОВЕРКА
      if (!pb.authStore.record?.verified) {
        pb.authStore.clear(); // выкидываем из сессии
        setError('Пожалуйста, подтвердите email по ссылке из письма перед входом.');
        return;
      }

      router.push('/'); // только если email подтверждён
    } catch (err: any) {
      setError(err?.message || 'Неверный email или пароль');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-white px-4">
      <div className="max-w-md w-full bg-zinc-900 p-8 rounded-3xl shadow-2xl">
        <h1 className="text-3xl font-bold text-center mb-8">Вход в аккаунт</h1>
        
        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-sm mb-2 text-zinc-400">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-5 py-4 focus:border-amber-400 outline-none text-white"
              required
            />
          </div>

          <div>
            <label className="block text-sm mb-2 text-zinc-400">Пароль (минимум 8 символов)</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-5 py-4 focus:border-amber-400 outline-none text-white"
              required
            />
          </div>

          {error && <p className="text-red-400 text-center text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-1 border-none hover:text-amber-400 font-semibold rounded-2xl transition-all disabled:opacity-50 cursor-pointer"
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>

        <p className="text-center mt-6 text-zinc-400">
          Нет аккаунта?{' '}
          <button 
            onClick={() => router.push('/register')} 
            className="text-white hover:underline hover:text-amber-400 font-medium transition-all cursor-pointer"
          >
            Зарегистрироваться
          </button>
        </p>
      </div>
    </div>
  );
}
