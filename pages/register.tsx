'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/router';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import pb from '../lib/pocketbase';

// Тестовый sitekey hCaptcha (всегда проходит без реального решения) —
// используется, если явно не задан свой через переменную окружения, чтобы
// локальная разработка не требовала настоящих ключей.
const HCAPTCHA_SITE_KEY =
  process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY || '10000000-ffff-ffff-ffff-000000000001';

export default function Register() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const captchaRef = useRef<HCaptcha>(null);

    const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    if (password !== passwordConfirm) {
      setError('Пароли не совпадают');
      return;
    }

    if (!captchaToken) {
      setError('Подтвердите, что вы не робот');
      return;
    }

    setLoading(true);

    try {
      // 1. Создаём пользователя (h-captcha-response проверяется хуком на
      // сервере в pb_hooks/main.pb.js — сам по себе полем коллекции не является)
      await pb.collection('users').create({
        email,
        password,
        passwordConfirm,
        'h-captcha-response': captchaToken,
      });

      // 2. Отправляем письмо для подтверждения
      await pb.collection('users').requestVerification(email);

      alert('Регистрация прошла успешно!\n\nНа вашу почту отправлено письмо с ссылкой для подтверждения.\n\nПосле подтверждения вы сможете войти.');

      router.push('/login'); // сразу отправляем на страницу входа

    } catch (err: any) {
      setError(err?.message || 'Ошибка регистрации. Возможно, такой email уже используется.');
      // Токен hCaptcha одноразовый — после неудачной попытки нужен новый
      captchaRef.current?.resetCaptcha();
      setCaptchaToken('');
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

          <div className="flex justify-center">
            <HCaptcha
              ref={captchaRef}
              sitekey={HCAPTCHA_SITE_KEY}
              onVerify={(token) => setCaptchaToken(token)}
              onExpire={() => setCaptchaToken('')}
              theme="dark"
            />
          </div>

          {error && <p className="text-red-400 text-center text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading || !captchaToken}
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