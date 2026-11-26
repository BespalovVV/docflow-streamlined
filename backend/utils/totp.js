const crypto = require('crypto');
const QRCode = require('qrcode');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BACKUP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Кодирует Buffer в Base32 (RFC 4648, без дополнения '=').
 */
function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Декодирует Base32-строку (RFC 4648) в Buffer.
 */
function base32Decode(str) {
  const clean = String(str || '')
    .toUpperCase()
    .replace(/=+$/g, '')
    .replace(/[^A-Z2-7]/g, '');

  let bits = 0;
  let value = 0;
  const bytes = [];

  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Генерирует криптостойкий секрет для TOTP в Base32.
 */
function generateSecret(numBytes = 20) {
  return base32Encode(crypto.randomBytes(numBytes));
}

/**
 * Вычисляет 6-значный TOTP-код по RFC 6238 (HMAC-SHA1, шаг 30 сек).
 */
function generateTotp(secretBase32, timestampMs = Date.now(), stepSec = 30, digits = 6) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(timestampMs / 1000 / stepSec);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter), 0);

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % 10 ** digits;
  return String(otp).padStart(digits, '0');
}

/**
 * Проверяет 6-значный TOTP-код в окне [-window..+window] с защитой от timing-атак.
 */
function verifyTotp(secretBase32, code, window = 1, timestampMs = Date.now()) {
  if (!secretBase32) return false;
  const cleanCode = String(code || '').replace(/[\s-]+/g, '');
  if (!/^\d{6}$/.test(cleanCode)) return false;

  const inputBuf = Buffer.from(cleanCode, 'utf8');
  const stepMs = 30 * 1000;

  for (let offset = -window; offset <= window; offset++) {
    const candidate = generateTotp(secretBase32, timestampMs + offset * stepMs);
    const candidateBuf = Buffer.from(candidate, 'utf8');
    if (inputBuf.length === candidateBuf.length && crypto.timingSafeEqual(inputBuf, candidateBuf)) {
      return true;
    }
  }
  return false;
}

/**
 * Формирует otpauth:// URI для приложений-аутентификаторов.
 */
function buildOtpAuthUrl(email, secretBase32, issuer = 'DocFlow') {
  const safeIssuer = encodeURIComponent(issuer);
  const safeAccount = encodeURIComponent(String(email || ''));
  return `otpauth://totp/${safeIssuer}:${safeAccount}?secret=${secretBase32}&issuer=${safeIssuer}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Генерирует PNG Data URL с QR-кодом для otpauth:// URI.
 */
async function generateQrDataUrl(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl, {
    width: 220,
    margin: 2,
    color: {
      dark: '#0f172a',
      light: '#ffffff'
    }
  });
}

/**
 * Генерирует набор одноразовых резервных кодов формата XXXX-XXXX.
 */
function generateBackupCodes(count = 8) {
  const codes = [];
  const alphabetLen = BACKUP_ALPHABET.length;

  for (let i = 0; i < count; i++) {
    let raw = '';
    const rand = crypto.randomBytes(8);
    for (let j = 0; j < 8; j++) {
      raw += BACKUP_ALPHABET[rand[j] % alphabetLen];
    }
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }

  return codes;
}

/**
 * Нормализует введённый пользователем резервный код (без дефисов/пробелов, верхний регистр).
 */
function normalizeBackupCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

module.exports = {
  base32Encode,
  base32Decode,
  generateSecret,
  generateTotp,
  verifyTotp,
  buildOtpAuthUrl,
  generateQrDataUrl,
  generateBackupCodes,
  normalizeBackupCode
};
