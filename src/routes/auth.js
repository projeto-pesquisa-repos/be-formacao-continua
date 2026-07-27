const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const { getDb } = require('../database');
const { auth } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-key-for-testing-only';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'dev-google-client-id';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

/**
 * POST /api/auth/login
 * Email + password login.
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email e senha são obrigatórios' });
    }

    const db = getDb();
    const user = await db.prepare(`
      SELECT u.*, d.name as department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.email = ?
    `).get(email);

    if (!user) {
      return res.status(401).json({ success: false, error: 'Email ou senha incorretos' });
    }

    if (!user.password_hash) {
      return res.status(401).json({ success: false, error: 'Esta conta não possui senha configurada. Contate a coordenação.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Email ou senha incorretos' });
    }

    const token = generateToken(user);
    const { password_hash, google_id, ...safeUser } = user;

    return res.json({
      success: true,
      data: { token, user: safeUser },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * POST /api/auth/change-password
 * Change current user's password (requires auth).
 */
router.post('/change-password', auth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ success: false, error: 'Senha atual e nova senha são obrigatórias' });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ success: false, error: 'A nova senha deve ter no mínimo 6 caracteres' });
    }

    const db = getDb();
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    if (!user || !user.password_hash) {
      return res.status(400).json({ success: false, error: 'Usuário não possui senha configurada' });
    }

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Senha atual incorreta' });
    }

    const newHash = await bcrypt.hash(new_password, 10);
    await db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(newHash, req.user.id);
    db.save();

    return res.json({ success: true, data: { message: 'Senha alterada com sucesso' } });
  } catch (err) {
    console.error('Change password error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * POST /api/auth/google
 * Google OAuth login (kept for future use).
 */
router.post('/google', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Token do Google é obrigatório' });
    }

    const client = new OAuth2Client(GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    const db = getDb();
    let user = await db.prepare('SELECT * FROM users WHERE google_id = ?').get(payload.sub);

    if (!user) {
      const result = await db.prepare(
        'INSERT INTO users (google_id, email, name, avatar_url) VALUES (?, ?, ?, ?)'
      ).run(payload.sub, payload.email, payload.name, payload.picture);
      user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    }

    const jwtToken = generateToken(user);
    return res.json({
      success: true,
      data: { token: jwtToken, user }
    });
  } catch (err) {
    console.error('Google auth error:', err.message);
    return res.status(401).json({ success: false, error: 'Token do Google inválido' });
  }
});

/**
 * POST /api/auth/dev-login
 * Development-only login (kept for testing/seeds).
 */
router.post('/dev-login', async (req, res) => {
  try {
    const { email, name, role, department_id } = req.body;
    if (!email || !name) {
      return res.status(400).json({ success: false, error: 'Email e nome são obrigatórios' });
    }

    const db = getDb();
    let user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const googleId = user ? user.google_id : 'dev_' + email;

    if (!user) {
      const stmt = db.prepare(
        'INSERT INTO users (google_id, email, name, role, department_id) VALUES (?, ?, ?, ?, ?)'
      );
      const result = await stmt.run(googleId, email, name, role || null, department_id || null);
      user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    }

    const jwtToken = generateToken(user);
    return res.json({
      success: true,
      data: { token: jwtToken, user }
    });
  } catch (err) {
    console.error('Dev login error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * GET /api/auth/me
 * Returns current user info (requires auth).
 */
router.get('/me', auth, async (req, res) => {
  try {
    const db = getDb();
    const user = await db.prepare(`
      SELECT u.*, d.name as department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.id = ?
    `).get(req.user.id);

    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }

    // Don't expose sensitive fields
    const { google_id, password_hash, ...safeUser } = user;

    return res.json({ success: true, data: safeUser });
  } catch (err) {
    console.error('Me endpoint error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

module.exports = router;
