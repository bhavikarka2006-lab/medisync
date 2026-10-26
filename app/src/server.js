const cfg = require('./config');
const { createApp } = require('./app');
const { createDb } = require('./db');
const { createCloud } = require('./cloud');
const { seed } = require('./seed');
(async () => {
  const db = createDb(cfg);
  for (let i = 0; i < 15; i++) {                  // wait for PostgreSQL to accept connections
    try { await db.migrate(); await seed(db, cfg); break; }
    catch (e) { console.log('db not ready, retrying:', e.message); await new Promise((r) => setTimeout(r, 3000)); }
  }
  const cloud = createCloud(cfg, db);
  createApp({ db, cloud, config: cfg }).listen(cfg.port, () => console.log(`MediSync API on ${cfg.port}`));
})();
