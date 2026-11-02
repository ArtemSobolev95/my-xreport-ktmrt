// Единые параметры анимаций интерфейса (framer-motion).
//
// Правила:
// - всплывающие поверхности поверх страницы (карточка быстрых кнопок,
//   попап «Находки», варианты сокращения, панель «Проверка», списки) —
//   только прозрачность (FADE): проявляются и тают на своём месте;
// - раскрытие по высоте внутри потока (списки, строки, тело попапа) —
//   COLLAPSE;
// - модальные окна — прозрачность и лёгкий подъём с масштабом
//   (components/AnimatedModal.tsx): это отдельный слой поверх всего.
//
// В CSS (Tailwind) те же значения: duration-200 и
// ease-[cubic-bezier(0.22,1,0.36,1)]; смена цвета — transition-colors
// (150 мс, по умолчанию Tailwind). Исключение — сворачивание разделов
// страницы заполнения (ease-in-out, см. pages/filler.tsx): там движется
// содержимое выше точки взгляда, и резкий старт ease-out выглядел рывком.
//
// Настройку системы «Уменьшить движение» учитывает MotionConfig
// reducedMotion="user" в pages/_app.tsx (framer-motion) и правило
// prefers-reduced-motion в styles/globals.css (CSS-переходы).

export const EASE = [0.22, 1, 0.36, 1] as const;

export const DURATION = {
  /** Мелкие всплывающие элементы (выпадающий список у SelectPill). */
  fast: 0.15,
  /** Всё остальное: появление, исчезновение, высота. */
  base: 0.2,
} as const;

export const FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DURATION.base, ease: EASE },
} as const;

export const COLLAPSE = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: DURATION.base, ease: EASE },
} as const;
