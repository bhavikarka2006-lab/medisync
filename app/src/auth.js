// App-level auth: bcrypt password hashes in PostgreSQL + signed JWTs (secret kept in Azure Key Vault).
// (Entra ID is not usable here: the college tenant blocks app registrations for students.)
const jwt = require('jsonwebtoken');
const ROLES = ['admin', 'doctor', 'nurse', 'patient'];

const signToken = (u, secret) => jwt.sign({ sub: u.id, role: u.role, email: u.email, name: u.name }, secret, { expiresIn: '8h' });

function buildAuth(cfg) {
  return (req, res, next) => {
    try {
      const c = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), cfg.jwtSecret, { algorithms: ['HS256'] });
      req.user = { id: c.sub, role: c.role, email: c.email, name: c.name };
      next();
    } catch (e) { res.status(401).json({ error: 'unauthenticated' }); }
  };
}

// RBAC guard. Denials become audit events -> Log Analytics (alert-able) + audit_log table (admin UI).
function requireRole(...roles) {
  return (req, res, next) => {
    if (roles.includes(req.user.role)) return next();
    audit(req, 'access_denied', { needed: roles });
    res.status(403).json({ error: 'forbidden' });
  };
}

// Structured JSON log line (Container Apps -> Log Analytics) + best-effort DB copy for the admin audit page
function audit(req, action, extra = {}) {
  const e = { ts: new Date().toISOString(), type: 'audit', action, actor: req.user && (req.user.email || req.user.id),
    role: req.user && req.user.role, path: req.originalUrl, ...extra };
  console.log(JSON.stringify(e));
  const sink = req.app && req.app.locals.auditSink;
  if (sink) sink(e);
}
module.exports = { ROLES, signToken, buildAuth, requireRole, audit };
