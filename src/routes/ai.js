const express = require('express');
const { getDb } = require('../database');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(auth);
router.use(requireRole('coordenador'));

/**
 * POST /api/ai/suggest/:professorId
 * Generate an AI-powered formation suggestion for a professor.
 */
router.post('/suggest/:professorId', async (req, res) => {
  try {
    const { professorId } = req.params;
    const db = getDb();

    // 1. Get the AI API key from settings
    const apiKeySetting = db.prepare("SELECT value FROM settings WHERE key = 'grok_api_key'").get();
    if (!apiKeySetting || !apiKeySetting.value) {
      return res.status(400).json({
        success: false,
        error: 'Chave da API de IA não configurada. Acesse Configurações para inserir a chave.',
      });
    }

    // 2. Get professor data
    const professor = db.prepare(`
      SELECT u.id, u.name, u.email, d.name as department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.id = ? AND u.role = 'professor'
    `).get(professorId);

    if (!professor) {
      return res.status(404).json({ success: false, error: 'Professor não encontrado' });
    }

    // 3. Get the professor's area of knowledge (from their department)
    const areas = db.prepare(`
      SELECT ac.name FROM areas_conhecimento ac
      JOIN departments d ON ac.department_id = d.id
      JOIN users u ON u.department_id = d.id
      WHERE u.id = ?
    `).all(professorId);

    const areasStr = areas.map(a => a.name).join(', ') || 'Não definida';

    // 4. Get the professor's completed/registered formations
    const formations = db.prepare(`
      SELECT tipo, titulo, carga_horaria, data_conclusao, status
      FROM acoes_formativas
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(professorId);

    const formationsStr = formations.length > 0
      ? formations.map(f => `- [${f.tipo}] ${f.titulo} (${f.status})`).join('\n')
      : 'Nenhuma formação registrada';

    // 5. Get overall trending areas in the institution (last year)
    const trends = db.prepare(`
      SELECT ac.name as area, COUNT(*) as total
      FROM acoes_formativas af
      JOIN areas_conhecimento ac ON af.area_conhecimento_id = ac.id
      WHERE af.created_at >= datetime('now', '-12 months')
        AND af.status = 'aprovado'
      GROUP BY ac.id
      ORDER BY total DESC
      LIMIT 5
    `).all();

    const trendsStr = trends.length > 0
      ? trends.map(t => `- ${t.area}: ${t.total} ações`).join('\n')
      : 'Sem dados de tendência disponíveis';

    // 6. Build the AI prompt
    const prompt = `Você é um consultor pedagógico de uma instituição de ensino superior.
Gere UMA sugestão curta (máximo 2 frases) de formação continuada para o professor abaixo.
A sugestão deve ser prática, específica e baseada nas lacunas identificadas.
Responda APENAS com a sugestão, sem introduções ou explicações.

Professor: ${professor.name}
Departamento: ${professor.department_name || 'Não definido'}
Áreas de Conhecimento: ${areasStr}

Formações já realizadas:
${formationsStr}

Tendências de formação na instituição (último ano):
${trendsStr}

Sugestão:`;

    // 7. Call the Grok API
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKeySetting.value}`
      },
      body: JSON.stringify({
        model: 'grok-beta',
        messages: [
          { role: 'system', content: 'Você é um assistente útil e direto.' },
          { role: 'user', content: prompt }
        ],
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('xAI API Error:', errorData);
      if (response.status === 401 || response.status === 403) {
        return res.status(400).json({
          success: false,
          error: 'Chave da API inválida. Verifique a chave nas Configurações.',
        });
      }
      throw new Error(`xAI API responded with status ${response.status}`);
    }

    const result = await response.json();
    const suggestion = result.choices[0]?.message?.content?.trim() || 'Não foi possível gerar a sugestão.';

    return res.json({ success: true, data: { suggestion, professor_id: Number(professorId) } });
  } catch (err) {
    console.error('AI suggestion error:', err.message);

    return res.status(500).json({
      success: false,
      error: 'Erro ao gerar sugestão. Verifique a chave da API e tente novamente.',
    });
  }
});

module.exports = router;
