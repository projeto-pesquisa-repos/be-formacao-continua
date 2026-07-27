const express = require('express');
const { getDb } = require('../database');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/departments
 * List all departments with their areas (public, but requires auth).
 */
router.get('/', auth, async (req, res) => {
  try {
    const db = getDb();
    const departments = await db.prepare('SELECT * FROM departments ORDER BY name').all();

    // Attach areas to each department
    const getAreas = db.prepare('SELECT * FROM areas_conhecimento WHERE department_id = ? ORDER BY name');
    const result = await Promise.all(departments.map(async dept => ({
      ...dept,
      areas: await getAreas.all(dept.id)
    })));

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('List departments error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * POST /api/departments
 * Create department (coordinator only).
 */
router.post('/', auth, requireRole('coordenador'), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, error: 'Nome do departamento é obrigatório' });
    }

    const db = getDb();
    const result = await db.prepare('INSERT INTO departments (name) VALUES (?)').run(name.trim());
    const department = await db.prepare('SELECT * FROM departments WHERE id = ?').get(result.lastInsertRowid);

    return res.status(201).json({ success: true, data: { ...department, areas: [] } });
  } catch (err) {
    console.error('Create department error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * POST /api/departments/:id/areas
 * Add area to department (coordinator only).
 */
router.post('/:id/areas', auth, requireRole('coordenador'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, error: 'Nome da área é obrigatório' });
    }

    const db = getDb();
    const department = await db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
    if (!department) {
      return res.status(404).json({ success: false, error: 'Departamento não encontrado' });
    }

    const result = await db.prepare('INSERT INTO areas_conhecimento (name, department_id) VALUES (?, ?)').run(name.trim(), id);
    const area = await db.prepare('SELECT * FROM areas_conhecimento WHERE id = ?').get(result.lastInsertRowid);

    return res.status(201).json({ success: true, data: area });
  } catch (err) {
    console.error('Add area error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

module.exports = router;
