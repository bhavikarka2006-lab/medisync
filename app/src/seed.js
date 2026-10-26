// Seeds the admin account (from env / Key Vault) and, optionally, demo data so the UI is populated.
const bcrypt = require('bcryptjs');

async function addUser(db, { name, email, password, role, department, phone }) {
  const hash = await bcrypt.hash(password, 10);
  const r = await db.query(
    `INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING RETURNING id`,
    [name, email.toLowerCase(), hash, role]);
  if (!r.rows.length) return null;
  const id = r.rows[0].id;
  if (role === 'doctor') await db.query('INSERT INTO doctors (user_id, department) VALUES ($1,$2)', [id, department]);
  if (role === 'patient') await db.query('INSERT INTO patients (user_id, phone) VALUES ($1,$2)', [id, phone || null]);
  return id;
}

async function seed(db, cfg) {
  if (cfg.adminEmail && cfg.adminPassword)
    await addUser(db, { name: 'Administrator', email: cfg.adminEmail, password: cfg.adminPassword, role: 'admin' });
  if (!cfg.seedDemo) return;
  const docs = [['Dr. Ananya Rao', 'dr.rao@medisync.local', 'Cardiology'], ['Dr. Vikram Shah', 'dr.shah@medisync.local', 'Orthopedics'],
                ['Dr. Meera Iyer', 'dr.iyer@medisync.local', 'Pediatrics'], ['Dr. Karthik Reddy', 'dr.reddy@medisync.local', 'General Medicine']];
  for (const [name, email, department] of docs) await addUser(db, { name, email, password: 'Doctor@123', role: 'doctor', department });
  await addUser(db, { name: 'Nurse Priya', email: 'nurse@medisync.local', password: 'Nurse@123', role: 'nurse' });
  await addUser(db, { name: 'Rohith Varma', email: 'patient@medisync.local', password: 'Patient@123', role: 'patient', phone: '+919999900001' });
  await addUser(db, { name: 'Bhavesh Reddy', email: 'patient2@medisync.local', password: 'Patient@123', role: 'patient' });
  const { rows: [{ n }] } = await db.query('SELECT count(*)::int n FROM beds');
  if (n === 0) {
    for (const [ward, count] of [['ICU', 4], ['General', 6], ['Maternity', 4]])
      for (let i = 1; i <= count; i++) await db.query('INSERT INTO beds (ward,label) VALUES ($1,$2)', [ward, `${ward}-${i}`]);
  }
}
module.exports = { seed, addUser };
