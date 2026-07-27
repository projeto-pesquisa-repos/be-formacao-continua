const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../database');
const { auth, requireRole } = require('../middleware/auth');
const { sendNewUserPassword } = require('../services/email');

const router = express.Router();

// All user routes require authentication
router.use(auth);

/**
 * Generate a random 8-character alphanumeric password.
 */
function generatePassword() {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * POST /api/users
 * Create a new professor (coordinator only).
 * Generates a random password, hashes it, stores it, and sends via email.
 */
router.post('/', requireRole('coordenador'), async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ success: false, error: 'Nome e email são obrigatórios' });
    }

    const db = getDb();

    // Check if email already exists
    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ success: false, error: 'Já existe um usuário com este email' });
    }

    // Generate random password and hash it
    const plainPassword = generatePassword();
    const passwordHash = await bcrypt.hash(plainPassword, 10);

    const googleId = 'manual_' + email;
    const result = await db.prepare(
      'INSERT INTO users (google_id, email, name, password_hash, must_change_password, role, department_id) VALUES (?, ?, ?, ?, 1, ?, ?)'
    ).run(googleId, email, name, passwordHash, 'professor', null);

    db.save();

    const newUser = await db.prepare(`
      SELECT u.id, u.email, u.name, u.avatar_url, u.role, u.department_id,
             u.created_at, d.name as department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.id = ?
    `).get(result.lastInsertRowid);

    // Send password via email
    const emailResult = await sendNewUserPassword(email, name, plainPassword);

    return res.status(201).json({
      success: true,
      data: {
        ...newUser,
        password_sent: emailResult.sent,
        email_error: emailResult.sent ? undefined : emailResult.reason,
        generated_password: emailResult.sent ? undefined : plainPassword,
      }
    });
  } catch (err) {
    console.error('Create user error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * GET /api/users
 * List all users with department info (coordinator only).
 */
router.get('/', requireRole('coordenador'), async (req, res) => {
  try {
    const db = getDb();
    const users = await db.prepare(`
      SELECT u.id, u.email, u.name, u.avatar_url, u.role, u.department_id,
             u.created_at, d.name as department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      ORDER BY u.name
    `).all();

    return res.json({ success: true, data: users });
  } catch (err) {
    console.error('List users error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * PATCH /api/users/:id
 * Update role and/or department_id (coordinator only).
 */
router.patch('/:id', requireRole('coordenador'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role, department_id } = req.body;

    const db = getDb();
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);

    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }

    // Validate role if provided
    if (role !== undefined && role !== null && !['professor', 'coordenador'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Papel inválido. Use: professor ou coordenador' });
    }

    // Build update dynamically
    const updates = [];
    const params = [];

    if (role !== undefined) {
      updates.push('role = ?');
      params.push(role);
    }
    if (department_id !== undefined) {
      updates.push('department_id = ?');
      params.push(department_id);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'Nenhum campo para atualizar' });
    }

    params.push(id);
    await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    db.save();

    const updatedUser = await db.prepare(`
      SELECT u.id, u.email, u.name, u.avatar_url, u.role, u.department_id,
             u.created_at, d.name as department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.id = ?
    `).get(id);

    return res.json({ success: true, data: updatedUser });
  } catch (err) {
    console.error('Update user error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

module.exports = router;
