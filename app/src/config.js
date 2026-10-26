module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',   // from Key Vault in Azure
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  seedDemo: process.env.SEED_DEMO === 'true',
  localStubs: process.env.LOCAL_STUBS === 'true',                      // local Docker: files on disk, events handled inline
  storageAccount: process.env.STORAGE_ACCOUNT,
  docsContainer: process.env.DOCS_CONTAINER || 'docs',
  queues: { appointment: 'appointment-events', invoice: 'invoice-events' },
  db: {
    host: process.env.DB_HOST || 'localhost', port: 5432,
    database: process.env.DB_NAME || 'medisync',
    user: process.env.DB_USER || 'medisync', password: process.env.DB_PASSWORD || 'medisync',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  },
};
