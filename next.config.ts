import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  
  // ←←← ЭТО САМОЕ ВАЖНОЕ ДЛЯ СТАТИЧЕСКОГО ЭКСПОРТА
  output: 'export',           // создаёт папку out/ с готовым сайтом
  trailingSlash: true,        // рекомендуется для PocketBase
  images: {
    unoptimized: true,        // обязательно, если используешь next/image
  },
};

export default nextConfig;
