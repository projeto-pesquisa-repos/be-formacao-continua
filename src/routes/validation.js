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

    const { awardXP, checkActionBadges } = require('../services/gamification');
    const targetUserId = submission.user_id || submission.usuario_id;
    await awardXP(targetUserId, 150);
    await checkActionBadges(targetUserId);
    db.save();

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

    db.save();

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

/**
 * POST /api/validation/:id/change-status
 * Change status of an already validated (or pending) submission with justification.
 */
router.post('/:id/change-status', async (req, res) => {
  try {
    const { status, justificativa } = req.body;
    const { id } = req.params;

    if (!status || !['aprovado', 'rejeitado'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Status inválido. Use 'aprovado' ou 'rejeitado'"
      });
    }

    if (status === 'rejeitado' && (!justificativa || justificativa.trim() === '')) {
      return res.status(400).json({
        success: false,
        error: 'Justificativa é obrigatória para rejeitar uma submissão'
      });
    }

    const db = getDb();
    const submission = await db.prepare('SELECT * FROM acoes_formativas WHERE id = ?').get(id);

    if (!submission) {
      return res.status(404).json({ success: false, error: 'Submissão não encontrada' });
    }

    if (submission.status === status) {
      return res.status(400).json({
        success: false,
        error: `A submissão já possui o status '${status}'`
      });
    }

    const previousStatus = submission.status;
    const targetUserId = submission.user_id || submission.usuario_id;
    const { awardXP, checkActionBadges } = require('../services/gamification');

    if (status === 'rejeitado') {
      // If previous status was aprovado, deduct 150 XP (floored at 0)
      if (previousStatus === 'aprovado') {
        const stats = await db.prepare('SELECT xp FROM user_gamification WHERE user_id = ?').get(targetUserId);
        const currentXP = stats ? stats.xp : 0;
        const newXP = Math.max(0, currentXP - 150);
        const newLevel = Math.floor(newXP / 1000) + 1;

        await db.prepare('UPDATE user_gamification SET xp = ?, level = ? WHERE user_id = ?')
          .run(newXP, newLevel, targetUserId);
      }

      await db.prepare(`
        UPDATE acoes_formativas
        SET status = 'rejeitado',
            justificativa_rejeicao = ?,
            validado_por = ?,
            validado_em = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(justificativa ? justificativa.trim() : null, req.user.id, id);
    } else if (status === 'aprovado') {
      // If previous status was rejeitado or pendente, award 150 XP & check badges
      if (previousStatus !== 'aprovado') {
        await awardXP(targetUserId, 150);
        await checkActionBadges(targetUserId);
      }

      await db.prepare(`
        UPDATE acoes_formativas
        SET status = 'aprovado',
            justificativa_rejeicao = NULL,
            validado_por = ?,
            validado_em = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(req.user.id, id);
    }

    db.save();

    const updated = await db.prepare(`
      SELECT af.*, u.name as user_name, u.email as user_email
      FROM acoes_formativas af
      JOIN users u ON af.user_id = u.id
      WHERE af.id = ?
    `).get(id);

    return res.json({
      success: true,
      message: 'Status alterado com sucesso',
      data: updated
    });
  } catch (err) {
    console.error('Change status error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

module.exports = router;
