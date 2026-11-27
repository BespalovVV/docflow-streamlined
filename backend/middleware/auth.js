const jwt = require('jsonwebtoken');
const db = require('../db');
const { appCache } = require('../utils/cache');

const DEFAULT_INSECURE_SECRET = 'docflow_secret_key_2026_super_secure';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_INSECURE_SECRET;
const USER_CACHE_TTL_MS = 30000;

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_DEV_SECRETS !== '1') {
  const isWeakSecret =
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET.length < 32 ||
    process.env.JWT_SECRET === DEFAULT_INSECURE_SECRET ||
    process.env.JWT_SECRET.includes('CHANGE_ME');
  if (isWeakSecret) {
    throw new Error('[SECURITY FATAL] JWT_SECRET must be explicitly set (>= 32 chars, non-default) in production.');
  }
}

function extractToken(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  if (req.method === 'GET' && req.query && req.query.token) {
    return req.query.token;
  }
  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)docflow_token=([^;]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

function invalidateUserCache(userId) {
  if (userId) {
    appCache.delete(`auth_user:${userId}`);
  } else {
    appCache.invalidatePrefix('auth_user:');
  }
}

async function getCachedUser(userId) {
  const cacheKey = `auth_user:${userId}`;
  const cached = appCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const userRes = await db.query(`
    SELECT u.id, u.email, u.full_name, u.role, u.department, u.role_id,
           COALESCE(u.token_version, 1) AS token_version,
           r.code AS role_code,
           COALESCE(
             (SELECT array_agg(p.code)
              FROM role_permissions rp
              JOIN permissions p ON rp.permission_id = p.id
              WHERE rp.role_id = u.role_id),
             ARRAY[]::text[]
           ) AS permissions
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    WHERE u.id = $1
  `, [userId]);

  if (userRes.rows.length === 0) {
    appCache.set(cacheKey, null, 5000);
    return null;
  }

  const row = userRes.rows[0];
  appCache.set(cacheKey, row, USER_CACHE_TTL_MS);
  return row;
}

function authenticateToken(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Доступ запрещен. Отсутствует токен авторизации.' });
  }

  jwt.verify(token, JWT_SECRET, async (err, decodedUser) => {
    if (err) {
      return res.status(403).json({ error: 'Недействительный или истекший токен.' });
    }

    if (decodedUser.purpose === '2fa_verify' || decodedUser.purpose === '2fa_setup') {
      return res.status(403).json({ error: 'Требуется завершить двухфакторную аутентификацию.' });
    }

    try {
      const freshUser = await getCachedUser(decodedUser.id);
      if (!freshUser) {
        return res.status(401).json({ error: 'Пользователь не найден в системе.' });
      }

      if (decodedUser.tv !== undefined && Number(decodedUser.tv) !== Number(freshUser.token_version || 1)) {
        return res.status(401).json({ error: 'Сессия завершена или отозвана. Войдите заново.' });
      }

      req.user = {
        ...decodedUser,
        email: freshUser.email,
        role: (freshUser.role || 'USER').toUpperCase(),
        role_id: freshUser.role_id || decodedUser.role_id,
        role_code: freshUser.role_code || decodedUser.role_code || (freshUser.role === 'ADMIN' ? 'admin' : 'employee'),
        department: freshUser.department,
        full_name: freshUser.full_name,
        token_version: Number(freshUser.token_version || 1),
        permissions: Array.isArray(freshUser.permissions) ? freshUser.permissions : []
      };
      next();
    } catch (dbErr) {
      console.error('[Auth Fail-Closed] Database error verifying user:', dbErr.message);
      return res.status(503).json({ error: 'Сервис авторизации временно недоступен.' });
    }
  });
}

function authenticateTokenOptional(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, JWT_SECRET, async (err, decodedUser) => {
    if (err) {
      req.user = null;
      return next();
    }
    if (decodedUser.purpose === '2fa_verify' || decodedUser.purpose === '2fa_setup') {
      req.user = null;
      return next();
    }
    try {
      const freshUser = await getCachedUser(decodedUser.id);
      if (freshUser) {
        if (decodedUser.tv !== undefined && Number(decodedUser.tv) !== Number(freshUser.token_version || 1)) {
          req.user = null;
        } else {
          req.user = {
            ...decodedUser,
            email: freshUser.email,
            role: (freshUser.role || 'USER').toUpperCase(),
            role_id: freshUser.role_id || decodedUser.role_id,
            role_code: freshUser.role_code || decodedUser.role_code || (freshUser.role === 'ADMIN' ? 'admin' : 'employee'),
            department: freshUser.department,
            full_name: freshUser.full_name,
            token_version: Number(freshUser.token_version || 1),
            permissions: Array.isArray(freshUser.permissions) ? freshUser.permissions : []
          };
        }
      } else {
        req.user = null;
      }
    } catch (dbErr) {
      req.user = null;
    }
    next();
  });
}

// Middleware: Admin Only Check (ADMIN role)
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Требуется авторизация.' });
  }
  if (req.user.role === 'ADMIN' || req.user.role_code === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Отказано в доступе. Действие доступно только Администратору.' });
}

// Middleware: Granular permission check compatible with ADMIN / USER and dynamic RBAC roles
const ADMIN_ONLY_PERMISSIONS = new Set([
  'users.manage',
  'roles.manage',
  'projects.create',
  'projects.edit',
  'projects.delete',
  'conferences.manage',
  'tasks.create',
  'tasks.delete',
  'documents.delete'
]);

function requirePermission(permissionCode) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Требуется авторизация.' });
    }

    // ADMIN always has full access to everything
    if (req.user.role === 'ADMIN' || req.user.role_code === 'admin') {
      return next();
    }

    // Для кастомных ролей (manager, viewer и т.д.) проверяем реальную матрицу role_permissions
    if (
      req.user.role_code &&
      req.user.role_code !== 'employee' &&
      Array.isArray(req.user.permissions) &&
      req.user.permissions.length > 0
    ) {
      if (req.user.permissions.includes(permissionCode)) {
        return next();
      }
      return res.status(403).json({
        error: `Отказано в доступе. Вашей роли не предоставлено право "${permissionCode}".`
      });
    }

    // Стандартная совместимость для роли USER / employee
    if (ADMIN_ONLY_PERMISSIONS.has(permissionCode)) {
      return res.status(403).json({
        error: `Отказано в доступе. Для действия "${permissionCode}" требуются права Администратора.`
      });
    }

    next();
  };
}

module.exports = {
  authenticateToken,
  authenticateTokenOptional,
  extractToken,
  invalidateUserCache,
  requireAdmin,
  requirePermission,
  JWT_SECRET
};
