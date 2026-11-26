// backend/db/migrate.js
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function runMigrations() {
  console.log('[Migrations] Initializing migrations runner...');

  // Ensure migrations tracking table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const appliedRes = await db.query('SELECT version FROM schema_migrations');
  const appliedSet = new Set(appliedRes.rows.map(r => r.version));

  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('[Migrations] No migrations directory found.');
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let countApplied = 0;
  for (const file of files) {
    if (appliedSet.has(file)) {
      continue;
    }

    console.log(`[Migrations] Applying migration: ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

    await db.withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
    });

    console.log(`[Migrations] ✅ Successfully applied: ${file}`);
    countApplied++;
  }

  if (countApplied === 0) {
    console.log('[Migrations] Database schema is up to date.');
  } else {
    console.log(`[Migrations] Completed: ${countApplied} new migration(s) applied.`);
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Migrations] Fatal error during migration:', err);
      process.exit(1);
    });
}

module.exports = { runMigrations };
