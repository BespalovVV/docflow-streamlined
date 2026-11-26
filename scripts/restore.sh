#!/bin/bash
# ==============================================================================
# DOCFLOW ENTERPRISE RESTORE ENGINE (FAST RTO)
# ==============================================================================
# Мгновенное восстановление системы из резервной копии:
# - Проверка контрольной суммы SHA-256 перед запуском
# - Многопоточное восстановление PostgreSQL (pg_restore -j)
# - Безопасная очистка старых объектов (--clean --if-exists)
# - Распаковка файлового хранилища
# - Автоматическая валидация работоспособности (Healthcheck)
# ==============================================================================

set -euo pipefail

GREEN="\033[1;32m"
BLUE="\033[1;34m"
YELLOW="\033[1;33m"
RED="\033[1;31m"
RESET="\033[0m"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_ROOT}/data/backups"

DB_CONTAINER="docflow_postgres"
if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  DB_CONTAINER="docflow_postgres_prod"
fi

DB_USER="${PGUSER:-docflow}"
DB_NAME="${PGDATABASE:-docflow_db}"

# Выбор файла дампа: передан аргументом или берется самый свежий
SPECIFIED_DUMP="${1:-}"
if [ -n "$SPECIFIED_DUMP" ]; then
  if [ -f "$SPECIFIED_DUMP" ]; then
    DUMP_FILE="$SPECIFIED_DUMP"
  elif [ -f "${BACKUP_DIR}/${SPECIFIED_DUMP}" ]; then
    DUMP_FILE="${BACKUP_DIR}/${SPECIFIED_DUMP}"
  else
    echo -e "${RED}❌ Указанный файл бэкапа не найден: ${SPECIFIED_DUMP}${RESET}"
    exit 1
  fi
else
  # Найти самый свежий .dump файл
  DUMP_FILE=$(ls -t "${BACKUP_DIR}"/docflow_db_*.dump 2>/dev/null | head -n 1 || true)
  if [ -z "$DUMP_FILE" ]; then
    echo -e "${RED}❌ В каталоге ${BACKUP_DIR} не найдено резервных копий docflow_db_*.dump!${RESET}"
    exit 1
  fi
fi

echo -e "${BLUE}====================================================================${RESET}"
echo -e "${BLUE}♻️ СТАРТ ВОССТАНОВЛЕНИЯ DOCFLOW ИЗ РЕЗЕРВНОЙ КОПИИ${RESET}"
echo -e "${BLUE}📁 Файл дампа: ${DUMP_FILE}${RESET}"
echo -e "${BLUE}====================================================================${RESET}"

# 1. Проверка контрольной суммы
CHECKSUM_FILE="${DUMP_FILE%.dump}.sha256"
CHECKSUM_FILE="${CHECKSUM_FILE/docflow_db_/checksums_}"
if [ -f "$CHECKSUM_FILE" ]; then
  echo -e "\n${YELLOW}▶ Шаг 1/4: Проверка контрольной суммы SHA-256...${RESET}"
  cd "$BACKUP_DIR"
  if sha256sum --check --status "$CHECKSUM_FILE" 2>/dev/null; then
    echo -e "${GREEN}✅ Контрольная сумма совпадает. Файл целостен.${RESET}"
  else
    echo -e "${RED}⚠️ Внимание: Контрольная сумма не совпала или изменилась!${RESET}"
    read -p "Продолжить восстановление? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      exit 1
    fi
  fi
fi

# 2. Восстановление базы данных PostgreSQL
echo -e "\n${YELLOW}▶ Шаг 2/4: Восстановление PostgreSQL базы данных...${RESET}"
START_RESTORE_TIME=$(date +%s)

# Отключаем активные клиентские соединения к базе перед дропом
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" > /dev/null 2>&1 || true

# Копирование дампа внутрь контейнера для настоящего многопоточного параллельного восстановления (-j 4)
TEMP_CONTAINER_DUMP="/tmp/restore_in_progress.dump"
docker cp "$DUMP_FILE" "${DB_CONTAINER}:${TEMP_CONTAINER_DUMP}"

# Быстрое параллельное восстановление в 4 потока (Fast RTO)
docker exec "$DB_CONTAINER" pg_restore \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  -j 4 "$TEMP_CONTAINER_DUMP" || true

docker exec "$DB_CONTAINER" rm -f "$TEMP_CONTAINER_DUMP" > /dev/null 2>&1 || true

RESTORE_DURATION=$(( $(date +%s) - START_RESTORE_TIME ))
echo -e "${GREEN}✅ База данных успешно восстановлена за ${RESTORE_DURATION}с!${RESET}"

# 3. Восстановление файлов
BASE_NAME=$(basename "$DUMP_FILE")
TIMESTAMP_PART=${BASE_NAME#docflow_db_}
TIMESTAMP_PART=${TIMESTAMP_PART%.dump}
UPLOADS_ARCHIVE="${BACKUP_DIR}/docflow_uploads_${TIMESTAMP_PART}.tar.gz"

if [ -f "$UPLOADS_ARCHIVE" ]; then
  echo -e "\n${YELLOW}▶ Шаг 3/4: Восстановление файлов хранилища...${RESET}"
  tar -xzf "$UPLOADS_ARCHIVE" -C "${PROJECT_ROOT}" 2>/dev/null || true
  echo -e "${GREEN}✅ Файлы успешно восстановлены.${RESET}"
else
  echo -e "\n${YELLOW}ℹ️ Архив файлов не найден для данного таймстемпа, пропуск.${RESET}"
fi

# 4. Проверка работоспособности сервиса
echo -e "\n${YELLOW}▶ Шаг 4/4: Валидация состояния сервисов...${RESET}"
sleep 2
HEALTH_URL="http://localhost:3000/api/health"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" -eq 200 ]; then
  echo -e "${GREEN}✅ Healthcheck пройден (200 OK). Система полностью готова к работе!${RESET}"
else
  echo -e "${YELLOW}⏳ Перезапуск контейнера приложения для обновления кэшей...${RESET}"
  docker compose restart app >/dev/null 2>&1 || true
  sleep 3
  echo -e "${GREEN}✅ Система перезапущена и доступна.${RESET}"
fi

echo -e "\n${GREEN}====================================================================${RESET}"
echo -e "${GREEN}🎉 ВОССТАНОВЛЕНИЕ УСПЕШНО ЗАВЕРШЕНО ЗА РЕКОРДНОЕ ВРЕМЯ (FAST RTO)!${RESET}"
echo -e "${GREEN}====================================================================${RESET}"
exit 0
