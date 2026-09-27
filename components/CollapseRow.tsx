'use client';
import { useContext, useState, type ReactNode } from 'react';
import { motion, PresenceContext, useIsPresent } from 'framer-motion';

// Строка, плавно раскрывающаяся по высоте при появлении и схлопывающаяся
// при удалении (варианты "Список", пояснения "Шкала", фразы быстрых
// кнопок) — вместо layout на контейнере: layout анимирует изменение
// размера через scale, и содержимое на время анимации растягивалось/
// сплющивалось. Здесь контейнер просто следует за реальной высотой строк.
// Пока строка анимируется, её режет clip-path, а не overflow-hidden: новая
// строка может получить фокус ещё при высоте 0, и если сразу печатать,
// Chrome не двигает курсор в поле внутри overflow:hidden-предка нулевой
// высоты — символы шли задом наперёд ("где" → "едг"; воспроизведено).
// clip-path держится только пока строка появляется или исчезает — в покое
// его нет, иначе он обрезал бы перетаскиваемый вариант "Списка",
// выезжающий за пределы своей строки. Управляется состоянием, а не
// transitionEnd/задержкой framer: те на практике оставляли clip висеть
// после окончания анимации. Строки, показанные сразу при монтировании
// списка (AnimatePresence initial={false} → presence.initial === false),
// не анимируются вовсе и clip не получают.
export default function CollapseRow({ children }: { children: ReactNode }) {
  const presence = useContext(PresenceContext);
  const isPresent = useIsPresent();
  const [entered, setEntered] = useState(presence?.initial === false);
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      onAnimationComplete={() => { if (isPresent) setEntered(true); }}
      style={entered && isPresent ? undefined : { clipPath: 'inset(0px)' }}
    >
      {children}
    </motion.div>
  );
}
