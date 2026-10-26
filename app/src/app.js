const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { ROLES, signToken, buildAuth, requireRole, audit } = require('./auth');

function createApp({ db, cloud, config }) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../public')));
  app.locals.auditSink = (e) => db.query('INSERT INTO audit_log (actor,role,action,detail) VALUES ($1,$2,$3,$4)',
    [e.actor, e.role, e.action, JSON.stringify({ path: e.path, ...e })]).catch(() => {});

  app.get('/health', (req, res) => res.json({ status: 'ok' }));              // Docker/Container Apps probe + CI smoke test
  app.get('/config.json', (req, res) => res.json({ demo: !!config.seedDemo, adminHint: !!config.localStubs }));

  // Local-only file endpoints (docker compose): stand-in for Blob Storage SAS URLs
  if (config.localStubs && cloud.localDir) {
    const safe = (k) => { const p = path.join(cloud.localDir, k); return p.startsWith(cloud.localDir) ? p : null; };
    app.put('/local/*', express.raw({ type: '*/*', limit: '25mb' }), (req, res) => {
      const p = safe(req.params[0]); if (!p) return res.sendStatus(400);
      fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, req.body); res.sendStatus(201);
    });
    app.get('/local/*', (req, res) => { const p = safe(req.params[0]); p && fs.existsSync(p) ? res.download(p) : res.sendStatus(404); });
  }

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const staff = ['doctor', 'nurse', 'admin'];
  const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
  const q = (t, p) => db.query(t, p);

  // ---------- Auth ----------
  const auth = express.Router();
  auth.post('/register', wrap(async (req, res) => {
    const { name, email, password, phone } = req.body;
    if (!name || !validEmail(email) || !password || password.length < 8) return res.status(400).json({ error: 'name, valid email and password (min 8 chars) required' });
    try {
      const u = (await q(`INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,'patient') RETURNING id,name,email,role`,
        [name.trim(), email.toLowerCase(), await bcrypt.hash(password, 10)])).rows[0];
      await q('INSERT INTO patients (user_id, phone) VALUES ($1,$2)', [u.id, phone || null]);
      audit({ user: u, app, originalUrl: req.originalUrl }, 'registered');
      res.status(201).json({ token: signToken(u, config.jwtSecret), user: u });
    } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'email already registered' }); throw e; }
  }));
  auth.post('/login', wrap(async (req, res) => {
    const r = await q('SELECT id,name,email,role,password_hash FROM users WHERE email=$1', [String(req.body.email || '').toLowerCase()]);
    const u = r.rows[0];
    if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.password_hash))) {
      audit({ app, originalUrl: req.originalUrl }, 'login_failed', { email: req.body.email });
      return res.status(401).json({ error: 'invalid email or password' });
    }
    delete u.password_hash;
    audit({ user: u, app, originalUrl: req.originalUrl }, 'login');
    res.json({ token: signToken(u, config.jwtSecret), user: u });
  }));
  app.use('/api/auth', auth);

  // ---------- Authenticated API ----------
  const api = express.Router();
  api.use(buildAuth(config));

  api.get('/me', wrap(async (req, res) => {
    const p = await q('SELECT id,phone,blood_group FROM patients WHERE user_id=$1', [req.user.id]);
    const d = await q('SELECT id,department FROM doctors WHERE user_id=$1', [req.user.id]);
    res.json({ ...req.user, patient: p.rows[0] || null, doctor: d.rows[0] || null });
  }));
  api.patch('/me', requireRole('patient'), wrap(async (req, res) => {
    await q('UPDATE patients SET phone=$1, blood_group=$2 WHERE user_id=$3', [req.body.phone || null, req.body.bloodGroup || null, req.user.id]);
    res.json({ ok: true });
  }));

  // Users (admin)
  api.get('/users', requireRole('admin'), wrap(async (req, res) =>
    res.json((await q('SELECT id,name,email,role,created_at FROM users ORDER BY created_at DESC')).rows)));
  api.post('/users', requireRole('admin'), wrap(async (req, res) => {
    const { name, email, password, role, department } = req.body;
    if (!name || !validEmail(email) || !password || password.length < 8 || !ROLES.includes(role)) return res.status(400).json({ error: 'invalid input' });
    try {
      const u = (await q('INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id,name,email,role',
        [name, email.toLowerCase(), await bcrypt.hash(password, 10), role])).rows[0];
      if (role === 'doctor') await q('INSERT INTO doctors (user_id,department) VALUES ($1,$2)', [u.id, department || 'General Medicine']);
      if (role === 'patient') await q('INSERT INTO patients (user_id) VALUES ($1)', [u.id]);
      audit(req, 'user_created', { target: u.email, role });
      res.status(201).json(u);
    } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'email already exists' }); throw e; }
  }));

  // Doctors + slot availability
  api.get('/doctors', wrap(async (req, res) => res.json((await q(
    'SELECT d.id,u.name,u.email,d.department FROM doctors d JOIN users u ON u.id=d.user_id ORDER BY u.name')).rows)));
  api.get('/doctors/:id/booked', wrap(async (req, res) => {
    const r = await q(`SELECT slot FROM appointments WHERE doctor_id=$1 AND slot>=$2 AND slot<$3 AND status<>'cancelled'`,
      [req.params.id, req.query.from, req.query.to]);
    res.json(r.rows.map((x) => x.slot));
  }));

  // Appointments: UNIQUE partial index blocks double booking; a queue message lets an Azure Function confirm + email.
  api.post('/appointments', requireRole('patient'), wrap(async (req, res) => {
    const { doctorId, slot, reason } = req.body;
    if (!doctorId || !slot || isNaN(new Date(slot))) return res.status(400).json({ error: 'doctorId and slot required' });
    if (new Date(slot) < new Date()) return res.status(400).json({ error: 'slot is in the past' });
    const p = await q('SELECT id FROM patients WHERE user_id=$1', [req.user.id]);
    if (!p.rows.length) return res.status(400).json({ error: 'no patient profile' });
    try {
      const a = (await q('INSERT INTO appointments (patient_id,doctor_id,slot,reason) VALUES ($1,$2,$3,$4) RETURNING *',
        [p.rows[0].id, doctorId, slot, reason || null])).rows[0];
      await cloud.events.emit('appointment', { appointmentId: a.id });
      audit(req, 'appointment_booked', { id: a.id });
      res.status(202).json(a);
    } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'slot already booked' }); throw e; }
  }));
  api.get('/appointments', wrap(async (req, res) => {
    const base = `SELECT a.id,a.slot,a.status,a.reason,a.notes,du.name AS doctor,d.department,pu.name AS patient
                  FROM appointments a JOIN doctors d ON d.id=a.doctor_id JOIN users du ON du.id=d.user_id
                  JOIN patients p ON p.id=a.patient_id JOIN users pu ON pu.id=p.user_id`;
    const r = req.user.role === 'patient' ? await q(`${base} WHERE p.user_id=$1 ORDER BY a.slot DESC`, [req.user.id])
      : req.user.role === 'doctor' ? await q(`${base} WHERE d.user_id=$1 ORDER BY a.slot DESC`, [req.user.id])
      : await q(`${base} ORDER BY a.slot DESC LIMIT 300`);
    res.json(r.rows);
  }));
  api.patch('/appointments/:id', wrap(async (req, res) => {
    const { status, notes } = req.body;
    const r = await q(`SELECT a.id, d.user_id AS doc_user, p.user_id AS pat_user FROM appointments a
                       JOIN doctors d ON d.id=a.doctor_id JOIN patients p ON p.id=a.patient_id WHERE a.id=$1`, [req.params.id]);
    const a = r.rows[0]; if (!a) return res.status(404).json({ error: 'not found' });
    const role = req.user.role;
    const ok = (role === 'patient' && a.pat_user === req.user.id && status === 'cancelled')
      || (role === 'doctor' && a.doc_user === req.user.id && ['completed', 'cancelled'].includes(status))
      || ((role === 'admin' || role === 'nurse') && ['cancelled', 'completed'].includes(status));
    if (!ok) { audit(req, 'access_denied', { appt: a.id }); return res.status(403).json({ error: 'forbidden' }); }
    const u = await q('UPDATE appointments SET status=$1, notes=COALESCE($2,notes) WHERE id=$3 RETURNING *', [status, notes || null, a.id]);
    audit(req, 'appointment_' + status, { id: a.id });
    res.json(u.rows[0]);
  }));

  // Patients + medical files
  api.get('/patients', requireRole(...staff), wrap(async (req, res) => {
    const like = `%${req.query.q || ''}%`;
    audit(req, 'patients_listed');
    res.json((await q(`SELECT p.id,u.name,u.email,p.phone,p.blood_group FROM patients p JOIN users u ON u.id=p.user_id
                       WHERE u.name ILIKE $1 OR u.email ILIKE $1 ORDER BY u.name LIMIT 200`, [like])).rows);
  }));
  api.get('/patients/:id', requireRole(...staff), wrap(async (req, res) => {
    const p = (await q('SELECT p.id,u.name,u.email,p.phone,p.blood_group FROM patients p JOIN users u ON u.id=p.user_id WHERE p.id=$1', [req.params.id])).rows[0];
    if (!p) return res.status(404).json({ error: 'not found' });
    const appts = (await q(`SELECT a.id,a.slot,a.status,a.reason,a.notes,u.name AS doctor FROM appointments a JOIN doctors d ON d.id=a.doctor_id
                            JOIN users u ON u.id=d.user_id WHERE a.patient_id=$1 ORDER BY a.slot DESC`, [p.id])).rows;
    const records = (await q('SELECT id,kind,filename,created_at FROM records WHERE patient_id=$1 ORDER BY created_at DESC', [p.id])).rows;
    audit(req, 'patient_viewed', { patient: p.id });
    res.json({ ...p, appointments: appts, records });
  }));
  api.post('/patients/:id/records/upload-url', requireRole(...staff), wrap(async (req, res) => {
    const { filename, kind } = req.body;
    const key = `records/${req.params.id}/${Date.now()}-${String(filename || 'file').replace(/[^\w.-]/g, '_')}`;
    const r = await q('INSERT INTO records (patient_id,kind,filename,blob_key,uploaded_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [req.params.id, kind || 'report', filename, key, req.user.email]);
    audit(req, 'record_upload_url', { patient: req.params.id, key });
    res.json({ recordId: r.rows[0].id, url: await cloud.storage.uploadUrl(key), headers: cloud.storage.uploadHeaders });
  }));
  api.get('/records', wrap(async (req, res) => {
    const sel = `SELECT r.id,r.kind,r.filename,r.created_at FROM records r JOIN patients p ON p.id=r.patient_id`;
    if (req.user.role === 'patient') return res.json((await q(`${sel} WHERE p.user_id=$1 ORDER BY r.created_at DESC`, [req.user.id])).rows);
    if (!staff.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    res.json((await q(`${sel} WHERE r.patient_id=$1 ORDER BY r.created_at DESC`, [req.query.patientId])).rows);
  }));
  api.get('/records/:id/download-url', wrap(async (req, res) => {
    const r = (await q('SELECT r.blob_key, p.user_id FROM records r JOIN patients p ON p.id=r.patient_id WHERE r.id=$1', [req.params.id])).rows[0];
    if (!r) return res.status(404).json({ error: 'not found' });
    if (r.user_id !== req.user.id && !staff.includes(req.user.role)) { audit(req, 'access_denied', { record: req.params.id }); return res.status(403).json({ error: 'forbidden' }); }
    audit(req, 'record_download_url', { record: req.params.id });
    res.json({ url: await cloud.storage.downloadUrl(r.blob_key) });
  }));

  // Beds & admissions: conditional UPDATE guarantees a bed is never assigned twice
  api.get('/beds', requireRole(...staff), wrap(async (req, res) => res.json((await q(
    `SELECT b.id,b.ward,b.label,b.status,a.id AS admission_id,a.admitted_at,u.name AS patient_name
       FROM beds b LEFT JOIN admissions a ON a.bed_id=b.id AND a.discharged_at IS NULL
       LEFT JOIN patients p ON p.id=a.patient_id LEFT JOIN users u ON u.id=p.user_id ORDER BY b.ward,b.label`)).rows)));
  api.post('/beds', requireRole('admin'), wrap(async (req, res) => {
    const ward = String(req.body.ward || '').trim(); const count = Math.min(parseInt(req.body.count || 1, 10), 20);
    if (!ward) return res.status(400).json({ error: 'ward required' });
    const start = (await q('SELECT count(*)::int n FROM beds WHERE ward=$1', [ward])).rows[0].n;
    for (let i = 1; i <= count; i++) await q('INSERT INTO beds (ward,label) VALUES ($1,$2)', [ward, `${ward}-${start + i}`]);
    audit(req, 'beds_added', { ward, count });
    res.status(201).json({ added: count });
  }));
  api.post('/beds/:id/assign', requireRole('nurse', 'admin'), wrap(async (req, res) => {
    const u = await q(`UPDATE beds SET status='occupied' WHERE id=$1 AND status='free' RETURNING id`, [req.params.id]);
    if (!u.rows.length) return res.status(409).json({ error: 'bed not available' });
    const a = (await q('INSERT INTO admissions (patient_id,bed_id) VALUES ($1,$2) RETURNING *', [req.body.patientId, req.params.id])).rows[0];
    audit(req, 'bed_assigned', { bed: req.params.id, admission: a.id });
    res.status(201).json(a);
  }));
  api.post('/admissions/:id/discharge', requireRole('doctor', 'admin'), wrap(async (req, res) => {
    const d = await q('UPDATE admissions SET discharged_at=now() WHERE id=$1 AND discharged_at IS NULL RETURNING *', [req.params.id]);
    if (!d.rows.length) return res.status(404).json({ error: 'no active admission' });
    await q(`UPDATE beds SET status='free' WHERE id=$1`, [d.rows[0].bed_id]);
    await cloud.events.emit('invoice', { admissionId: d.rows[0].id });     // Azure Function builds the PDF invoice
    audit(req, 'discharged', { admission: d.rows[0].id });
    res.status(202).json(d.rows[0]);
  }));

  // Billing
  api.get('/invoices', requireRole('admin', 'patient'), wrap(async (req, res) => {
    const sel = `SELECT i.id,i.amount,i.created_at,i.blob_key IS NOT NULL AS has_file,u.name AS patient FROM invoices i
                 JOIN patients p ON p.id=i.patient_id JOIN users u ON u.id=p.user_id`;
    res.json((req.user.role === 'admin' ? await q(`${sel} ORDER BY i.created_at DESC`) : await q(`${sel} WHERE p.user_id=$1 ORDER BY i.created_at DESC`, [req.user.id])).rows);
  }));
  api.get('/invoices/:id/download-url', requireRole('admin', 'patient'), wrap(async (req, res) => {
    const r = (await q('SELECT i.blob_key,p.user_id FROM invoices i JOIN patients p ON p.id=i.patient_id WHERE i.id=$1', [req.params.id])).rows[0];
    if (!r) return res.status(404).json({ error: 'not found' });
    if (req.user.role !== 'admin' && r.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
    res.json({ url: await cloud.storage.downloadUrl(r.blob_key) });
  }));

  // Dashboard data
  api.get('/stats', wrap(async (req, res) => {
    if (req.user.role === 'patient') {
      const r = await q(`SELECT
        (SELECT count(*)::int FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE p.user_id=$1 AND a.slot>=now() AND a.status IN ('pending','confirmed')) AS upcoming,
        (SELECT count(*)::int FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE p.user_id=$1 AND a.status='completed') AS completed,
        (SELECT count(*)::int FROM records r JOIN patients p ON p.id=r.patient_id WHERE p.user_id=$1) AS records,
        (SELECT count(*)::int FROM invoices i JOIN patients p ON p.id=i.patient_id WHERE p.user_id=$1) AS invoices`, [req.user.id]);
      return res.json(r.rows[0]);
    }
    const s = (await q(`SELECT
      (SELECT count(*)::int FROM patients) AS patients, (SELECT count(*)::int FROM doctors) AS doctors,
      (SELECT count(*)::int FROM appointments WHERE slot::date = now()::date AND status<>'cancelled') AS today,
      (SELECT count(*)::int FROM appointments WHERE status='pending') AS pending,
      (SELECT count(*)::int FROM beds WHERE status='free') AS beds_free, (SELECT count(*)::int FROM beds WHERE status='occupied') AS beds_occupied,
      (SELECT COALESCE(sum(amount),0)::float FROM invoices) AS revenue`)).rows[0];
    s.trend = (await q(`SELECT to_char(d::date,'DD Mon') AS label,
        (SELECT count(*)::int FROM appointments a WHERE a.slot::date = d::date AND a.status<>'cancelled') AS value
        FROM generate_series(now()::date - 3, now()::date + 3, interval '1 day') d ORDER BY d`)).rows;
    res.json(s);
  }));
  api.get('/analytics', requireRole('admin'), wrap(async (req, res) => res.json((await q('SELECT * FROM analytics_daily ORDER BY day DESC LIMIT 14')).rows)));
  api.get('/audit', requireRole('admin'), wrap(async (req, res) => res.json((await q('SELECT id,ts,actor,role,action,detail FROM audit_log ORDER BY id DESC LIMIT 60')).rows)));

  app.use('/api', api);
  app.use((err, req, res, next) => { console.error(JSON.stringify({ type: 'error', msg: err.message })); res.status(500).json({ error: 'internal error' }); });
  return app;
}
module.exports = { createApp };
