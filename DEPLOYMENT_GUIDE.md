# Руководство по развёртыванию DocFlow Streamlined на Production-сервере

Данное руководство содержит пошаговую инструкцию по установке, настройке, сопряжению двустороннего **SSO с LabSpace**, настройке Nginx с TLS и эксплуатации системы **DocFlow Streamlined** на удалённом Linux-сервере (Ubuntu 22.04 / 24.04 LTS, Debian 11 / 12).

---

## 1. Системные требования

- **ОС**: Ubuntu 22.04 / 24.04 LTS или Debian 11 / 12 (x86_64)
- **CPU**: от 2 ядер (рекомендуется 4 ядра для одновременной работы ONLYOFFICE Docs и локального AI/RAG)
- **RAM**: от 4 ГБ (рекомендуется 6–8 ГБ для PostgreSQL + pgvector, MinIO и ONLYOFFICE)
- **Диск**: от 40 ГБ SSD/NVMe
- **Сеть**: статический публичный IPv4-адрес, доменное имя (например, `docflow.example.ru`) с A-записью на IP сервера, открытые порты `22`, `80`, `443`

---

## 2. Первоначальная подготовка сервера

Подключитесь к серверу по SSH:
```bash
ssh root@YOUR_SERVER_IP
```

### 2.1. Установка базовых пакетов и брандмауэра
```bash
apt update && apt upgrade -y
apt install -y curl unzip ufw fail2ban certbot python3-certbot-nginx nginx htop

ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw default deny incoming
ufw default allow outgoing
ufw --force enable
```

### 2.2. Установка Docker и Docker Compose
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

