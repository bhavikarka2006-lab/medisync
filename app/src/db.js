const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
function createDb(cfg) {
  const pool = new Pool({ ...cfg.db, max: 5 });
  return {
    query: (t, p) => pool.query(t, p),
    migrate: () => pool.query(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8')),
  };
}
module.exports = { createDb };
