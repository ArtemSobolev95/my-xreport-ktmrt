'use client';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// Обёртка, плавно следующая за высотой содержимого: textarea в filler
// получает новую высоту сразу (autoResize), а карточка поля растёт к ней
// CSS-переходом, постепенно открывая новую строку. Анимировать саму
// textarea нельзя: пока её высота догоняет текст, браузер прокручивает
// содержимое к курсору, и первая строка на мгновение уезжает вверх.
//
// Тот же подход, что у карточки готового протокола: ResizeObserver ловит
// любое изменение содержимого, высота задаётся явно в px (из 'auto'
// CSS-переход не анимирует). Обрезка — clip-path, не overflow:hidden: с
// overflow:hidden у предка Chrome при наборе мог ставить символы задом
// наперёд (см. components/CollapseRow.tsx).
export default function SmoothHeight({ children, className = '' }: { children: ReactNode; className?: string }) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      const next = content.offsetHeight;
      setHeight(prev => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={`motion-safe:transition-[height] motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] ${className}`}
      style={height === null ? undefined : { height, clipPath: 'inset(0px -100vw)' }}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  );
}