docker --version
docker compose version
```

---

## 3. Развёртывание DocFlow из архива

### 3.1. Распаковка архива
Загрузите архив `docflow-streamlined-deploy-*.zip` на сервер (например, через `scp`) и распакуйте в `/opt/docflow-streamlined`:
```bash
mkdir -p /opt/docflow-streamlined
unzip -q docflow-streamlined-deploy-*.zip -d /opt/docflow-streamlined
cd /opt/docflow-streamlined
chmod +x deploy.sh scripts/*.sh
```

### 3.2. Настройка переменных окружения (`.env`)
Скопируйте шаблон `.env.example` в `.env`:
```bash
cp .env.example .env
```

Сгенерируйте криптостойкие ключи (отдельные значения для каждого параметра):
```bash
# 3 раза для JWT_SECRET, SSO_LABSPACE_CLIENT_SECRET и SSO_DOCFLOW_CLIENT_SECRET:
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Отредактируйте `.env` (`nano .env`):
```ini
PORT=3000
NODE_ENV=production
JWT_SECRET=<случайная_строка_от_32_символов>

PGHOST=postgres
PGPORT=5432
PGUSER=docflow
PGPASSWORD=<надёжный_пароль_БД>
PGDATABASE=docflow_db

MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ROOT_USER=docflow_minio_admin
MINIO_ROOT_PASSWORD=<надёжный_пароль_MinIO>
MINIO_BUCKET=docflow-storage

# Публичный адрес ONLYOFFICE (через Nginx proxy)
ONLYOFFICE_PUBLIC_URL=https://docflow.example.ru/onlyoffice

HF_CACHE_DIR=/app/.hf_cache
EMBEDDING_MODEL=Xenova/multilingual-e5-small

# --- Настройки SSO с LabSpace (см. раздел 5) ---
SSO_LABSPACE_URL=https://labspace.example.ru
# SSO_LABSPACE_INTERNAL_URL=http://127.0.0.1:8100  # если на одном хосте; иначе оставьте пустым
SSO_LABSPACE_CLIENT_SECRET=<секрет_1_для_обмена_на_DocFlow>
SSO_DOCFLOW_CLIENT_SECRET=<секрет_2_для_обмена_на_LabSpace>
```

> [!IMPORTANT]
> Оба секрета (`SSO_LABSPACE_CLIENT_SECRET` и `SSO_DOCFLOW_CLIENT_SECRET`) должны быть **разными** строками длиной 32–256 символов из алфавита `[A-Za-z0-9_-]`.

### 3.3. Запуск контейнеров
Запустите стек в production-режиме:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Проверьте состояние и healthcheck:
```bash
docker compose -f docker-compose.prod.yml ps
curl -s http://127.0.0.1:3000/api/health
curl -s http://127.0.0.1:3000/api/sso/config
```
Ожидаемый ответ: `{"status":"UP",...}` и `{"enabled":true,"mode":"authorization_code",...}`.

---

## 4. Настройка Nginx Reverse Proxy и HTTPS (SSL)

В проект включён готовый конфиг `nginx/docflow.conf`. Он уже настроен на:
- поддержку **SSE** (`/api/messenger/events`, `proxy_buffering off`);
- **WebSockets** для ONLYOFFICE Docs (`/onlyoffice/`);
- кэширование статики и Gzip;
- **защиту логов SSO**: для `location ^~ /api/sso/` включён `access_log off;`, чтобы параметры `code`, `state` и заголовок `Authorization` не попадали в логи Nginx.

Установите конфигурацию (предварительно заменив `docflow.mycompany.ru` на ваш домен в `/etc/nginx/sites-available/docflow.conf`):
```bash
cp /opt/docflow-streamlined/nginx/docflow.conf /etc/nginx/sites-available/docflow.conf
sed -i 's/docflow\.mycompany\.ru/docflow.example.ru/g' /etc/nginx/sites-available/docflow.conf
ln -sf /etc/nginx/sites-available/docflow.conf /etc/nginx/sites-enabled/docflow.conf
rm -f /etc/nginx/sites-enabled/default
```

Выпустите сертификат Let's Encrypt и перезагрузите Nginx:
```bash
certbot --nginx -d docflow.example.ru --non-interactive --agree-tos -m admin@example.ru
nginx -t && systemctl reload nginx
```

---

## 5. Сопряжение двустороннего SSO между DocFlow и LabSpace

Между **DocFlow** и **LabSpace** реализован двусторонний серверный обмен одноразовым `authorization code` (живёт 60 секунд, с обязательной проверкой `state`, атомарным одноразовым погашением и аутентификацией сервера по `Authorization: Bearer <secret>`).

### 5.1. Схема маршрутов

| Направление входа | Старт входа | Выдача кода после входа в систему-издатель | Callback в принимающем приложении | Серверный обмен `POST` |
|---|---|---|---|---|
| **Вход в LabSpace через DocFlow** | LabSpace `GET /accounts/sso/login/` | DocFlow `GET /api/sso/labspace?state=…` | LabSpace `GET /accounts/sso/callback/?code=…&state=…` | DocFlow `POST /api/sso/code/exchange` |
| **Вход в DocFlow через LabSpace** | DocFlow `GET /api/sso/login` | LabSpace `GET /accounts/sso/authorize/?state=…` | DocFlow `GET /api/sso/callback?code=…&state=…` | LabSpace `POST /accounts/sso/code/exchange/` |

### 5.2. Таблица соответствия переменных окружения

Значения на обоих серверах должны совпадать попарно:

| Назначение | Переменная в **DocFlow** (`.env`) | Переменная в **LabSpace** (`.env`) | Пример / требования |
|---|---|---|---|
| Адрес партнёра (origin без пути и `/` на конце) | `SSO_LABSPACE_URL` | `LABSPACE_SSO_DOCFLOW_URL` | В DocFlow: `https://labspace.example.ru`<br>В LabSpace: `https://docflow.example.ru` |
| Секрет для вызова `DocFlow POST /api/sso/code/exchange` | `SSO_LABSPACE_CLIENT_SECRET` | `LABSPACE_SSO_LABSPACE_CLIENT_SECRET` | Одинаковая случайная строка (`secrets.token_urlsafe(32)`) |
| Секрет для вызова `LabSpace POST /accounts/sso/code/exchange/` | `SSO_DOCFLOW_CLIENT_SECRET` | `LABSPACE_SSO_DOCFLOW_CLIENT_SECRET` | **Другая** одинаковая случайная строка (`secrets.token_urlsafe(32)`) |
| Внутренний URL (опционально) | `SSO_LABSPACE_INTERNAL_URL` | — | Указывается, только если сервер-сервер обмен должен идти по локальной сети/порту минуя внешний прокси |

### 5.3. Обязательные действия в базах и админках

1. **На стороне LabSpace**:
   - Примените миграции (включая `accounts.0010_docflow_sso`):
     ```bash
     python manage.py migrate
     ```
   - Пользователь в LabSpace должен завершить настройку пароля и локальной 2FA (TOTP).
   - В админ-панели LabSpace создайте запись привязки `DocFlowIdentity`: укажите точный числовой ID пользователя из DocFlow (`users.id`, он же возвращается как `sub`) и выберите существующего локального пользователя LabSpace. Совпадение email автоматически привязку не создаёт.
2. **На стороне DocFlow**:
   - Таблица `sso_links` создаётся автоматически при миграции/старте сервера.
   - Пользователь может войти по кнопке **«Войти через LabSpace»**, после чего система при отсутствии привязки предложит подтвердить привязку к текущему аккаунту DocFlow (`POST /api/sso/link`), либо администратор может создать привязку заранее через `POST /api/sso/admin/link` (`{ user_id, external_user_id, provider: 'labspace', external_email }`).
   - Для выдачи одноразового кода из DocFlow в LabSpace у пользователя DocFlow должна быть активирована двухфакторная аутентификация (`totp_enabled = TRUE`).

### 5.4. Проверка сопряжения на стенде

1. Запустите встроенный интеграционный тест протокола SSO внутри контейнера DocFlow:
   ```bash
   docker exec docflow_streamlined node backend/tests/sso_labspace_integration.test.js
   # В prod-compose: docker exec docflow_app_prod node backend/tests/sso_labspace_integration.test.js
   ```
2. Проверьте доступность с обеих сторон:
   - `curl -s https://docflow.example.ru/api/sso/config` -> `enabled: true`.
   - `curl -s -o /dev/null -w "%{http_code}\n" https://labspace.example.ru/accounts/sso/login/` -> `302` (редирект на DocFlow с `state`).
3. Проверьте в браузере оба направления входа (и выход из сессий обоих приложений), а также убедитесь, что параметры callback (`code`, `state`) и `Authorization` отсутствуют в access-логах Nginx.

---

## 6. Бесшовное обновление и резервное копирование

### 6.1. Обновление
При обновлении с помощью скрипта `./deploy.sh` сначала выполняется бэкап, затем пересборка образа и ротация контейнера без простоя, или вручную:
```bash
cd /opt/docflow-streamlined
./scripts/backup.sh
docker compose -f docker-compose.prod.yml up -d --build
```

### 6.2. Резервное копирование и восстановление
```bash
# Создание дампа БД и архива uploads в data/backups/
cd /opt/docflow-streamlined
./scripts/backup.sh

# Ежедневный cron в 03:00
# 0 3 * * * cd /opt/docflow-streamlined && ./scripts/backup.sh >> /var/log/docflow_backup.log 2>&1

# Восстановление из последнего бэкапа
./scripts/restore.sh
```
