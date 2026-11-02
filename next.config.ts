import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Dev-сервер открывается с телефона по IP компьютера в локальной сети
  // (npm run dev:lan). Без этого Next 16 блокирует запросы к /_next/* с
  // «чужого» адреса — страница грузится, но без JS. Только для next dev.
  // Значок «N» dev-режима в левом нижнем углу на телефоне ложится поверх
  // первой кнопки нижнего дока и перехватывает нажатия. Ошибки сборки и
  // выполнения оверлей Next показывает и без него.
  devIndicators: false,
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.16.*.*', '*.local'],
  
  // ←←← ЭТО САМОЕ ВАЖНОЕ ДЛЯ СТАТИЧЕСКОГО ЭКСПОРТА
  output: 'export',           // создаёт папку out/ с готовым сайтом
  trailingSlash: true,        // рекомендуется для PocketBase
  images: {
    unoptimized: true,        // обязательно, если используешь next/image
  },
};

export default nextConfig;
