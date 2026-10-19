# Двухэтапная сборка. Фронтенд собирается в отдельном образе с Node.js, а в
# итоговый попадают только PocketBase, готовая статика (out/) и хуки с
# миграциями — ~40 МБ вместо ~500: node_modules, Node.js и кэш .next
# работающему приложению не нужны. Большой образ хранилище Amvera (harbor)
# не принимало — загрузка обрывалась на ~474 МБ («unexpected EOF»).

# === СБОРКА NEXT.JS ===
FROM node:22-alpine AS build
WORKDIR /app

# Сначала только манифесты: слой с зависимостями кэшируется, пока они не
# менялись.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .

# NEXT_PUBLIC_* переменные "запекаются" в статическую сборку на этом шаге —
# раньше адрес прод-бэкенда был зашит прямо в lib/pocketbase.ts как fallback,
# теперь он должен быть явно задан здесь.
# "/" — тот же origin, с которого открыта страница: фронтенд раздаёт сам
# PocketBase (pb_public), и SDK достраивает "/" до window.location.origin.
# Так один и тот же образ работает на любом домене (smartreporting.ru,
# *.amvera.io, резервный проект в другом регионе) и не ходит в чужую базу.
ENV NEXT_PUBLIC_POCKETBASE_URL=/

# Site key hCaptcha — публичный по дизайну (в отличие от secret key), поэтому
# безопасно хранить прямо в Dockerfile. Secret key задаётся ТОЛЬКО как
# переменная окружения на сервере (Amvera → Settings → Environment),
# в код/git его добавлять нельзя — его читает pb_hooks/main.pb.js.
ENV NEXT_PUBLIC_HCAPTCHA_SITE_KEY=e972cf20-0e1e-4a12-81d8-bcf6350a8494

RUN npm run build

# === ИТОГОВЫЙ ОБРАЗ: PocketBase + статика ===
FROM alpine:latest

# ca-certificates — для HTTPS-запросов хуков к ИИ (Claude / YandexGPT) и hCaptcha.
RUN apk add --no-cache ca-certificates

# Актуальная версия PocketBase (май 2026)
ARG PB_VERSION=0.37.5

# Скачиваем и распаковываем PocketBase (unzip нужен только на этом шаге)
ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pb.zip
RUN apk add --no-cache --virtual .unzip unzip && \
    unzip /tmp/pb.zip -d /pb/ && \
    rm /tmp/pb.zip && \
    chmod +x /pb/pocketbase && \
    apk del .unzip

# Собранный Next.js — в папку, которую PocketBase раздаёт как статику
COPY --from=build /app/out /pb/pb_public

# Копируем папки миграций и хуков
COPY pb_migrations /pb/pb_migrations/
COPY pb_hooks /pb/pb_hooks/

EXPOSE 8090

# --migrationsDir/--hooksDir заданы явно: без них PocketBase ищет
# pb_migrations/pb_hooks рядом с --dir (/data), а не рядом с бинарником
# (/pb) — из-за этого миграции (в т.ч. блокировка правил доступа) молча
# не выполнялись ни разу, без единой ошибки в логах. Проверено локально:
# с --dir, отличным от каталога бинарника, JS-миграции просто не находятся.
#
# Если заданы PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD, перед стартом создаём или
# обновляем этого суперпользователя: так доступ в /_/ восстанавливается
# сменой переменных и перезапуском, без доступа к shell контейнера.
# Миграция 0001 срабатывает только один раз, на пустой базе. Когда доступ
# не нужен, переменные лучше удалить.
CMD ["/bin/sh", "-c", "if [ -n \"$PB_ADMIN_EMAIL\" ] && [ -n \"$PB_ADMIN_PASSWORD\" ]; then /pb/pocketbase superuser upsert \"$PB_ADMIN_EMAIL\" \"$PB_ADMIN_PASSWORD\" --dir=/data; fi; exec /pb/pocketbase serve --http=0.0.0.0:8090 --dir=/data --migrationsDir=/pb/pb_migrations --hooksDir=/pb/pb_hooks"]
