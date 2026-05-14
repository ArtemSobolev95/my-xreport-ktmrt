'use client';
import { useState } from 'react';
import { useRouter } from 'next/router';
import pb from '../lib/pocketbase';

export default function Register() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

    const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (password !== passwordConfirm) {
      setError('Пароли не совпадают');
      setLoading(false);
      return;
    }

    try {
      // 1. Создаём пользователя
      await pb.collection('users').create({
        email,
        password,
        passwordConfirm,
      });

      // 2. Отправляем письмо для подтверждения
      await pb.collection('users').requestVerification(email);

      alert('Регистрация прошла успешно!\n\nНа вашу почту отправлено письмо с ссылкой для подтверждения.\n\nПосле подтверждения вы сможете войти.');

      router.push('/login'); // сразу отправляем на страницу входа

    } catch (err: any) {
      setError(err?.message || 'Ошибка регистрации. Возможно, такой email уже используется.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-white px-4">
      <div className="max-w-md w-full bg-zinc-900 p-8 rounded-3xl shadow-2xl">
        <h1 className="text-3xl font-bold text-center mb-8">Регистрация</h1>
        
        <form onSubmit={handleRegister} className="space-y-6">
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

          <div>
            <label className="block text-sm mb-2 text-zinc-400">Повторите пароль</label>
            <input
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-5 py-4 focus:border-amber-400 outline-none text-white"
              required
            />
          </div>

          {error && <p className="text-red-400 text-center text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-none hover:text-amber-400 font-semibold rounded-2xl transition-all disabled:opacity-50 cursor-pointer"
          >
            {loading ? 'Регистрация...' : 'Зарегистрироваться'}
          </button>
        </form>

        <p className="text-center mt-6 text-zinc-400">
          Уже есть аккаунт?{' '}
          <button 
            onClick={() => router.push('/login')} 
            className="text-white hover:underline hover:text-amber-400 font-medium transition-all cursor-pointer"
          >
            Войти
          </button>
        </p>
      </div>
    </div>
  );
}