const express = require('express');
const { getDb } = require('../database');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

// All settings routes require coordinator role
router.use(auth);
router.use(requireRole('coordenador'));

/**
 * GET /api/settings
 * Returns all settings (values are masked for sensitive keys).
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const settings = await db.prepare('SELECT key, value, updated_at FROM settings').all();

    // Mask sensitive values
    const masked = settings.map(s => ({
      ...s,
      value: s.key.includes('api_key')
        ? (s.value ? '••••••••' + s.value.slice(-4) : '')
        : s.value,
    }));

    return res.json({ success: true, data: masked });
  } catch (err) {
    console.error('Get settings error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * PUT /api/settings/:key
 * Create or update a setting.
 */
router.put('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined || value === null) {
      return res.status(400).json({ success: false, error: 'Valor é obrigatório' });
    }

    const db = getDb();
    const existing = await db.prepare('SELECT key FROM settings WHERE key = ?').get(key);

    if (existing) {
      await db.prepare('UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?').run(value, key);
    } else {
      await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
    }

    db.save();

    return res.json({
      success: true,
      data: {
        key,
        value: key.includes('api_key') ? '••••••••' + value.slice(-4) : value,
      }
    });
  } catch (err) {
    console.error('Update setting error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

module.exports = router;
