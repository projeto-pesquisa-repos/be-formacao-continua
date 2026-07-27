const express = require('express');
const { getDb } = require('../database');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

// All analytics routes require authentication and coordinator role
router.use(auth);
router.use(requireRole('coordenador'));

/**
 * GET /api/analytics/coverage
 * Returns counts of approved actions grouped by department and area_conhecimento.
 * Supports ?period= filter (e.g., '2025', '2024-2025').
 */
router.get('/coverage', async (req, res) => {
  try {
    const db = getDb();
    const { period } = req.query;

    let dateFilter = '';
    const params = [];

    if (period) {
      if (period.includes('-') && period.length > 4) {
        const parts = period.split('-');
        dateFilter = "AND af.created_at >= ? AND af.created_at < ?";
        params.push(parts[0] + '-01-01');
        params.push((parseInt(parts[1]) + 1) + '-01-01');
      } else {
        dateFilter = "AND af.created_at >= ? AND af.created_at < ?";
        params.push(period + '-01-01');
        params.push((parseInt(period) + 1) + '-01-01');
      }
    }

    const coverage = await db.prepare(`
      SELECT
        d.id as department_id,
        d.name as department_name,
        ac.id as area_id,
        ac.name as area_name,
        COUNT(af.id) as total_acoes,
        SUM(CASE WHEN af.tipo = 'curso' THEN 1 ELSE 0 END) as cursos,
        SUM(CASE WHEN af.tipo = 'evento' THEN 1 ELSE 0 END) as eventos,
        SUM(CASE WHEN af.tipo = 'producao' THEN 1 ELSE 0 END) as producoes,
        SUM(COALESCE(af.carga_horaria, 0)) as total_horas
      FROM departments d
      LEFT JOIN areas_conhecimento ac ON ac.department_id = d.id
      LEFT JOIN acoes_formativas af ON af.area_conhecimento_id = ac.id
        AND af.status = 'aprovado' ${dateFilter}
      GROUP BY d.id, ac.id
      ORDER BY d.name, ac.name
    `).all(...params);

    return res.json({ success: true, data: coverage });
  } catch (err) {
    console.error('Coverage error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * GET /api/analytics/faculty-status
 */
router.get('/faculty-status', async (req, res) => {
  try {
    const db = getDb();
    const { department_id } = req.query;

    let deptFilter = '';
    const params = [];

    if (department_id) {
      deptFilter = 'AND u.department_id = ?';
      params.push(department_id);
    }

    const professors = await db.prepare(`
      SELECT
        u.id, u.name, u.email, u.department_id,
        d.name as department_name,
        MAX(af.validado_em) as last_approved_date,
        COUNT(af.id) as total_approved
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      LEFT JOIN acoes_formativas af ON af.user_id = u.id AND af.status = 'aprovado'
      WHERE u.role = 'professor' ${deptFilter}
      GROUP BY u.id
      ORDER BY u.name
    `).all(...params);

    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const twelveMonthsAgo = new Date(now);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const result = professors.map(prof => {
      let status;
      if (!prof.last_approved_date) {
        status = 'defasado';
      } else {
        const lastDate = new Date(prof.last_approved_date);
        if (lastDate >= twelveMonthsAgo && lastDate >= sixMonthsAgo) {
          status = 'ativo';
        } else if (lastDate >= twelveMonthsAgo) {
          status = 'atencao';
        } else {
          status = 'defasado';
        }
      }
      return { ...prof, status };
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('Faculty status error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * GET /api/analytics/summary
 */
router.get('/summary', async (req, res) => {
  try {
    const db = getDb();

    const profRes = await db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'professor'").get();
    const totalProfessors = profRes ? parseInt(profRes.count) : 0;

    const coordRes = await db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'coordenador'").get();
    const totalCoordinators = coordRes ? parseInt(coordRes.count) : 0;

    const deptRes = await db.prepare('SELECT COUNT(*) as count FROM departments').get();
    const totalDepartments = deptRes ? parseInt(deptRes.count) : 0;

    const submissionsByStatus = await db.prepare(`
      SELECT
        status,
        COUNT(*) as count
      FROM acoes_formativas
      GROUP BY status
    `).all();

    const subRes = await db.prepare('SELECT COUNT(*) as count FROM acoes_formativas').get();
    const totalSubmissions = subRes ? parseInt(subRes.count) : 0;

    const submissionsByTipo = await db.prepare(`
      SELECT
        tipo,
        COUNT(*) as count
      FROM acoes_formativas
      GROUP BY tipo
    `).all();

    const hrsRes = await db.prepare("SELECT COALESCE(SUM(carga_horaria), 0) as total FROM acoes_formativas WHERE status = 'aprovado'").get();
    const totalHoras = hrsRes ? parseInt(hrsRes.total) : 0;

    return res.json({
      success: true,
      data: {
        totalProfessors,
        totalCoordinators,
        totalDepartments,
        totalSubmissions,
        submissionsByStatus,
        submissionsByTipo,
        totalHoras
      }
    });
  } catch (err) {
    console.error('Summary error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * GET /api/analytics/professor-agenda
 */
router.get('/professor-agenda', async (req, res) => {
  try {
    const db = getDb();
    const { department_id } = req.query;

    let deptFilter = '';
    const params = [];

    if (department_id) {
      deptFilter = 'AND u.department_id = ?';
      params.push(department_id);
    }

    const professors = await db.prepare(`
      SELECT
        u.id, u.name, u.email, u.department_id,
        d.name as department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.role = 'professor' ${deptFilter}
      ORDER BY u.name
    `).all(...params);

    const result = await Promise.all(professors.map(async prof => {
      const currentFormations = await db.prepare(`
        SELECT id, tipo, titulo, status, carga_horaria, created_at
        FROM acoes_formativas
        WHERE user_id = ?
          AND (status = 'aprovado' OR status = 'pendente')
          AND created_at >= datetime('now', '-12 months')
        ORDER BY created_at DESC
        LIMIT 3
      `).all(prof.id);

      return {
        ...prof,
        current_formations: currentFormations,
        suggestion: null,
      };
    }));

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('Professor agenda error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

module.exports = router;
