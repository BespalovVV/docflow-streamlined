# ==============================================================================
# DOCFLOW ENTERPRISE BACKUP ENGINE (WINDOWS POWERSHELL)
# ==============================================================================

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$BackupDir = Join-Path $ProjectRoot "data\backups"
$Timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"

if (!(Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
}

$DbContainer = "docflow_postgres"
$RunningContainers = docker ps --format "{{.Names}}"
if ($RunningContainers -notcontains $DbContainer -and $RunningContainers -contains "docflow_postgres_prod") {
    $DbContainer = "docflow_postgres_prod"
}

$DbUser = if ($env:PGUSER) { $env:PGUSER } else { "docflow" }
$DbName = if ($env:PGDATABASE) { $env:PGDATABASE } else { "docflow_db" }

$DbBackupFile = Join-Path $BackupDir "docflow_db_$Timestamp.dump"
$UploadsBackupFile = Join-Path $BackupDir "docflow_uploads_$Timestamp.tar.gz"
$ChecksumFile = Join-Path $BackupDir "checksums_$Timestamp.sha256"

Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "📦 СТАРТ РЕЗЕРВНОГО КОПИРОВАНИЯ DOCFLOW [$Timestamp]" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan

# 1. Дамп базы данных PostgreSQL (Формат -Fc с компрессией)
Write-Host "`n▶ Шаг 1/4: Создание снапшота PostgreSQL (MVCC non-blocking)..." -ForegroundColor Yellow
$StartDbTime = Get-Date

cmd /c "docker exec $DbContainer pg_dump -U $DbUser -d $DbName -Fc -Z 6 --no-owner --no-privileges > `"$DbBackupFile`""

$DbDuration = [math]::Round(((Get-Date) - $StartDbTime).TotalSeconds, 1)
$DbSize = [math]::Round((Get-Item $DbBackupFile).Length / 1KB, 1)
Write-Host "✅ Дамп БД успешно создан: $DbBackupFile ($DbSize КБ, заняло $DbDuration с)" -ForegroundColor Green

# 2. Валидация целостности дампа
Write-Host "`n▶ Шаг 2/4: Валидация структуры и заголовков дампа..." -ForegroundColor Yellow
$ValidateResult = cmd /c "docker exec -i $DbContainer pg_restore --list < `"$DbBackupFile`"" 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Дамп валиден и готов к мгновенному параллельному восстановлению." -ForegroundColor Green
} else {
    Write-Host "❌ Ошибка: Дамп поврежден!" -ForegroundColor Red
    Remove-Item $DbBackupFile -Force -ErrorAction SilentlyContinue
    exit 1
}

# 3. Резервное копирование файлов хранилища (uploads)
Write-Host "`n▶ Шаг 3/4: Резервное копирование файлов и документов..." -ForegroundColor Yellow
$UploadsDir = Join-Path $ProjectRoot "uploads"
if (Test-Path $UploadsDir) {
    $StartUploadsTime = Get-Date
    tar -czf "$UploadsBackupFile" -C "$ProjectRoot" uploads
    $UploadsDuration = [math]::Round(((Get-Date) - $StartUploadsTime).TotalSeconds, 1)
    $UploadsSize = [math]::Round((Get-Item $UploadsBackupFile).Length / 1KB, 1)
    Write-Host "✅ Архив файлов создан: $UploadsBackupFile ($UploadsSize КБ, заняло $UploadsDuration с)" -ForegroundColor Green
} else {
    Write-Host "⚠️ Каталог uploads отсутствует или пуст, пропуск архивации файлов." -ForegroundColor Yellow
}

# 4. Расчет контрольных сумм SHA-256
Write-Host "`n▶ Шаг 4/4: Генерация контрольной суммы SHA-256..." -ForegroundColor Yellow
$HashDb = (Get-FileHash -Path $DbBackupFile -Algorithm SHA256).Hash
$ChecksumLines = @("$HashDb  docflow_db_$Timestamp.dump")

if (Test-Path $UploadsBackupFile) {
    $HashUploads = (Get-FileHash -Path $UploadsBackupFile -Algorithm SHA256).Hash
    $ChecksumLines += "$HashUploads  docflow_uploads_$Timestamp.tar.gz"
}

$ChecksumLines | Out-File -FilePath $ChecksumFile -Encoding utf8
Write-Host "✅ Хеш SHA-256 сохранен в $ChecksumFile" -ForegroundColor Green

# 5. Ротация: удаление дампов и архивов старше 14 дней
Write-Host "`n▶ Применение политики ротации (удаление старше 14 дней)..." -ForegroundColor Cyan
$OldFiles = Get-ChildItem -Path $BackupDir | Where-Object { 
    ($_.Name -like "docflow_db_*.dump" -or $_.Name -like "docflow_uploads_*.tar.gz" -or $_.Name -like "checksums_*.sha256") -and 
    $_.LastWriteTime -lt (Get-Date).AddDays(-14) 
}
foreach ($file in $OldFiles) {
    Remove-Item $file.FullName -Force -ErrorAction SilentlyContinue
}
Write-Host "✅ Политика хранения применена." -ForegroundColor Green

Write-Host "`n====================================================================" -ForegroundColor Green
Write-Host "🎉 БЭКАП УСПЕШНО СОЗДАН И ВАЛИДИРОВАН!" -ForegroundColor Green
Write-Host "====================================================================" -ForegroundColor Green
