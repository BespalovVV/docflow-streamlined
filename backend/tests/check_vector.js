const db = require('../db');

async function check() {
  try {
    const res = await db.query("SELECT name, default_version FROM pg_available_extensions WHERE name = 'vector'");
    console.log('PG Vector available extension:', res.rows);

    const fts = await db.query("SELECT to_tsvector('russian', 'Договор об оказании услуг и поставке оборудования') AS tsv");
    console.log('Russian FTS test:', fts.rows[0].tsv);

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

check();
