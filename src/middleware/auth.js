const { getDb } = require('../database');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-key-for-testing-only';

/**
 * JWT authentication middleware.
 * Extracts Bearer token from Authorization header, verifies it,
 * and sets req.user = { id, role, email, name }.
 * ALSO accepts x-device-id header to bypass JWT for mobile.
 */
async function auth(req, res, next) {
  try {
    const deviceId = req.headers['x-device-id'];
    
    if (deviceId) {
      const db = getDb();
      let user = await db.prepare('SELECT * FROM users WHERE google_id = ?').get(deviceId);
      
      if (!user) {
        const email = `${deviceId.substring(0, 8)}@device.local`;
        const result = await db.prepare(
          "INSERT INTO users (google_id, email, name, role) VALUES (?, ?, 'Mobile User', 'student')"
        ).run(deviceId, email);
        user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
      }
      
      req.user = {
        id: user.id,
        role: user.role,
        email: user.email,
        name: user.name
      };
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Token de autenticação não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: decoded.id,
      role: decoded.role,
      email: decoded.email,
      name: decoded.name
    };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Token inválido ou expirado' });
  }
}

/**
 * Role-based authorization middleware.
 * Returns 403 if the authenticated user doesn't have the specified role.
 */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }
    if (req.user.role !== role) {
      return res.status(403).json({ success: false, error: 'Acesso negado. Requer papel: ' + role });
    }
    next();
  };
}

module.exports = { auth, requireRole };
