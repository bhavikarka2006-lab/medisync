// Timer trigger (NCRONTAB): every night at 00:00 IST (18:30 UTC) aggregate yesterday's activity for the admin dashboard.
const { app } = require('@azure/functions');
const { pool } = require('../shared');

app.timer('nightlyAnalytics', {
  schedule: '0 30 18 * * *',
  handler: async (timer, ctx) => {
    const { rows: [r] } = await pool.query(`
      WITH d AS (SELECT (now() - interval '1 day')::date AS day)
      INSERT INTO analytics_daily (day, appointments, admissions, occupancy_pct)
      SELECT d.day,
        (SELECT count(*) FROM appointments WHERE created_at::date = d.day),
        (SELECT count(*) FROM admissions WHERE admitted_at::date = d.day),
        COALESCE((SELECT 100.0 * count(*) FILTER (WHERE status='occupied') / NULLIF(count(*),0) FROM beds), 0)
      FROM d
      ON CONFLICT (day) DO UPDATE SET appointments=EXCLUDED.appointments, admissions=EXCLUDED.admissions, occupancy_pct=EXCLUDED.occupancy_pct
      RETURNING *`);
    ctx.log('analytics ' + JSON.stringify(r));
  },
});
