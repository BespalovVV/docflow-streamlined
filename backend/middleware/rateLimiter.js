// backend/middleware/rateLimiter.js - Zero-dependency in-memory sliding window rate limiter
const MAX_STORE_SIZE = 50000;
const rateLimitStore = new Map();

// Periodic cleanup of expired rate limit buckets every 5 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now - record.startTime > record.windowMs) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

if (cleanupTimer.unref) {
  cleanupTimer.unref();
}

function getClientIp(req) {
  // Использует req.ip (учитывает app.set('trust proxy', 1)), игнорируя поддельные X-Forwarded-For от недоверенных клиентов
  return req.ip || (req.socket && req.socket.remoteAddress) || '127.0.0.1';
}

function consumeBucket(key, windowMs, max, now) {
  let record = rateLimitStore.get(key);
  if (!record || (now - record.startTime > windowMs)) {
    if (!record && rateLimitStore.size >= MAX_STORE_SIZE) {
      // Удаляем просроченные или старейшую запись при переполнении
      for (const [k, v] of rateLimitStore.entries()) {
        if (now - v.startTime > v.windowMs) {
          rateLimitStore.delete(k);
        }
        if (rateLimitStore.size < MAX_STORE_SIZE) break;
      }
      if (rateLimitStore.size >= MAX_STORE_SIZE) {
        const oldestKey = rateLimitStore.keys().next().value;
        if (oldestKey !== undefined) rateLimitStore.delete(oldestKey);
      }
    }
    record = { count: 1, startTime: now, windowMs };
  } else {
    record.count++;
  }
  rateLimitStore.set(key, record);
  return {
    allowed: record.count <= max,
    remaining: Math.max(0, max - record.count),
    retryAfterSec: Math.ceil((windowMs - (now - record.startTime)) / 1000)
  };
}

/**
 * Creates an Express rate limiter middleware.
 * @param {Object} options
 * @param {number} options.windowMs - Time window in milliseconds (default: 60000ms / 1 min)
 * @param {number} options.max - Max allowed requests per window (default: 20)
 * @param {string} options.message - Error message returned upon exceeding limit
 * @param {Function} options.keyGenerator - Optional additional per-request identifier (e.g. normalized email)
 * @param {number} options.secondaryMax - Optional max for secondary key
 */
function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60 * 1000;
  const max = options.max || 20;
  const message = options.message || 'Слишком много запросов. Пожалуйста, повторите попытку через минуту.';
  const keyGenerator = typeof options.keyGenerator === 'function' ? options.keyGenerator : null;
  const secondaryMax = options.secondaryMax || max;

  return (req, res, next) => {
    const ip = getClientIp(req);
    const routePrefix = `${req.baseUrl || ''}${req.path}`;
    const now = Date.now();

    const ipBucket = consumeBucket(`${routePrefix}:ip:${ip}`, windowMs, max, now);
    let secBucket = null;
    if (keyGenerator) {
      const secId = keyGenerator(req);
      if (secId) {
        secBucket = consumeBucket(`${routePrefix}:id:${secId}`, windowMs, secondaryMax, now);
      }
    }

    const effectiveRemaining = secBucket
      ? Math.min(ipBucket.remaining, secBucket.remaining)
      : ipBucket.remaining;

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', effectiveRemaining);

    if (!ipBucket.allowed || (secBucket && !secBucket.allowed)) {
      const retryAfterSec = Math.max(
        !ipBucket.allowed ? ipBucket.retryAfterSec : 0,
        secBucket && !secBucket.allowed ? secBucket.retryAfterSec : 0
      );
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        error: message,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: retryAfterSec
      });
    }

    next();
  };
}

module.exports = {
  createRateLimiter,
  loginRateLimiter: createRateLimiter({
    windowMs: 60 * 1000,
    max: 20,
    secondaryMax: 15,
    keyGenerator: (req) => {
      const email = req.body && req.body.email ? String(req.body.email).trim().toLowerCase() : '';
      return email || null;
    },
    message: 'Слишком много попыток входа. В целях безопасности подождите 1 минуту перед следующей попыткой.'
  }),
  twoFaRateLimiter: createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 10,
    message: 'Слишком много попыток ввода кода 2FA. Подождите 5 минут перед следующей попыткой.'
  })
};
