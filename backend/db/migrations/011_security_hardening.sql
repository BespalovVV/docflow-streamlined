-- Migration 011: Версионирование JWT-сессий для мгновенного отзыва токенов (logout, смена пароля, сброс 2FA)

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 1;
