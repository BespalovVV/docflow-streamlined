const db = require('../db');
const { appCache } = require('./cache');

const HIERARCHY_CACHE_TTL_MS = 60000;

function invalidateHierarchyCache() {
  appCache.invalidatePrefix('hierarchy:');
}

/**
 * Returns an array of IDs of all direct and indirect subordinates for a given user.
 * Includes cycle guard (path tracking + depth limit) and 60s TTL caching.
 */
async function getSubordinateUserIds(userId) {
  if (!userId) return [];
  const uid = parseInt(userId, 10);
  if (isNaN(uid)) return [];

  const cacheKey = `hierarchy:subs:${uid}`;
  const cached = appCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const query = `
    WITH RECURSIVE subordinates AS (
      SELECT id, ARRAY[id] AS path, 1 AS depth
      FROM users
      WHERE manager_id = $1 AND id != $1
      UNION ALL
      SELECT u.id, s.path || u.id, s.depth + 1
      FROM users u
      JOIN subordinates s ON u.manager_id = s.id
      WHERE NOT (u.id = ANY(s.path)) AND s.depth < 50
    )
    SELECT DISTINCT id FROM subordinates;
  `;
  const res = await db.query(query, [uid]);
  const ids = res.rows.map(r => r.id);
  appCache.set(cacheKey, ids, HIERARCHY_CACHE_TTL_MS);
  return ids;
}

/**
 * Returns an array of user objects representing direct subordinates with their info.
 */
async function getDirectSubordinates(userId) {
  if (!userId) return [];
  const query = `
    SELECT id, email, full_name, role, department, position, avatar_url
    FROM users
    WHERE manager_id = $1
    ORDER BY full_name ASC
  `;
  const res = await db.query(query, [userId]);
  return res.rows;
}

/**
 * Checks if targetUserId is a subordinate of managerUserId (direct or indirect).
 */
async function isSubordinate(managerUserId, targetUserId) {
  if (!managerUserId || !targetUserId) return false;
  if (parseInt(managerUserId, 10) === parseInt(targetUserId, 10)) return false;
  const subordinates = await getSubordinateUserIds(managerUserId);
  return subordinates.includes(parseInt(targetUserId, 10));
}

/**
 * Checks if proposedManagerId would create a cycle in the hierarchy
 * (i.e. proposedManagerId is the user themselves or is already a subordinate of userId).
 */
async function wouldCreateHierarchyCycle(userId, proposedManagerId) {
  if (!userId || !proposedManagerId) return false;
  if (parseInt(userId, 10) === parseInt(proposedManagerId, 10)) return true;
  // Читаем напрямую без кэша для гарантии актуальности при мутации
  invalidateHierarchyCache();
  const subordinates = await getSubordinateUserIds(userId);
  return subordinates.includes(parseInt(proposedManagerId, 10));
}

/**
 * Builds the complete organizational tree of users.
 */
async function getOrganizationTree() {
  const cacheKey = 'hierarchy:org_tree';
  const cached = appCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const usersRes = await db.query(`
    SELECT u.id, u.email, u.full_name, u.role, u.department, u.position, u.manager_id, u.avatar_url,
           m.full_name AS manager_name
    FROM users u
    LEFT JOIN users m ON u.manager_id = m.id
    ORDER BY u.department ASC, u.full_name ASC
  `);
  const allUsers = usersRes.rows;
  const userMap = new Map();
  allUsers.forEach(u => {
    userMap.set(u.id, { ...u, subordinates: [] });
  });

  const roots = [];
  allUsers.forEach(u => {
    const node = userMap.get(u.id);
    if (u.manager_id && userMap.has(u.manager_id) && u.manager_id !== u.id) {
      userMap.get(u.manager_id).subordinates.push(node);
    } else {
      roots.push(node);
    }
  });

  const tree = { roots, allUsers };
  appCache.set(cacheKey, tree, HIERARCHY_CACHE_TTL_MS);
  return tree;
}

async function canAccessProject(projectId, user) {
  if (!user) return false;
  const parsedProjectId = parseInt(projectId, 10);
  if (isNaN(parsedProjectId)) return false;
  const isAdmin = user.role === 'ADMIN' || user.role_code === 'admin';
  if (isAdmin) return true;

  const userId = parseInt(user.id, 10);
  const subIds = await getSubordinateUserIds(userId);
  const allowedIds = [userId, ...subIds];

  const res = await db.query(`
    SELECT 1
    FROM projects p
    LEFT JOIN directions d ON d.id = p.direction_id
    WHERE p.id = $1 AND (
      p.manager_id = ANY($2::int[])
      OR d.manager_id = ANY($2::int[])
      OR EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.project_id = p.id
          AND (t.assignee_id = ANY($2::int[]) OR t.creator_id = ANY($2::int[]))
      )
      OR EXISTS (
        SELECT 1 FROM project_materials pm
        WHERE pm.project_id = p.id AND pm.author_id = ANY($2::int[])
      )
    )
    LIMIT 1
  `, [parsedProjectId, allowedIds]);
  return res.rows.length > 0;
}

module.exports = {
  getSubordinateUserIds,
  getDirectSubordinates,
  isSubordinate,
  wouldCreateHierarchyCycle,
  getOrganizationTree,
  canAccessProject,
  invalidateHierarchyCache
};
