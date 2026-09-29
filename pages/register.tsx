'use client';
import { useState, useRef } from 'react';
import Link from 'next/link';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import pb from '../lib/pocketbase';
import AuthLayout, { AuthAlert, AuthButton, AuthField, AuthStatusIcon, authErrorMessage, type AuthMessage } from '../components/AuthLayout';

// Тестовый sitekey hCaptcha (всегда проходит без реального решения) —
// используется, если явно не задан свой через переменную окружения, чтобы
// локальная разработка не требовала настоящих ключей.
const HCAPTCHA_SITE_KEY =
  process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY || '10000000-ffff-ffff-ffff-000000000001';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [message, setMessage] = useState<AuthMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  // Адрес, на который ушло письмо, — после успешной регистрации карточка
  // переключается на "Проверьте почту" (раньше — системное окно и сразу
  // переход на страницу входа, где письмо легко было не заметить).
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const captchaRef = useRef<HCaptcha>(null);

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage(null);

    if (password.length < 8) {
      setMessage({ tone: 'error', text: 'Пароль должен быть не короче 8 символов.' });
      return;
    }
    if (password !== passwordConfirm) {
      setMessage({ tone: 'error', text: 'Пароли не совпадают.' });
      return;
    }
    if (!captchaToken) {
      setMessage({ tone: 'error', text: 'Подтвердите, что вы не робот.' });
      return;
    }

    setLoading(true);

    try {
      // h-captcha-response проверяется хуком на сервере (pb_hooks/main.pb.js),
      // полем коллекции он не является.
      await pb.collection('users').create({
        email,
        password,
        passwordConfirm,
        'h-captcha-response': captchaToken,
      });
      await pb.collection('users').requestVerification(email);
      setRegisteredEmail(email);
    } catch (err) {
      setMessage({ tone: 'error', text: authErrorMessage(err, 'register') });
      // Токен hCaptcha одноразовый — после неудачной попытки нужен новый.
      captchaRef.current?.resetCaptcha();
      setCaptchaToken('');
    } finally {
      setLoading(false);
    }
  };

  const resendVerification = async () => {
    if (!registeredEmail) return;
    try {
      await pb.collection('users').requestVerification(registeredEmail);
      setMessage({ tone: 'success', text: 'Письмо отправлено ещё раз.' });
    } catch (err) {
      setMessage({ tone: 'error', text: authErrorMessage(err, 'register') });
    }
  };

  if (registeredEmail) {
    return (
      <AuthLayout>
        <div className="text-center">
          <AuthStatusIcon tone="mail" />
          <h1 className="text-xl font-semibold tracking-tight">Проверьте почту</h1>
          <p className="mt-1 mb-6 text-sm text-zinc-400 leading-relaxed">
            Мы отправили ссылку для подтверждения на{' '}
            <span className="text-white">{registeredEmail}</span>. Перейдите по ней, затем войдите.
          </p>
        </div>
        <AuthAlert message={message} />
        <div className="space-y-2">
          <Link
            href="/login"
            className="w-full h-10 inline-flex items-center justify-center rounded-lg text-sm font-medium bg-amber-400 text-zinc-950 hover:bg-amber-300 transition-colors"
          >
            Перейти ко входу
          </Link>
          <AuthButton type="button" variant="secondary" onClick={resendVerification}>
            Отправить письмо ещё раз
          </AuthButton>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Регистрация"
      subtitle="Создайте новый аккаунт"
      footer={
        <>
          Уже есть аккаунт?{' '}
          <Link href="/login" className="font-medium text-white hover:text-amber-400 transition-colors">
            Войти
          </Link>
        </>
      }
    >
      <AuthAlert message={message} />

      <form onSubmit={handleRegister} className="space-y-4">
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
          hint="минимум 8 символов"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <AuthField
          label="Повторите пароль"
          type="password"
          autoComplete="new-password"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          required
        />

        {/* Место под виджет зарезервировано заранее (его высота — 78px):
            он подгружается с задержкой, и без этого карточка вытягивалась
            уже после отрисовки — кнопка "прыгала" вниз. */}
        <div className="flex justify-center min-h-[78px]">
          <HCaptcha
            ref={captchaRef}
            sitekey={HCAPTCHA_SITE_KEY}
            onVerify={(token) => setCaptchaToken(token)}
            onExpire={() => setCaptchaToken('')}
            theme="dark"
            languageOverride="ru"
          />
        </div>

        <AuthButton type="submit" loading={loading} disabled={!captchaToken}>
          {loading ? 'Регистрация…' : 'Зарегистрироваться'}
        </AuthButton>
      </form>
    </AuthLayout>
  );
}
