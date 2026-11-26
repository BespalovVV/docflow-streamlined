// backend/utils/cache.js
// Легковесный in-memory LRU/TTL кэш с защитой от утечки памяти и инвалидацией по префиксу

class TTLCache {
  constructor(options = {}) {
    this.defaultTtlMs = options.defaultTtlMs || 30000;
    this.maxSize = options.maxSize || 1000;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    // LRU touch: перемещаем в конец Map
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxSize) {
      // Удаляем самый старый (LRU) элемент
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  delete(key) {
    this.store.delete(key);
  }

  invalidatePrefix(prefix) {
    for (const key of this.store.keys()) {
      if (String(key).startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear() {
    this.store.clear();
  }

  size() {
    return this.store.size;
  }
}

const appCache = new TTLCache({ defaultTtlMs: 30000, maxSize: 2000 });

module.exports = {
  TTLCache,
  appCache
};
