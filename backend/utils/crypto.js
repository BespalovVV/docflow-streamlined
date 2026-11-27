const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const SECRET_KEY = crypto
  .createHash('sha256')
  .update(process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'docflow_secret_key_2026_super_secure')
  .digest();

function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText) {
  if (!encryptedText) return encryptedText;
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    // Return original if not in encrypted format (e.g. legacy plain text)
    return encryptedText;
  }
  try {
    const [ivHex, authTagHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Decryption failed, returning raw string:', err.message);
    return encryptedText;
  }
}

/**
 * Строгая расшифровка AES-256-GCM: при подмене authTag или повреждении шифротекста
 * выбрасывает исключение вместо тихого возврата сырой строки.
 */
function decryptStrict(encryptedText) {
  if (!encryptedText) return encryptedText;
  const parts = String(encryptedText).split(':');
  if (parts.length !== 3) {
    return encryptedText;
  }
  const [ivHex, authTagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function signDownloadUrlParams(resourceId, ttlSeconds = 7200) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${resourceId}:${exp}`;
  const sig = crypto.createHmac('sha256', SECRET_KEY).update(payload).digest('hex');
  return { sig, exp };
}

function verifyDownloadUrlParams(resourceId, sig, exp) {
  if (!sig || !exp) return false;
  const expNum = parseInt(exp, 10);
  if (isNaN(expNum) || Math.floor(Date.now() / 1000) > expNum) return false;
  const expected = crypto.createHmac('sha256', SECRET_KEY).update(`${resourceId}:${expNum}`).digest('hex');
  try {
    const a = Buffer.from(String(sig), 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

module.exports = {
  encrypt,
  decrypt,
  decryptStrict,
  signDownloadUrlParams,
  verifyDownloadUrlParams
};
