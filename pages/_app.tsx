import "@/styles/globals.css";
import { useEffect } from "react";
import type { AppProps } from "next/app";
import Head from "next/head";
import { MotionConfig } from "framer-motion";
import DialogProvider from "../components/DialogProvider";

export default function App({ Component, pageProps }: AppProps) {
  // Отмечает html.js-focus-mouse при клике мышью и снимает её по Tab —
  // используется в globals.css, чтобы у input/textarea/select янтарное
  // кольцо фокуса показывалось только при навигации с клавиатуры (у этих
  // полей браузерный :focus-visible сам по себе срабатывает и на клик).
  useEffect(() => {
    const onMouseDown = () => {
      document.documentElement.classList.add("js-focus-mouse");
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        document.documentElement.classList.remove("js-focus-mouse");
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // Экранная клавиатура для мобильной раскладки (см. html.kb-open и
  // --vv-bottom в styles/globals.css).
  //
  // fixed-элементы позиционируются относительно layout viewport, а не той
  // части страницы, что видна над клавиатурой (visual viewport). На iOS
  // layout viewport при открытой клавиатуре не уменьшается — прижатая к
  // низу (bottom: 0) лента оказывалась под клавиатурой, у низа страницы.
  // Поэтому при открытой клавиатуре лента сдвигается (transform) к нижней
  // границе видимой области: --vv-bottom = offsetTop + height visualViewport
  // (в координатах layout viewport).
  //
  // Позиция обновляется прямо в обработчике события, не кадром позже.
  // Прокрутку страницы заполнения на мобильном ведёт внутренний контейнер
  // (pages/filler.tsx), так что видимая область при прокрутке не сдвигается
  // и ленту не приходится «догонять».
  //
  // Открыта ли клавиатура: фокус в поле ввода и видимая высота заметно
  // меньше обычной (baseline — наибольшая высота без фокуса в поле). Без
  // фокуса в поле не считается — уменьшить visualViewport может и щипок.
  //
  // ?kbdebug=1 в адресе — плашка с замерами (для отладки на телефоне).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let baseline = vv.height;
    let frame = 0;
    let wasOpen = false;
    let debugEl: HTMLDivElement | null = null;
    if (new URLSearchParams(window.location.search).has('kbdebug')) {
      debugEl = document.createElement('div');
      debugEl.style.cssText = 'position:fixed;top:0;right:0;z-index:99999;background:#b91c1c;color:#fff;font:11px/1.3 monospace;padding:4px 6px;white-space:pre;pointer-events:none;';
      document.body.appendChild(debugEl);
    }
    const isEditableFocused = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      if (el.isContentEditable) return true;
      if (el.tagName === 'TEXTAREA') return true;
      if (el.tagName !== 'INPUT') return false;
      const type = (el as HTMLInputElement).type;
      return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes(type);
    };
    const update = () => {
      const editing = isEditableFocused();
      if (!editing) baseline = Math.max(baseline, vv.height);
      const open = editing && baseline - vv.height > 120;
      root.style.setProperty('--vv-bottom', `${vv.offsetTop + vv.height}px`);
      root.style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
      if (open !== wasOpen) {
        root.classList.toggle('kb-open', open);
        wasOpen = open;
      }
      if (debugEl) {
        debugEl.textContent =
          `innerH ${window.innerHeight}  clientH ${root.clientHeight}\n` +
          `vv.h ${Math.round(vv.height)}  vv.top ${Math.round(vv.offsetTop)}  base ${Math.round(baseline)}\n` +
          `scrollY ${Math.round(window.scrollY)}  edit ${editing}  kb-open ${open}`;
      }
    };
    // При смене фокуса activeElement на время focusout — body: меряем после
    // того, как фокус встанет на новое место.
    const updateSoon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    // Поворот экрана меняет «обычную» высоту — меряем заново.
    const onOrientation = () => { baseline = 0; setTimeout(update, 300); };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('focusin', updateSoon);
    window.addEventListener('focusout', updateSoon);
    window.addEventListener('orientationchange', onOrientation);
    return () => {
      cancelAnimationFrame(frame);
      debugEl?.remove();
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('scroll', update);
      window.removeEventListener('focusin', updateSoon);
      window.removeEventListener('focusout', updateSoon);
      window.removeEventListener('orientationchange', onOrientation);
    };
  }, []);

  return (
    <DialogProvider>
      <Head>
        {/* initial-scale=1 — без него мобильные браузеры при малейшем
            переполнении по ширине отдаляли всю страницу. maximum-scale=1 —
            иначе iOS Safari приближает страницу при фокусе в поле со шрифтом
            мельче 16px (у нас text-sm) и не отдаляет обратно; ручное
            масштабирование щипком iOS при этом всё равно разрешает.
            viewport-fit=cover — для env(safe-area-inset-*) у нижнего дока.
            interactive-widget=resizes-content — на Android клавиатура
            уменьшает страницу, и нижний док с быстрыми кнопками остаётся над
            ней, а не под ней. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
        />
        <meta name="theme-color" content="#09090b" />
      </Head>
      {/* reducedMotion="user" — при включённой в системе настройке
          «Уменьшить движение» framer-motion не анимирует сдвиги и масштаб
          (модальные окна); прозрачность и высота остаются. */}
      <MotionConfig reducedMotion="user">
        <Component {...pageProps} />
      </MotionConfig>
    </DialogProvider>
  );
}
