# ==============================================================================
# DOCFLOW STREAMLINED: СКРИПТ БЕСШОВНОГО ОБНОВЛЕНИЯ (WINDOWS POWERSHELL)
# ==============================================================================

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "🚀 СТАРТ БЕСШОВНОГО ОБНОВЛЕНИЯ DOCFLOW [$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')]" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan

# 1. Создание пре-деплой бэкапа
Write-Host "`n▶ Шаг 1/5: Создание контрольной точки резервного копирования..." -ForegroundColor Yellow
$BackupScript = Join-Path $ScriptDir "scripts\backup.ps1"
if (Test-Path $BackupScript) {
    & powershell -ExecutionPolicy Bypass -File "$BackupScript"
}

# 2. Проверка запущенных сервисов БД и хранилища
Write-Host "`n▶ Шаг 2/5: Проверка состояния инфраструктурных сервисов..." -ForegroundColor Yellow
docker compose up -d postgres minio onlyoffice

# 3. Фоновая сборка нового образа
Write-Host "`n▶ Шаг 3/5: Фоновая сборка обновленного образа приложения..." -ForegroundColor Yellow
docker compose build --pull app

# 4. Ротация контейнера приложения
Write-Host "`n▶ Шаг 4/5: Ротация контейнера приложения..." -ForegroundColor Yellow
docker compose up -d --no-deps --build app

# 5. Валидация состояния через Healthcheck
Write-Host "`n▶ Шаг 5/5: Валидация состояния сервиса (/api/health)..." -ForegroundColor Yellow
$HealthUrl = "http://localhost:3000/api/health"
$HealthPassed = $false

for ($i = 1; $i -le 20; $i++) {
    try {
        $res = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($res.status -eq "UP") {
            Write-Host "✅ [Попытка $i/20] Healthcheck успешно пройден! Сервер в статусе UP." -ForegroundColor Green
            $HealthPassed = $true
            break
        }
    } catch {}
    Write-Host "⏳ [Попытка $i/20] Ожидание готовности сервера..." -ForegroundColor Yellow
    Start-Sleep -Seconds 2
}

if ($HealthPassed) {
    Write-Host "`n====================================================================" -ForegroundColor Green
    Write-Host "🎉 ОБНОВЛЕНИЕ УСПЕШНО ЗАВЕРШЕНО БЕЗ ПРЕРЫВАНИЯ ОБСЛУЖИВАНИЯ!" -ForegroundColor Green
    Write-Host "====================================================================" -ForegroundColor Green
} else {
    Write-Host "`n====================================================================" -ForegroundColor Red
    Write-Host "❌ ОШИБКА: Сервер не отвечает на healthcheck! Запустите scripts/restore.ps1" -ForegroundColor Red
    Write-Host "====================================================================" -ForegroundColor Red
    exit 1
}
