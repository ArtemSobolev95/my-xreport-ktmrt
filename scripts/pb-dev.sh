#!/bin/sh
# Локальный PocketBase для разработки — с теми же миграциями и хуками, что
# на проде (см. Dockerfile), чтобы локально работали ИИ-подсказки и проверка.
#
# Ключи и настройки — в .env.pb.local в корне проекта (в git не попадает:
# .env* в .gitignore), например:
#   YANDEX_API_KEY=...
#   YANDEX_FOLDER_ID=...
#   YANDEX_GPT_MODEL_CORRECT=yandexgpt/latest
# или для Claude (см. pb_hooks/anthropic.js):
#   AI_PROVIDER=anthropic
#   ANTHROPIC_API_KEY=...
#
# PB_DIR — каталог данных (по умолчанию pocketbase_0/pb_data).
cd "$(dirname "$0")/.." || exit 1
if [ -f .env.pb.local ]; then
  set -a
  . ./.env.pb.local
  set +a
fi
exec ./pocketbase_0/pocketbase serve \
  --http=127.0.0.1:8090 \
  --dir="${PB_DIR:-pocketbase_0/pb_data}" \
  --migrationsDir=pb_migrations \
  --hooksDir=pb_hooks
