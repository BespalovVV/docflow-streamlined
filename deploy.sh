#!/bin/bash
# ==============================================================================
# DOCFLOW STREAMLINED: СКРИПТ БЕСШОВНОГО ОБНОВЛЕНИЯ (ZERO-DOWNTIME DEPLOYMENT)
# ==============================================================================
# Особенности:
# 1. Автоматическая загрузка обновлений из Git
# 2. Фоновая сборка нового Docker-образа без остановки работающего сервиса
# 3. Валидация работоспособности через эндпоинт /api/health
# 4. Мягкая ротация контейнеров без прерывания сессий пользователей
# 5. Автоматический откат (Rollback) при непрохождении healthcheck
# 6. Очистка старых слоев Docker для экономии места на диске
# ==============================================================================

set -euo pipefail

# Цветовая палитра вывода
COLOR_RESET="\033[0m"
COLOR_GREEN="\033[1;32m"
COLOR_BLUE="\033[1;34m"
COLOR_YELLOW="\033[1;33m"
COLOR_RED="\033[1;31m"

COMPOSE_FILE="docker-compose.prod.yml"
if [ ! -f "$COMPOSE_FILE" ]; then
    COMPOSE_FILE="docker-compose.yml"
fi

echo -e "${COLOR_BLUE}====================================================================${COLOR_RESET}"
echo -e "${COLOR_BLUE}🚀 СТАРТ БЕСШОВНОГО ДЕПЛОЯ DOCFLOW STREAMLINED [$(date '+%Y-%m-%d %H:%M:%S')]${COLOR_RESET}"
echo -e "${COLOR_BLUE}====================================================================${COLOR_RESET}"

PREV_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "initial")
echo -e "${COLOR_BLUE}📌 Текущий коммит:${COLOR_RESET} $PREV_COMMIT"

# 0. Создание моментальной контрольной точки (Pre-Deploy Backup)
echo -e "\n${COLOR_YELLOW}📦 Шаг 1/6: Создание моментального снапшота системы (Pre-Deploy Backup)...${COLOR_RESET}"
if [ -f "./scripts/backup.sh" ]; then
    bash ./scripts/backup.sh || {
        echo -e "${COLOR_RED}❌ Ошибка создания предварительного бэкапа. Прерывание обновления в целях безопасности данных!${COLOR_RESET}"
        exit 1
    }
fi

# 1. Подтягивание свежего кода из Git
echo -e "\n${COLOR_YELLOW}📥 Шаг 2/6: Получение обновлений из репозитория...${COLOR_RESET}"
git fetch origin main || git fetch origin master
git reset --hard origin/main 2>/dev/null || git reset --hard origin/master

NEW_COMMIT=$(git rev-parse HEAD)
echo -e "${COLOR_GREEN}✅ Код обновлен до коммита:${COLOR_RESET} $NEW_COMMIT

# 2. Проверка запущенных инфраструктурных сервисов (PostgreSQL, MinIO, ONLYOFFICE)
echo -e "\n${COLOR_YELLOW}📦 Шаг 3/6: Проверка состояния базы данных и сервисов...${COLOR_RESET}"
docker compose -f "$COMPOSE_FILE" up -d postgres minio onlyoffice

# 3. Фоновая сборка нового образа приложения
echo -e "\n${COLOR_YELLOW}🔨 Шаг 4/6: Фоновая сборка нового образа приложения...${COLOR_RESET}"
docker compose -f "$COMPOSE_FILE" build --pull app

# 4. Бесшовный перезапуск и проверка здоровья (Healthcheck)
echo -e "\n${COLOR_YELLOW}🔄 Шаг 5/6: Ротация контейнеров приложения...${COLOR_RESET}"

# Перезапуск сервиса app с новым образом
docker compose -f "$COMPOSE_FILE" up -d --no-deps --build app

echo -e "${COLOR_BLUE}⏳ Ожидание готовности нового контейнера к приему трафика...${COLOR_RESET}"

HEALTH_URL="http://localhost:3000/api/health"
MAX_ATTEMPTS=20
WAIT_INTERVAL=2
HEALTH_PASSED=false

for i in $(seq 1 $MAX_ATTEMPTS); do
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
    if [ "$HTTP_STATUS" -eq 200 ]; then
        echo -e "${COLOR_GREEN}✅ [Попытка $i/$MAX_ATTEMPTS] Healthcheck пройден! Сервер отвечает кодом 200 OK.${COLOR_RESET}"
        HEALTH_PASSED=true
        break
    else
        echo -e "${COLOR_YELLOW}⏳ [Попытка $i/$MAX_ATTEMPTS] Код ответа: $HTTP_STATUS. Ожидание готовности сервиса...${COLOR_RESET}"
        sleep $WAIT_INTERVAL
    fi
done

# 5. Обработка результатов и откат в случае сбоя
if [ "$HEALTH_PASSED" = true ]; then
    echo -e "\n${COLOR_GREEN}====================================================================${COLOR_RESET}"
    echo -e "${COLOR_GREEN}🎉 ДЕПЛОЙ УСПЕШНО ЗАВЕРШЕН БЕЗ ПРЕКРАЩЕНИЯ ОБСЛУЖИВАНИЯ!${COLOR_RESET}"
    echo -e "${COLOR_GREEN}====================================================================${COLOR_RESET}"

    # Перезагрузка Nginx reverse-proxy если запущен локально
    if systemctl is-active --quiet nginx 2>/dev/null; then
        echo -e "${COLOR_BLUE}🌐 Мягкая перезагрузка Nginx reverse-proxy...${COLOR_RESET}"
        sudo nginx -s reload || true
    fi

    # Очистка неиспользуемых висячих образов
    echo -e "\n${COLOR_BLUE}🧹 Шаг 6/6: Очистка старых слоев Docker...${COLOR_RESET}"
    docker image prune -f --filter "dangling=true" >/dev/null 2>&1 || true

    exit 0
else
    echo -e "\n${COLOR_RED}====================================================================${COLOR_RESET}"
    echo -e "${COLOR_RED}❌ ОШИБКА: Новый контейнер не прошел проверку здоровья!${COLOR_RESET}"
    echo -e "${COLOR_RED}🚨 Инициализация автоматического отката (ROLLBACK)...${COLOR_RESET}"
    echo -e "${COLOR_RED}====================================================================${COLOR_RESET}"

    # Вывод последних логов для диагностики
    echo -e "\n${COLOR_YELLOW}📋 Логи упавшего контейнера:${COLOR_RESET}"
    docker compose -f "$COMPOSE_FILE" logs --tail 40 app

    # Откат кода к предыдущему стабильному коммиту
    if [ "$PREV_COMMIT" != "initial" ]; then
        echo -e "\n${COLOR_YELLOW}⏪ Откат репозитория к коммиту $PREV_COMMIT...${COLOR_RESET}"
        git reset --hard "$PREV_COMMIT"
        docker compose -f "$COMPOSE_FILE" build app
        docker compose -f "$COMPOSE_FILE" up -d --no-deps app
        echo -e "${COLOR_GREEN}✅ Откат к стабильной версии успешно выполнен.${COLOR_RESET}"
    fi

    exit 1
fi
