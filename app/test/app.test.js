const request = require('supertest');
const { createApp } = require('../src/app');
const { signToken } = require('../src/auth');

const config = { jwtSecret: 'test-secret' };
const tok = (role, id = 'u1') => ({ Authorization: `Bearer ${signToken({ id, role, email: `${role}@x.com`, name: role }, config.jwtSecret)}` });

function build(handler = async () => ({ rows: [] })) {
  const emitted = [];
  const db = { query: jest.fn(handler) };
  const cloud = { storage: {}, events: { emit: async (n, p) => emitted.push([n, p]) } };
  return { app: createApp({ db, cloud, config }), db, emitted };
}

test('health endpoint is public', async () => {
  expect((await request(build().app).get('/health')).body.status).toBe('ok');
});
test('no / bad token -> 401', async () => {
  const { app } = build();
  expect((await request(app).get('/api/me')).status).toBe(401);
  expect((await request(app).get('/api/me').set({ Authorization: 'Bearer nope' })).status).toBe(401);
});
test('register validates input', async () => {
  const r = await request(build().app).post('/api/auth/register').send({ name: 'A', email: 'bad', password: '123' });
  expect(r.status).toBe(400);
});
test('RBAC: patient cannot list patients or users', async () => {
  const { app } = build();
  expect((await request(app).get('/api/patients').set(tok('patient'))).status).toBe(403);
  expect((await request(app).get('/api/users').set(tok('doctor'))).status).toBe(403);
});
test('RBAC: doctor can list patients, admin can list users', async () => {
  const { app } = build();
  expect((await request(app).get('/api/patients').set(tok('doctor'))).status).toBe(200);
  expect((await request(app).get('/api/users').set(tok('admin'))).status).toBe(200);
});
test('booking emits queue event for the Azure Function', async () => {
  const { app, emitted } = build(async (sql) => {
    if (sql.includes('FROM patients')) return { rows: [{ id: 'p1' }] };
    if (sql.includes('INSERT INTO appointments')) return { rows: [{ id: 'a1' }] };
    return { rows: [] };
  });
  const r = await request(app).post('/api/appointments').set(tok('patient'))
    .send({ doctorId: 'd1', slot: new Date(Date.now() + 86400000).toISOString() });
  expect(r.status).toBe(202);
  expect(emitted[0]).toEqual(['appointment', { appointmentId: 'a1' }]);
});
test('double booking -> 409', async () => {
  const { app } = build(async (sql) => {
    if (sql.includes('FROM patients')) return { rows: [{ id: 'p1' }] };
    if (sql.includes('INSERT INTO appointments')) { const e = new Error('dup'); e.code = '23505'; throw e; }
    return { rows: [] };
  });
  const r = await request(app).post('/api/appointments').set(tok('patient'))
    .send({ doctorId: 'd1', slot: new Date(Date.now() + 86400000).toISOString() });
  expect(r.status).toBe(409);
});
test('past slot rejected', async () => {
  const r = await request(build().app).post('/api/appointments').set(tok('patient')).send({ doctorId: 'd1', slot: '2020-01-01T10:00:00Z' });
  expect(r.status).toBe(400);
});
test('bed already occupied -> 409', async () => {
  expect((await request(build().app).post('/api/beds/b1/assign').set(tok('nurse')).send({ patientId: 'p1' })).status).toBe(409);
});
test('patient cannot discharge', async () => {
  expect((await request(build().app).post('/api/admissions/x/discharge').set(tok('patient'))).status).toBe(403);
});
