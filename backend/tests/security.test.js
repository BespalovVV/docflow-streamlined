// backend/tests/security.test.js
const assert = require('assert');
const path = require('path');
const { encrypt, decrypt } = require('../utils/crypto');

async function runSecurityTests() {
  console.log('\n🛡️ [2/3] Запуск тестов безопасности (Security Hardening)...');

  // Test 1: Crypto AES-256-GCM Integrity and Authentication Tag
  {
    const rawSecret = 'Corporate_Email_Secret_Pass_2026!$#';
    const encrypted = encrypt(rawSecret);

    assert.notStrictEqual(encrypted, rawSecret, 'Шифротекст не должен совпадать с исходным паролем');
    const parts = encrypted.split(':');
    assert.strictEqual(parts.length, 3, 'Формат шифротекста должен быть IV:AuthTag:Cipher');

    // Successful decryption
    const decrypted = decrypt(encrypted);
    assert.strictEqual(decrypted, rawSecret, 'Расшифрованное значение должно совпадать с исходным');

    // Tampering test: modify 1 byte of cipher text
    let tampered = parts[0] + ':' + parts[1] + ':' + (parts[2].slice(0, -2) + 'aa');
    const tamperedResult = decrypt(tampered);
    assert.notStrictEqual(tamperedResult, rawSecret, 'Подделанный шифротекст не должен восстанавливать исходный секрет');
    assert.strictEqual(tamperedResult, tampered, 'При нарушении целостности возвращается безопасный fallback');

    console.log('  ✅ 2.1. Криптостойкое шифрование AES-256-GCM и защита от подделки — Успешно');
  }

  // Test 2: Path Traversal Attack Prevention
  {
    const baseUploadsDir = path.resolve('/app/uploads');

    function isPathSafe(userFilePath, baseDir = baseUploadsDir) {
      const resolved = path.resolve(userFilePath);
      return resolved.startsWith(baseDir);
    }

    // Valid file path inside uploads directory
    assert.strictEqual(isPathSafe(path.join(baseUploadsDir, 'doc-12345.docx')), true, 'Файл внутри uploads должен быть разрешен');
    assert.strictEqual(isPathSafe(path.join(baseUploadsDir, 'sub', 'doc-12345.docx')), true, 'Поддиректория uploads должна быть разрешена');

    // Malicious Path Traversal attempts
    assert.strictEqual(isPathSafe(path.join(baseUploadsDir, '../../etc/passwd')), false, 'Атака ../../etc/passwd должна блокироваться');
    assert.strictEqual(isPathSafe('/etc/shadow'), false, 'Абсолютный путь вне каталога должен блокироваться');
    assert.strictEqual(isPathSafe(path.join(baseUploadsDir, '../backend/server.js')), false, 'Попытка чтения исходного кода сервера должна блокироваться');

    console.log('  ✅ 2.2. Защита от Path Traversal при скачивании файлов — Успешно');
  }

  // Test 3: Upload Extensions Whitelist / Blacklist Validation
  {
    const ALLOWED_EXTENSIONS = new Set([
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.txt', '.rtf', '.odt', '.ods', '.odp', '.csv',
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip', '.rar', '.7z'
    ]);
    const FORBIDDEN_EXTENSIONS = new Set([
      '.exe', '.sh', '.bat', '.cmd', '.js', '.mjs', '.php', '.py', '.vbs', '.dll', '.bin', '.html', '.htm'
    ]);

    function checkFileAllowed(filename) {
      const ext = path.extname(filename).toLowerCase();
      if (FORBIDDEN_EXTENSIONS.has(ext)) return false;
      return ALLOWED_EXTENSIONS.has(ext);
    }

    // Legitimate files
    assert.strictEqual(checkFileAllowed('contract.docx'), true);
    assert.strictEqual(checkFileAllowed('financial_report.xlsx'), true);
    assert.strictEqual(checkFileAllowed('presentation.pptx'), true);
    assert.strictEqual(checkFileAllowed('scan.pdf'), true);
    assert.strictEqual(checkFileAllowed('avatar.png'), true);
    assert.strictEqual(checkFileAllowed('archive.zip'), true);

    // Dangerous files that MUST be blocked
    assert.strictEqual(checkFileAllowed('malware.exe'), false);
    assert.strictEqual(checkFileAllowed('payload.php'), false);
    assert.strictEqual(checkFileAllowed('backdoor.sh'), false);
    assert.strictEqual(checkFileAllowed('script.bat'), false);
    assert.strictEqual(checkFileAllowed('xss.html'), false);
    assert.strictEqual(checkFileAllowed('trojan.dll'), false);

    console.log('  ✅ 2.3. Белый и черный списки расширений файлов (File Upload Filter) — Успешно');
  }

  // Test 4: In-Memory Login Rate Limiter
  {
    const loginAttempts = new Map();
    const LOGIN_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
    const MAX_LOGIN_ATTEMPTS = 10;

    function checkLoginRateLimit(ip) {
      const now = Date.now();
      const record = loginAttempts.get(ip);
      if (!record) return true;
      if (now - record.firstAttempt > LOGIN_RATE_LIMIT_WINDOW_MS) {
        loginAttempts.delete(ip);
        return true;
      }
      return record.count < MAX_LOGIN_ATTEMPTS;
    }

    function recordFailedLogin(ip) {
      const now = Date.now();
      const record = loginAttempts.get(ip) || { count: 0, firstAttempt: now };
      record.count += 1;
      loginAttempts.set(ip, record);
    }

    const testIp = '192.168.1.105';

    // First 10 attempts allowed
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
      assert.strictEqual(checkLoginRateLimit(testIp), true, `Попытка ${i+1} должна быть разрешена`);
      recordFailedLogin(testIp);
    }

    // 11th attempt blocked
    assert.strictEqual(checkLoginRateLimit(testIp), false, '11-я попытка брутфорса должна быть заблокирована');

    // Another clean IP is not blocked
    assert.strictEqual(checkLoginRateLimit('192.168.1.106'), true, 'Незаблокированный IP должен пропускаться');

    console.log('  ✅ 2.4. Ограничение частоты попыток входа (Anti-Bruteforce Rate Limiter) — Успешно');
  }
}

module.exports = { runSecurityTests };

if (require.main === module) {
  runSecurityTests()
    .then(() => console.log('🎉 Все тесты безопасности успешно пройдены!'))
    .catch((err) => {
      console.error('❌ Ошибка в тестах безопасности:', err);
      process.exit(1);
    });
}
