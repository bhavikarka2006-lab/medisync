// Triggered by a message on the "appointment-events" Storage Queue (sent by the API after a booking).
const { app } = require('@azure/functions');
const { pool, parse, notify } = require('../shared');

app.storageQueue('appointmentEvents', {
  queueName: 'appointment-events',
  connection: 'AzureWebJobsStorage',
  handler: async (msg, ctx) => {
    const { appointmentId } = parse(msg);
    // First-come conditional update: only a still-pending appointment gets confirmed
    const upd = await pool.query(`UPDATE appointments SET status='confirmed' WHERE id=$1 AND status='pending' RETURNING id`, [appointmentId]);
    if (!upd.rowCount) return ctx.log('skipped ' + appointmentId);
    const { rows: [a] } = await pool.query(
      `SELECT a.slot, a.reason, pu.name AS pname, pu.email AS pemail, du.name AS dname, du.email AS demail
         FROM appointments a JOIN patients p ON p.id=a.patient_id JOIN users pu ON pu.id=p.user_id
         JOIN doctors d ON d.id=a.doctor_id JOIN users du ON du.id=d.user_id WHERE a.id=$1`, [appointmentId]);
    const when = new Date(a.slot).toUTCString();
    await notify(ctx, 'MediSync: appointment confirmed',
      `Hello ${a.pname},\n\nYour appointment with ${a.dname} on ${when} is confirmed.\n\n- MediSync`, [a.pemail]);
    await notify(ctx, 'MediSync: new appointment', `${a.pname} booked ${when} with you.\nReason: ${a.reason || '-'}`, [a.demail]);
    ctx.log('confirmed ' + appointmentId);
  },
});
