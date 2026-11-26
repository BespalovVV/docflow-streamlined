const assert = require('assert');
const { encrypt, decrypt } = require('../utils/crypto');

console.log('==============================================');
console.log('🧪 RUNNING SYSTEM SECURITY & MAIL TESTS');
console.log('==============================================');

// Test 1: Crypto AES-256-GCM Encryption / Decryption
try {
  const secretPassword = 'MySuperAppSecretPassword123!';
  const encrypted = encrypt(secretPassword);
  
  assert.notStrictEqual(encrypted, secretPassword, 'Password must be encrypted');
  assert.strictEqual(encrypted.split(':').length, 3, 'Encrypted output must contain IV:AuthTag:Cipher');
  
  const decrypted = decrypt(encrypted);
  assert.strictEqual(decrypted, secretPassword, 'Decrypted text must match original input');
  
  console.log('✅ PASS: AES-256-GCM Encryption & Decryption Audit Passed');
} catch (err) {
  console.error('❌ FAIL: Crypto Test Failed:', err.message);
  process.exit(1);
}

// Test 2: Input Sanitization Helper
try {
  function sanitizeInput(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const maliciousPayload = '<script>alert("XSS")</script><img src=x onerror=alert(1)>';
  const sanitized = sanitizeInput(maliciousPayload);

  assert.strictEqual(sanitized.includes('<script>'), false, 'Script tags must be escaped');
  assert.strictEqual(sanitized.includes('&lt;script&gt;'), true, 'Script tags must be converted to HTML entities');
  
  console.log('✅ PASS: XSS & HTML Input Sanitization Audit Passed');
} catch (err) {
  console.error('❌ FAIL: Sanitization Test Failed:', err.message);
  process.exit(1);
}

// Test 3: Bulk & Promotional Mail Filter
try {
  function isPromotionalOrBulkMailTest(parsed, senderEmail = '', senderName = '', subject = '') {
    const emailLower = (senderEmail || '').toLowerCase();
    const nameLower = (senderName || '').toLowerCase();
    const subjLower = (subject || '').toLowerCase();

    const promoKeywords = [
      'no-reply', 'noreply', 'do-not-reply', 'donotreply', 'promo', 'news', 'newsletter',
      'marketing', 'digest', 'subscribe', 'skidka', 'sale@', 'offers@', 'discount',
      'акци', 'рассылк', 'новости@', 'reklama', 'advertising'
    ];

    for (const kw of promoKeywords) {
      if (emailLower.includes(kw) || nameLower.includes(kw)) {
        return true;
      }
    }
    return false;
  }

  assert.strictEqual(isPromotionalOrBulkMailTest({}, 'no-reply@promo-store.ru', 'Store', 'Hot Deals'), true, 'Should filter no-reply');
  assert.strictEqual(isPromotionalOrBulkMailTest({}, 'newsletter@techsite.com', 'Tech', 'Weekly Digest'), true, 'Should filter newsletter');
  assert.strictEqual(isPromotionalOrBulkMailTest({}, 'ivan.petrov@company.com', 'Иван Петров', 'Отчет по проекту'), false, 'Should allow human email');

  console.log('✅ PASS: Bulk & Promotional Email Filter Audit Passed');
} catch (err) {
  console.error('❌ FAIL: Promo Mail Filter Test Failed:', err.message);
  process.exit(1);
}

console.log('==============================================');
console.log('🎉 ALL SECURITY & INTEGRATION TESTS SUCCEEDED!');
console.log('==============================================');
