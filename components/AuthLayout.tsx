'use client';
import { type InputHTMLAttributes, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { AnimatePresence } from 'framer-motion';
import { AlertCircle, CheckCircle2, Info, Loader2, MailCheck } from 'lucide-react';
import CollapseRow from './CollapseRow';
import { MODAL_INPUT_CLASS } from './AnimatedModal';

// Общий каркас страниц входа, регистрации и подтверждения почты — в том же
// стиле, что и остальное приложение: над карточкой — крупное название
// приложения текстом (без иконки), карточка как у модальных окон (zinc-900, border-white/10, rounded-3xl),
// поля и кнопки — те же MODAL_INPUT_CLASS и h-9/h-10 rounded-lg, что в
// модалках и билдере. Раньше у каждой из трёх страниц была своя вёрстка
// (крупные поля py-4 rounded-2xl, text-3xl заголовки), выбивавшаяся из
// интерфейса.
export default function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 text-center text-3xl font-bold tracking-tight text-white select-none">
        Smart Reporting
      </div>

      <div className="w-full max-w-sm bg-zinc-900 border border-white/10 shadow-2xl rounded-3xl px-6 py-7">
        {(title || subtitle) && (
          <div className="mb-6 text-center">
            {title && <h1 className="text-xl font-semibold tracking-tight">{title}</h1>}
            {subtitle && <p className="mt-1 text-sm text-zinc-400 leading-relaxed">{subtitle}</p>}
          </div>
        )}
        {children}
      </div>

      {footer && <div className="mt-5 text-sm text-zinc-500">{footer}</div>}
    </div>
  );
}

// Поле формы: подпись над полем — как в модалке "Добавить ссылку".
export function AuthField({
  label,
  hint,
  ...inputProps
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="block mb-1.5 text-sm text-zinc-400">
        {label}
        {hint && <span className="text-zinc-600"> · {hint}</span>}
      </span>
      <input {...inputProps} className={MODAL_INPUT_CLASS} />
    </label>
  );
}

// Главная кнопка формы — та же, что "Сохранить" в билдере, во всю ширину
// карточки; во время запроса — спиннер вместо иконки.
export function AuthButton({
  loading,
  children,
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: 'primary' | 'secondary' }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`w-full h-10 inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
        variant === 'primary'
          ? 'bg-amber-400 text-zinc-950 hover:bg-amber-300'
          : 'bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white'
      } ${className}`}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

// Сообщение формы (ошибка/успех/подсказка) — вместо голой красной строки
// текста и системных окон. Появляется и исчезает плавно (CollapseRow), не
// сдвигая форму скачком. action — необязательная кнопка-ссылка внутри
// сообщения (например, "Отправить письмо ещё раз").
export type AuthMessage = {
  tone: 'error' | 'success' | 'info';
  text: string;
  action?: { label: string; onClick: () => void };
};

const TONE_CLASS: Record<AuthMessage['tone'], string> = {
  error: 'bg-red-400/10 border-red-400/20 text-red-300',
  success: 'bg-emerald-400/10 border-emerald-400/20 text-emerald-300',
  info: 'bg-white/5 border-white/10 text-zinc-300',
};

export function AuthAlert({ message }: { message: AuthMessage | null }) {
  const Icon = message?.tone === 'error' ? AlertCircle : message?.tone === 'success' ? CheckCircle2 : Info;
  return (
    <AnimatePresence initial={false}>
      {message && (
        <CollapseRow key={message.tone + message.text}>
          {/* pb-4 внутри строки, а не mb у блока: margin у анимируемого по
              высоте элемента прыгал бы скачком в начале/конце анимации. */}
          <div className="pb-4">
            <div role={message.tone === 'error' ? 'alert' : 'status'} className={`flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-relaxed ${TONE_CLASS[message.tone]}`}>
              <Icon className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="min-w-0">
                {message.text}
                {message.action && (
                  <button
                    type="button"
                    onClick={message.action.onClick}
                    className="block mt-1 font-medium text-white hover:text-amber-400 transition-colors cursor-pointer"
                  >
                    {message.action.label}
                  </button>
                )}
              </div>
            </div>
          </div>
        </CollapseRow>
      )}
    </AnimatePresence>
  );
}

// Иконка состояния в плашке — как в пустых состояниях билдера (EmptyState).
export function AuthStatusIcon({ tone }: { tone: 'loading' | 'success' | 'error' | 'mail' }) {
  const toneClass = {
    loading: 'text-amber-400',
    success: 'text-emerald-400',
    error: 'text-red-400',
    mail: 'text-amber-400',
  }[tone];
  return (
    <div className={`w-11 h-11 mx-auto mb-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center ${toneClass}`}>
      {tone === 'loading' && <Loader2 className="w-5 h-5 animate-spin" />}
      {tone === 'success' && <CheckCircle2 className="w-5 h-5" />}
      {tone === 'error' && <AlertCircle className="w-5 h-5" />}
      {tone === 'mail' && <MailCheck className="w-5 h-5" />}
    </div>
  );
}

// Понятный текст ошибки PocketBase по-русски. Раньше на форму выводился
// err.message как есть — у PocketBase это английские служебные фразы
// ("Failed to authenticate.", "Failed to create record.").
type PbError = {
  status?: number;
  message?: string;
  response?: { message?: string; data?: Record<string, { code?: string; message?: string }> };
};

export function authErrorMessage(err: unknown, context: 'login' | 'register' | 'verify'): string {
  const e = (err ?? {}) as PbError;
  const data = e.response?.data || {};

  if (e.status === 0) return 'Нет связи с сервером. Проверьте подключение к интернету.';
  if (e.status === 429) return 'Слишком много попыток. Подождите минуту и попробуйте снова.';

  if (context === 'register') {
    if (data.email?.code === 'validation_not_unique') return 'Этот email уже зарегистрирован. Войдите или используйте другой адрес.';
    if (data.email?.code === 'validation_is_email' || data.email?.code === 'validation_invalid_email') return 'Проверьте email — адрес указан с ошибкой.';
    if (data.password?.code === 'validation_length_out_of_range' || data.password?.code === 'validation_min_text_constraint') return 'Пароль должен быть не короче 8 символов.';
    if (data.passwordConfirm) return 'Пароли не совпадают.';
  }

  if (context === 'login' && e.status === 400) return 'Неверный email или пароль.';
  if (context === 'verify') return 'Ссылка для подтверждения недействительна или устарела. Войдите — мы предложим отправить новое письмо.';

  // Сообщения наших хуков (например, проверки капчи) уже на русском —
  // показываем их как есть.
  const serverMessage = e.response?.message || e.message || '';
  if (/[а-яё]/i.test(serverMessage)) return serverMessage;

  return context === 'login'
    ? 'Не удалось войти. Попробуйте ещё раз.'
    : 'Не удалось зарегистрироваться. Попробуйте ещё раз.';
}
