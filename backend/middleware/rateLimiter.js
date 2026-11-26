// backend/middleware/rateLimiter.js - Zero-dependency in-memory sliding window rate limiter
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

/**
 * Creates an Express rate limiter middleware.
 * @param {Object} options
 * @param {number} options.windowMs - Time window in milliseconds (default: 60000ms / 1 min)
 * @param {number} options.max - Max allowed requests per window (default: 20)
 * @param {string} options.message - Error message returned upon exceeding limit
 */
function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60 * 1000;
  const max = options.max || 20;
  const message = options.message || 'Слишком много запросов. Пожалуйста, повторите попытку через минуту.';

  return (req, res, next) => {
    // Extract client IP (handling X-Forwarded-For if behind reverse proxy/Docker)
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    const key = `${req.baseUrl || ''}${req.path}:${ip}`;
    const now = Date.now();

    let record = rateLimitStore.get(key);
    if (!record || (now - record.startTime > windowMs)) {
      record = { count: 1, startTime: now, windowMs };
    } else {
      record.count++;
    }

    rateLimitStore.set(key, record);

    const remaining = Math.max(0, max - record.count);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);

    if (record.count > max) {
      const retryAfterSec = Math.ceil((windowMs - (now - record.startTime)) / 1000);
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
    message: 'Слишком много попыток входа с вашего IP-адреса. В целях безопасности подождите 1 минуту перед следующей попыткой.'
  }),
  twoFaRateLimiter: createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 10,
    message: 'Слишком много попыток ввода кода 2FA. Подождите 5 минут перед следующей попыткой.'
  })
};

