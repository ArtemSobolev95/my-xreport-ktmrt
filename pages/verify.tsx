'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import pb from '../lib/pocketbase';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function VerifyPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const fullUrl = window.location.href;
    console.log('[Verify] Full URL:', fullUrl);

    const hash = window.location.hash;
    console.log('[Verify] Hash:', hash);

    // Извлекаем токен из #token=...
    let token = null;
    if (hash && hash.includes('token=')) {
      token = hash.split('token=')[1];
    }

    console.log('[Verify] Extracted token:', token ? token.substring(0, 50) + '...' : 'NOT FOUND');

    if (!token) {
      setStatus('error');
      setErrorMessage('Токен не найден');
      return;
    }

    // Запускаем подтверждение
    const verifyEmail = async () => {
      try {
        await pb.collection('users').confirmVerification(token);
        console.log('[Verify] SUCCESS!');
        setStatus('success');
      } catch (err: any) {
        console.error('[Verify] Error:', err);
        setStatus('error');
        setErrorMessage(err?.message || 'Не удалось подтвердить email');
      }
    };

    verifyEmail();
  }, []);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-zinc-900 border border-white/10 rounded-3xl p-10 text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto text-amber-400" />
          <h2 className="text-2xl font-semibold mt-6">Подтверждение email...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-zinc-900 border border-white/10 rounded-3xl p-10 text-center">
        {status === 'success' ? (
          <>
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
            <h2 className="text-3xl font-semibold mt-6">Email подтверждён!</h2>
            <p className="text-zinc-400 mt-3">Теперь вы можете войти в аккаунт.</p>
            <Link
              href="/login"
              className="mt-8 block w-full py-4 bg-amber-400 hover:bg-amber-500 text-black font-medium rounded-2xl transition-all"
            >
              Перейти ко входу
            </Link>
          </>
        ) : (
          <>
            <XCircle className="w-16 h-16 text-red-500 mx-auto" />
            <h2 className="text-3xl font-semibold mt-6 text-red-400">Что-то пошло не так</h2>
            <p className="text-zinc-400 mt-3">{errorMessage}</p>
            <Link
              href="/login"
              className="mt-8 block w-full py-4 bg-zinc-800 hover:bg-zinc-700 font-medium rounded-2xl transition-all"
            >
              Вернуться на страницу входа
            </Link>
          </>
        )}
      </div>
    </div>
  );
}