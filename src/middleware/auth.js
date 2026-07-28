const { getDb } = require('../database');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-key-for-testing-only';

/**
 * JWT authentication middleware.
 * Extracts Bearer token from Authorization header, verifies it,
 * and sets req.user = { id, role, email, name }.
 * ALSO accepts x-device-id header to bypass JWT for mobile.
 */
async function auth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = {
        id: decoded.id,
        role: decoded.role,
        email: decoded.email,
        name: decoded.name
      };
      return next();
    }

    const deviceId = req.headers['x-device-id'];
    if (deviceId) {
      const db = getDb();
      const googleId = 'device:' + deviceId;
      const deviceHash = crypto.createHash('md5').update(deviceId).digest('hex').substring(0, 10);
      const email = `device_${deviceHash}@device.local`;

      let user = await db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);

      if (!user) {
        const result = await db.prepare(
          "INSERT INTO users (google_id, email, name, role) VALUES (?, ?, 'Docente Mobile', 'professor')"
        ).run(googleId, email);

        user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

        await db.prepare(
          'INSERT OR IGNORE INTO user_gamification (user_id, xp, level, streak) VALUES (?, 0, 1, 0)'
        ).run(user.id);

        db.save();
      } else if (user.role === 'coordenador') {
        await db.prepare("UPDATE users SET role = 'professor' WHERE id = ?").run(user.id);
        user.role = 'professor';
        db.save();
      }

      req.user = {
        id: user.id,
        role: 'professor',
        email: user.email,
        name: user.name
      };
      return next();
    }

    return res.status(401).json({ success: false, error: 'Token de autenticação não fornecido' });
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
