FROM alpine:latest

# Устанавливаем Node.js + npm + всё необходимое
RUN apk add --no-cache nodejs npm unzip ca-certificates curl

# Актуальная версия PocketBase (май 2026)
ARG PB_VERSION=0.37.5

# Скачиваем и распаковываем PocketBase
ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pb.zip
RUN unzip /tmp/pb.zip -d /pb/ && \
    rm /tmp/pb.zip && \
    chmod +x /pb/pocketbase

# === СБОРКА NEXT.JS ===
WORKDIR /app
COPY . .

# Устанавливаем зависимости и собираем фронтенд
RUN npm ci --include=dev
RUN npm run build

# Копируем собранный Next.js в папку, которую PocketBase будет раздавать как статику
RUN mkdir -p /pb/pb_public && \
    cp -r out/* /pb/pb_public/ 2>/dev/null || true

# Копируем папки миграций и хуков
COPY pb_migrations /pb/pb_migrations/
COPY pb_hooks /pb/pb_hooks/

EXPOSE 8090

CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/data", "--enable-wal", "--logLevel=error"]
