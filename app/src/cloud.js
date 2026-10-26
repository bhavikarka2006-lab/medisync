// Azure integrations: Blob Storage (private, short-lived user-delegation SAS URLs) and Storage Queues (events -> Azure Functions).
// Credentials come from the Container App's user-assigned Managed Identity: no keys or passwords in code.
// With LOCAL_STUBS=true (docker compose) files go to disk and events are handled inline so the whole flow works offline.
const fs = require('fs');
const path = require('path');

function createCloud(cfg, db) {
  if (cfg.localStubs) return localCloud(cfg, db);
  const { DefaultAzureCredential } = require('@azure/identity');
  const { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters } = require('@azure/storage-blob');
  const { QueueClient } = require('@azure/storage-queue');
  const cred = new DefaultAzureCredential();                      // picks up AZURE_CLIENT_ID (managed identity)
  const svc = new BlobServiceClient(`https://${cfg.storageAccount}.blob.core.windows.net`, cred);

  async function sas(key, perms) {
    const start = new Date(Date.now() - 60000), expiry = new Date(Date.now() + 10 * 60000);
    const udk = await svc.getUserDelegationKey(start, expiry);
    const q = generateBlobSASQueryParameters({ containerName: cfg.docsContainer, blobName: key,
      permissions: BlobSASPermissions.parse(perms), startsOn: start, expiresOn: expiry, protocol: 'https' }, udk, cfg.storageAccount);
    return `https://${cfg.storageAccount}.blob.core.windows.net/${cfg.docsContainer}/${encodeURI(key)}?${q}`;
  }
  const queue = (name) => new QueueClient(`https://${cfg.storageAccount}.queue.core.windows.net/${name}`, cred);
  const queues = { appointment: queue(cfg.queues.appointment), invoice: queue(cfg.queues.invoice) };

  return {
    storage: {
      uploadUrl: (key) => sas(key, 'cw'),
      downloadUrl: (key) => sas(key, 'r'),
      uploadHeaders: { 'x-ms-blob-type': 'BlockBlob' },
    },
    // Fire-and-forget: the request path never waits for emails/PDF generation
    events: { emit: (name, payload) => queues[name].sendMessage(JSON.stringify(payload)) },
  };
}

function localCloud(cfg, db) {
  const dir = process.env.LOCAL_DATA_DIR || path.join(require('os').tmpdir(), 'medisync-files');
  fs.mkdirSync(dir, { recursive: true });
  return {
    localDir: dir,
    storage: { uploadUrl: async (k) => `/local/${k}`, downloadUrl: async (k) => `/local/${k}`, uploadHeaders: {} },
    events: {
      async emit(name, p) {
        console.log(JSON.stringify({ type: 'local-event', name, p }));
        if (name === 'appointment') {
          await db.query(`UPDATE appointments SET status='confirmed' WHERE id=$1 AND status='pending'`, [p.appointmentId]);
        } else if (name === 'invoice') {
          const { rows: [a] } = await db.query('SELECT patient_id, admitted_at, discharged_at FROM admissions WHERE id=$1', [p.admissionId]);
          const days = Math.max(1, Math.ceil((new Date(a.discharged_at) - new Date(a.admitted_at)) / 86400000));
          const amount = days * 1500;
          const key = `invoices/${a.patient_id}/${p.admissionId}.txt`;
          fs.mkdirSync(path.dirname(path.join(dir, key)), { recursive: true });
          fs.writeFileSync(path.join(dir, key), `MediSync invoice (local demo)\nBed days: ${days} x INR 1500\nTotal: INR ${amount}\n`);
          await db.query('INSERT INTO invoices (admission_id,patient_id,amount,blob_key) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [p.admissionId, a.patient_id, amount, key]);
        }
      },
    },
  };
}
module.exports = { createCloud };
