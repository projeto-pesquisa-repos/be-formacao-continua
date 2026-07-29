const express = require('express');
const { getDb } = require('../database');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

// All suggestion routes require authentication
router.use(auth);

/**
 * POST /api/suggestions
 * Create a new formation suggestion (coordinator only).
 */
router.post('/', requireRole('coordenador'), async (req, res) => {
  try {
    const { title, description, tipo, target_professor_id, status } = req.body;

    if (!title || !tipo) {
      return res.status(400).json({
        success: false,
        error: 'Título e tipo são obrigatórios'
      });
    }

    let parsedTargetId = null;
    if (
      target_professor_id !== undefined &&
      target_professor_id !== null &&
      target_professor_id !== '' &&
      target_professor_id !== 'all' &&
      target_professor_id !== 'null'
    ) {
      const num = parseInt(target_professor_id, 10);
      if (!isNaN(num)) {
        parsedTargetId = num;
      }
    }

    const db = getDb();
    const result = await db.prepare(`
      INSERT INTO formation_suggestions (created_by, title, description, tipo, target_professor_id, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      title.trim(),
      description ? description.trim() : null,
      tipo.trim(),
      parsedTargetId,
      status || 'pending'
    );

    db.save();

    const newSuggestion = await db.prepare(`
      SELECT s.*, 
             u_creator.name as created_by_name,
             u_target.name as target_professor_name
      FROM formation_suggestions s
      LEFT JOIN users u_creator ON s.created_by = u_creator.id
      LEFT JOIN users u_target ON s.target_professor_id = u_target.id
      WHERE s.id = ?
    `).get(result.lastInsertRowid);

    return res.status(201).json({
      success: true,
      data: newSuggestion
    });
  } catch (err) {
    console.error('Create suggestion error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * GET /api/suggestions
 * List formation suggestions.
 * - Coordinator: returns all suggestions.
 * - Professor: returns suggestions where target_professor_id = user.id OR target_professor_id IS NULL.
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    let suggestions = [];

    if (req.user.role === 'coordenador') {
      suggestions = await db.prepare(`
        SELECT s.*, 
               u_creator.name as created_by_name,
               u_target.name as target_professor_name
        FROM formation_suggestions s
        LEFT JOIN users u_creator ON s.created_by = u_creator.id
        LEFT JOIN users u_target ON s.target_professor_id = u_target.id
        ORDER BY s.created_at DESC
      `).all();
    } else {
      suggestions = await db.prepare(`
        SELECT s.*, 
               u_creator.name as created_by_name,
               u_target.name as target_professor_name
        FROM formation_suggestions s
        LEFT JOIN users u_creator ON s.created_by = u_creator.id
        LEFT JOIN users u_target ON s.target_professor_id = u_target.id
        WHERE s.target_professor_id = ? OR s.target_professor_id IS NULL
        ORDER BY s.created_at DESC
      `).all(req.user.id);
    }

    return res.json({
      success: true,
      data: suggestions
    });
  } catch (err) {
    console.error('List suggestions error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * PUT /api/suggestions/:id
 * Update a suggestion's status (e.g., accept, reject, complete).
 * Professors can accept/reject their own suggestions.
 * Coordinators can update any suggestion.
 */
router.put('/:id', async (req, res) => {
  try {
    const db = getDb();
    const { status } = req.body;
    const { id } = req.params;

    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'Status é obrigatório',
      });
    }

    const validStatuses = ['pending', 'accepted', 'rejected', 'completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Status inválido. Use: pending, accepted, rejected ou completed',
      });
    }

    const suggestion = await db.prepare('SELECT * FROM formation_suggestions WHERE id = ?').get(id);
    if (!suggestion) {
      return res.status(404).json({ success: false, error: 'Sugestão não encontrada' });
    }

    // Professors can only update suggestions targeted to them
    if (req.user.role !== 'coordenador') {
      if (suggestion.target_professor_id !== null && suggestion.target_professor_id !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Acesso negado' });
      }
    }

    await db.prepare('UPDATE formation_suggestions SET status = ? WHERE id = ?').run(status, id);
    db.save();

    const updated = await db.prepare(`
      SELECT s.*, 
             u_creator.name as created_by_name,
             u_target.name as target_professor_name
      FROM formation_suggestions s
      LEFT JOIN users u_creator ON s.created_by = u_creator.id
      LEFT JOIN users u_target ON s.target_professor_id = u_target.id
      WHERE s.id = ?
    `).get(id);

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Update suggestion error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

module.exports = router;
