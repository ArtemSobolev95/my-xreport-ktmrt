FROM alpine:latest

# Версия PocketBase (проверяй свежую на https://github.com/pocketbase/pocketbase/releases)
ARG PB_VERSION=0.25.0

RUN apk add --no-cache unzip ca-certificates curl

# Скачиваем PocketBase
ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pb.zip
RUN unzip /tmp/pb.zip -d /pb/ && \
    rm /tmp/pb.zip && \
    chmod +x /pb/pocketbase

# === СБОРКА NEXT.JS ===
WORKDIR /app
COPY . .

# Устанавливаем ВСЕ зависимости (build требует devDependencies)
RUN npm ci

# Собираем статический сайт → папка out/
RUN npm run build

# Копируем собранный фронтенд в pb_public (PocketBase будет отдавать его как статику)
RUN mkdir -p /pb/pb_public && \
    cp -r out/* /pb/pb_public/ 2>/dev/null || true

# Копируем миграции и хуки PocketBase (если будут)
COPY pb_migrations /pb/pb_migrations/
COPY pb_hooks /pb/pb_hooks/

EXPOSE 8090

# Запускаем PocketBase
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/data"]
