// Triggered on discharge: compute bill -> render PDF -> store in Blob Storage -> record in PostgreSQL -> email the patient.
const { app } = require('@azure/functions');
const PDFDocument = require('pdfkit');
const { BlobServiceClient } = require('@azure/storage-blob');
const { pool, parse, notify } = require('../shared');
const BED_RATE = 1500, CONSULT_FEE = 500;

app.storageQueue('invoiceEvents', {
  queueName: 'invoice-events',
  connection: 'AzureWebJobsStorage',
  handler: async (msg, ctx) => {
    const { admissionId } = parse(msg);
    const { rows: [a] } = await pool.query(
      `SELECT ad.id, ad.patient_id, ad.admitted_at, ad.discharged_at, u.name, u.email
         FROM admissions ad JOIN patients p ON p.id=ad.patient_id JOIN users u ON u.id=p.user_id WHERE ad.id=$1`, [admissionId]);
    if (!a) return ctx.warn('admission not found');
    const days = Math.max(1, Math.ceil((new Date(a.discharged_at) - new Date(a.admitted_at)) / 86400000));
    const { rows: [c] } = await pool.query(`SELECT count(*)::int n FROM appointments WHERE patient_id=$1 AND status IN ('confirmed','completed')`, [a.patient_id]);
    const amount = days * BED_RATE + c.n * CONSULT_FEE;

    const doc = new PDFDocument(); const chunks = [];
    doc.on('data', (d) => chunks.push(d));
    const done = new Promise((r) => doc.on('end', r));
    doc.fontSize(22).text('MediSync - Discharge Invoice').moveDown();
    doc.fontSize(12).text(`Patient: ${a.name}`).text(`Admission ID: ${a.id}`)
       .text(`Bed charges: ${days} day(s) x INR ${BED_RATE}`).text(`Consultations: ${c.n} x INR ${CONSULT_FEE}`)
       .moveDown().fontSize(15).text(`Total: INR ${amount}`);
    doc.end(); await done;

    const key = `invoices/${a.patient_id}/${a.id}.pdf`;
    const blob = BlobServiceClient.fromConnectionString(process.env.AzureWebJobsStorage)
      .getContainerClient(process.env.DOCS_CONTAINER || 'docs').getBlockBlobClient(key);
    await blob.uploadData(Buffer.concat(chunks), { blobHTTPHeaders: { blobContentType: 'application/pdf' } });
    await pool.query(`INSERT INTO invoices (admission_id, patient_id, amount, blob_key) VALUES ($1,$2,$3,$4) ON CONFLICT (admission_id) DO NOTHING`,
      [a.id, a.patient_id, amount, key]);
    await notify(ctx, 'MediSync: your invoice is ready', `Hello ${a.name}, your discharge invoice (INR ${amount}) is ready in your MediSync account.`, [a.email]);
    ctx.log(`invoice ${amount} stored at ${key}`);
  },
});
