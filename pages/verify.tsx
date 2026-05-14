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
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // Самый надёжный способ получить токен
    let currentToken: string | null = null;

    // 1. Из router.query
    if (router.isReady && router.query.token) {
      currentToken = router.query.token as string;
    }

    // 2. Fallback — напрямую из URL (работает даже если Next.js "очистил" query)
    if (!currentToken && typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      currentToken = urlParams.get('token');
    }

    console.log('[Verify] Final token received:', currentToken ? currentToken.substring(0, 30) + '...' : 'undefined');

    if (currentToken) {
      setToken(currentToken);
    } else {
      setStatus('error');
      setErrorMessage('Токен не найден в URL');
    }
  }, [router.isReady, router.query]);

  // Основная логика подтверждения
  useEffect(() => {
    if (!token) return;

    const verifyEmail = async () => {
      try {
        console.log('[Verify] Starting verification with token:', token.substring(0, 30) + '...');
        await pb.collection('users').confirmVerification(token);
        setStatus('success');
        console.log('[Verify] Success!');
      } catch (err: any) {
        console.error('[Verify] Error:', err);
        setStatus('error');
        setErrorMessage(err?.message || 'Не удалось подтвердить email');
      }
    };

    verifyEmail();
  }, [token]);

  // UI
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