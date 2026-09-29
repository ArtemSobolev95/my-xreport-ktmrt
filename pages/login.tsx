'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import pb from '../lib/pocketbase';
import AuthLayout, { AuthAlert, AuthButton, AuthField, authErrorMessage, type AuthMessage } from '../components/AuthLayout';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<AuthMessage | null>(null);
  const [loading, setLoading] = useState(false);

  const { token: queryToken } = router.query;

  // Подтверждение email по ссылке из письма с ?token=... — вторая точка
  // входа наряду с pages/verify.tsx (там #token=...); обе вызывают
  // confirmVerification, держать их поведение одинаковым. Результат —
  // сообщением в карточке, а не системным окном.
  useEffect(() => {
    let token = queryToken as string | undefined;
    if (!token && typeof window !== 'undefined') {
      token = new URLSearchParams(window.location.search).get('token') || undefined;
    }
    if (!router.isReady || !token || typeof token !== 'string') return;

    const confirmEmail = async () => {
      try {
        await pb.collection('users').confirmVerification(token);
        setMessage({ tone: 'success', text: 'Email подтверждён. Теперь можно войти.' });
      } catch (err) {
        setMessage({ tone: 'error', text: authErrorMessage(err, 'verify') });
      }
    };
    confirmEmail();
  }, [router.isReady, queryToken]);

  const resendVerification = async () => {
    try {
      await pb.collection('users').requestVerification(email);
      setMessage({ tone: 'success', text: `Письмо отправлено на ${email}. Перейдите по ссылке из него, затем войдите.` });
    } catch (err) {
      setMessage({ tone: 'error', text: authErrorMessage(err, 'login') });
    }
  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    try {
      await pb.collection('users').authWithPassword(email, password);

      // Без подтверждённого email не пускаем: выкидываем из сессии и
      // предлагаем отправить письмо ещё раз (раньше — только текст, и если
      // письмо потерялось, выхода не было).
      if (!pb.authStore.record?.verified) {
        pb.authStore.clear();
        setMessage({
          tone: 'error',
          text: 'Email ещё не подтверждён. Перейдите по ссылке из письма, которое пришло после регистрации.',
          action: { label: 'Отправить письмо ещё раз', onClick: resendVerification },
        });
        return;
      }

      router.push('/');
    } catch (err) {
      setMessage({ tone: 'error', text: authErrorMessage(err, 'login') });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Вход"
      subtitle="Войдите в свой аккаунт"
      footer={
        <>
          Нет аккаунта?{' '}
          <Link href="/register" className="font-medium text-white hover:text-amber-400 transition-colors">
            Зарегистрироваться
          </Link>
        </>
      }
    >
      <AuthAlert message={message} />

      <form onSubmit={handleLogin} className="space-y-4">
        <AuthField
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <AuthField
          label="Пароль"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <div className="pt-2">
          <AuthButton type="submit" loading={loading}>
            {loading ? 'Вход…' : 'Войти'}
          </AuthButton>
        </div>
      </form>
    </AuthLayout>
  );
}
