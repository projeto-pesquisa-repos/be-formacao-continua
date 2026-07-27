const express = require('express');
const { getDb } = require('../database');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

// All validation routes require authentication and coordinator role
router.use(auth);
router.use(requireRole('coordenador'));

/**
 * GET /api/validation/pending
 * List all pending submissions with user info.
 */
router.get('/pending', async (req, res) => {
  try {
    const db = getDb();
    const submissions = await db.prepare(`
      SELECT af.*, u.name as user_name, u.email as user_email,
             ac.name as area_nome, d.name as department_name
      FROM acoes_formativas af
      JOIN users u ON af.user_id = u.id
      LEFT JOIN areas_conhecimento ac ON af.area_conhecimento_id = ac.id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE af.status = 'pendente'
      ORDER BY af.created_at ASC
    `).all();

    return res.json({ success: true, data: submissions });
  } catch (err) {
    console.error('List pending error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * POST /api/validation/:id/approve
 * Approve a submission.
 */
router.post('/:id/approve', async (req, res) => {
  try {
    const db = getDb();
    const submission = await db.prepare('SELECT * FROM acoes_formativas WHERE id = ?').get(req.params.id);

    if (!submission) {
      return res.status(404).json({ success: false, error: 'Submissão não encontrada' });
    }

    if (submission.status !== 'pendente') {
      return res.status(400).json({ success: false, error: 'Somente submissões pendentes podem ser aprovadas' });
    }

    await db.prepare(`
      UPDATE acoes_formativas
      SET status = 'aprovado',
          validado_por = ?,
          validado_em = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.user.id, req.params.id);

    const updated = await db.prepare(`
      SELECT af.*, u.name as user_name, u.email as user_email
      FROM acoes_formativas af
      JOIN users u ON af.user_id = u.id
      WHERE af.id = ?
    `).get(req.params.id);

    const { awardXP } = require('../services/gamification');
    await awardXP(submission.user_id, 150);

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Approve error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * POST /api/validation/:id/reject
 * Reject a submission with justification.
 */
router.post('/:id/reject', async (req, res) => {
  try {
    const { justificativa } = req.body;

    if (!justificativa || justificativa.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Justificativa é obrigatória para rejeitar uma submissão'
      });
    }

    const db = getDb();
    const submission = await db.prepare('SELECT * FROM acoes_formativas WHERE id = ?').get(req.params.id);

    if (!submission) {
      return res.status(404).json({ success: false, error: 'Submissão não encontrada' });
    }

    if (submission.status !== 'pendente') {
      return res.status(400).json({ success: false, error: 'Somente submissões pendentes podem ser rejeitadas' });
    }

    await db.prepare(`
      UPDATE acoes_formativas
      SET status = 'rejeitado',
          justificativa_rejeicao = ?,
          validado_por = ?,
          validado_em = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(justificativa, req.user.id, req.params.id);

    const updated = await db.prepare(`
      SELECT af.*, u.name as user_name, u.email as user_email
      FROM acoes_formativas af
      JOIN users u ON af.user_id = u.id
      WHERE af.id = ?
    `).get(req.params.id);

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Reject error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

module.exports = router;
