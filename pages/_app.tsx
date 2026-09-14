import "@/styles/globals.css";
import { useEffect } from "react";
import type { AppProps } from "next/app";
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

  return (
    <DialogProvider>
      <Component {...pageProps} />
    </DialogProvider>
  );
}
