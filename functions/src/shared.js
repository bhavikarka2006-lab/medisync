// Shared helpers for all Functions. Secrets arrive as app settings (Key Vault references resolved by the platform).
const { Pool } = require('pg');
const { EmailClient } = require('@azure/communication-email');

const pool = new Pool({
  host: process.env.DB_HOST, database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, port: 5432, max: 2, ssl: { rejectUnauthorized: false },
});
const parse = (m) => (typeof m === 'string' ? JSON.parse(m) : m);

// Email via Azure Communication Services (replaces SNS). Failures never break the main flow.
async function notify(ctx, subject, text, recipients) {
  const to = [...new Set([...(recipients || []), ...(process.env.NOTIFY_EMAILS || '').split(',')])].filter(Boolean);
  if (!process.env.ACS_CONNECTION_STRING || !to.length) return;
  try {
    const client = new EmailClient(process.env.ACS_CONNECTION_STRING);
    await client.beginSend({ senderAddress: process.env.SENDER_ADDRESS, content: { subject, plainText: text },
      recipients: { to: to.map((address) => ({ address })) } });
  } catch (e) { ctx.warn('email failed: ' + e.message); }
}
module.exports = { pool, parse, notify };
