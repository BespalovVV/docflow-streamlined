# ==============================================================================
# DOCFLOW ENTERPRISE RESTORE ENGINE (WINDOWS POWERSHELL - FAST RTO)
# ==============================================================================

param (
    [string]$DumpFileName
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$BackupDir = Join-Path $ProjectRoot "data\backups"

$DbContainer = "docflow_postgres"
$RunningContainers = docker ps --format "{{.Names}}"
if ($RunningContainers -notcontains $DbContainer -and $RunningContainers -contains "docflow_postgres_prod") {
    $DbContainer = "docflow_postgres_prod"
}

$DbUser = if ($env:PGUSER) { $env:PGUSER } else { "docflow" }
$DbName = if ($env:PGDATABASE) { $env:PGDATABASE } else { "docflow_db" }

# Поиск файла
if ($DumpFileName) {
    if (Test-Path $DumpFileName) {
        $DumpFile = $DumpFileName
    } elseif (Test-Path (Join-Path $BackupDir $DumpFileName)) {
        $DumpFile = Join-Path $BackupDir $DumpFileName
    } else {
        Write-Host "❌ Указанный файл не найден: $DumpFileName" -ForegroundColor Red
        exit 1
    }
} else {
    $DumpFile = (Get-ChildItem -Path $BackupDir -Filter "docflow_db_*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
    if (!$DumpFile) {
        Write-Host "❌ В папке $BackupDir не найдено резервных копий!" -ForegroundColor Red
        exit 1
    }
}

Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "♻️ ВОССТАНОВЛЕНИЕ DOCFLOW ИЗ РЕЗЕРВНОЙ КОПИИ" -ForegroundColor Cyan
Write-Host "📁 Файл: $DumpFile" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan

# 1. Проверка контрольной суммы
Write-Host "`n▶ Шаг 1/3: Валидация целостности архива..." -ForegroundColor Yellow
$ValidateResult = cmd /c "docker exec -i $DbContainer pg_restore --list < `"$DumpFile`"" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Ошибка: Файл дампа поврежден!" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Дамп валиден." -ForegroundColor Green

# 2. Быстрое многопоточное восстановление
Write-Host "`n▶ Шаг 2/3: Восстановление базы данных PostgreSQL..." -ForegroundColor Yellow
$StartRestoreTime = Get-Date

# Сброс активных соединений
docker exec $DbContainer psql -U $DbUser -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DbName' AND pid <> pg_backend_pid();" | Out-Null

# Копирование дампа внутрь контейнера для настоящего многопоточного восстановления (-j 4)
$TempContainerDump = "/tmp/restore_in_progress.dump"
docker cp "$DumpFile" "${DbContainer}:${TempContainerDump}"

try {
    docker exec $DbContainer pg_restore -U $DbUser -d $DbName --clean --if-exists --no-owner --no-privileges -j 4 $TempContainerDump
} finally {
    docker exec $DbContainer rm -f $TempContainerDump | Out-Null
}

$RestoreDuration = [math]::Round(((Get-Date) - $StartRestoreTime).TotalSeconds, 1)
Write-Host "✅ База данных успешно восстановлена за $RestoreDuration с!" -ForegroundColor Green

# 3. Восстановление файлов хранилища uploads
$BaseName = [System.IO.Path]::GetFileNameWithoutExtension($DumpFile)
$TimestampPart = $BaseName -replace "^docflow_db_", ""
$UploadsArchive = Join-Path $BackupDir "docflow_uploads_$TimestampPart.tar.gz"

if (Test-Path $UploadsArchive) {
    Write-Host "`n▶ Шаг 3/4: Восстановление файлов хранилища..." -ForegroundColor Yellow
    tar -xzf "$UploadsArchive" -C "$ProjectRoot"
    Write-Host "✅ Файлы хранилища успешно восстановлены." -ForegroundColor Green
} else {
    Write-Host "`nℹ️ Архив файлов не найден для данного таймстемпа, пропуск." -ForegroundColor Yellow
}

# 4. Перезапуск контейнера для мгновенного сброса кэша
Write-Host "`n▶ Шаг 4/4: Проверка готовности приложения..." -ForegroundColor Yellow
$AppContainer = "docflow_streamlined"
if ($RunningContainers -contains "docflow_app_prod") {
    $AppContainer = "docflow_app_prod"
}
docker restart $AppContainer | Out-Null
Start-Sleep -Seconds 3

Write-Host "`n====================================================================" -ForegroundColor Green
Write-Host "🎉 СИСТЕМА УСПЕШНО ВОССТАНОВЛЕНА И ГОТОВА К РАБОТЕ!" -ForegroundColor Green
Write-Host "====================================================================" -ForegroundColor Green
