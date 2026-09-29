'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import pb from '../lib/pocketbase';
import AuthLayout, { AuthStatusIcon, authErrorMessage } from '../components/AuthLayout';

// Подтверждение email по ссылке из письма (#token=...). Вторая точка входа
// — pages/login.tsx (?token=...); обе вызывают confirmVerification, держать
// их поведение одинаковым.
export default function VerifyPage() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const hash = window.location.hash;
    const token = hash.includes('token=') ? hash.split('token=')[1] : null;

    const verifyEmail = async () => {
      if (!token) {
        setStatus('error');
        setErrorMessage('В ссылке нет кода подтверждения. Откройте ссылку из письма целиком.');
        return;
      }
      try {
        await pb.collection('users').confirmVerification(token);
        setStatus('success');
      } catch (err) {
        setStatus('error');
        setErrorMessage(authErrorMessage(err, 'verify'));
      }
    };
    verifyEmail();
  }, []);

  return (
    <AuthLayout>
      <div className="text-center">
        <AuthStatusIcon tone={status} />
        <h1 className="text-xl font-semibold tracking-tight">
          {status === 'loading' && 'Подтверждаем email…'}
          {status === 'success' && 'Email подтверждён'}
          {status === 'error' && 'Не удалось подтвердить email'}
        </h1>
        <p className="mt-1 text-sm text-zinc-400 leading-relaxed">
          {status === 'loading' && 'Это займёт пару секунд.'}
          {status === 'success' && 'Теперь можно войти в аккаунт.'}
          {status === 'error' && errorMessage}
        </p>
        {status !== 'loading' && (
          <Link
            href="/login"
            className={`mt-6 w-full h-10 inline-flex items-center justify-center rounded-lg text-sm font-medium transition-colors ${
              status === 'success'
                ? 'bg-amber-400 text-zinc-950 hover:bg-amber-300'
                : 'bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white'
            }`}
          >
            {status === 'success' ? 'Перейти ко входу' : 'Вернуться ко входу'}
          </Link>
        )}
      </div>
    </AuthLayout>
  );
}
