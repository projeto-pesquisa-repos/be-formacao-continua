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

    // 1. Get the AI API key from settings OR environment variable
    let apiKey = process.env.XAI_API_KEY || '';

    // Try DB settings as additional source
    try {
      const apiKeySetting = db.prepare("SELECT value FROM settings WHERE key = 'grok_api_key'").get();
      if (apiKeySetting && apiKeySetting.value && apiKeySetting.value.trim() !== '') {
        apiKey = apiKeySetting.value.trim();
      }
    } catch (e) {
      // settings table might not exist yet, continue with env var
    }

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'Chave da API xAI Grok não configurada. Defina a variável de ambiente XAI_API_KEY ou configure grok_api_key nas configurações do sistema.',
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
    let areas = [];
    try {
      const areasResult = await db.prepare(`
        SELECT ac.name FROM areas_conhecimento ac
        JOIN departments d ON ac.department_id = d.id
        JOIN users u ON u.department_id = d.id
        WHERE u.id = ?
      `).all(professorId);
      areas = Array.isArray(areasResult) ? areasResult : [];
    } catch (e) {
      // Professor may not have a department
    }

    const areasStr = areas.map(a => a.name).join(', ') || 'Não definida';

    // 4. Get the professor's completed/registered formations
    let formations = [];
    try {
      const formResult = await db.prepare(`
        SELECT tipo, titulo, carga_horaria, data_conclusao, status
        FROM acoes_formativas
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 10
      `).all(professorId);
      formations = Array.isArray(formResult) ? formResult : [];
    } catch (e) {}

    const formationsStr = formations.length > 0
      ? formations.map(f => `- [${f.tipo}] ${f.titulo} (${f.status})`).join('\n')
      : 'Nenhuma formação registrada';

    // 5. Get overall trending areas in the institution (last year)
    let trends = [];
    try {
      const trendsResult = await db.prepare(`
        SELECT ac.name as area, COUNT(*) as total
        FROM acoes_formativas af
        JOIN areas_conhecimento ac ON af.area_conhecimento_id = ac.id
        WHERE af.created_at >= datetime('now', '-12 months')
          AND af.status = 'aprovado'
        GROUP BY ac.id
        ORDER BY total DESC
        LIMIT 5
      `).all();
      trends = Array.isArray(trendsResult) ? trendsResult : [];
    } catch (e) {}

    const trendsStr = trends.length > 0
      ? trends.map(t => `- ${t.area}: ${t.total} ações`).join('\n')
      : 'Sem dados de tendência disponíveis';

    // 6. Build the AI prompt
    const categories = [
      'Curso de extensão', 'Especialização', 'Seminário', 'Oficina prática',
      'Grupo de estudos', 'Mentoria', 'Curso online', 'Congresso',
      'Imersão', 'Residência pedagógica', 'Intercâmbio acadêmico'
    ];
    const rCategory = categories[Math.floor(Math.random() * categories.length)];

    const prompt = `Você é um consultor pedagógico experiente de uma instituição de ensino superior brasileira.

Sua tarefa: gerar UMA sugestão ORIGINAL e CONCISA de formação continuada para o professor descrito abaixo.

REGRAS OBRIGATÓRIAS:
1. A sugestão deve ser do tipo "${rCategory}" (ou similar).
2. NÃO use a palavra "workshop" na resposta.
3. A sugestão deve ser DIFERENTE das formações já feitas.
4. Foque em uma competência ou área que o professor AINDA NÃO explorou.
5. Seja específico: mencione nome do tema, carga horária sugerida e público-alvo.

Responda EXCLUSIVAMENTE no formato JSON abaixo, sem nenhum texto adicional:
{
  "titulo": "Nome da formação sugerida",
  "tipo": "Curso|Evento|Certificação|Capacitação",
  "carga_horaria": 20,
  "descricao": "Descrição detalhada da formação em 2-3 frases, explicando o conteúdo e a metodologia.",
  "justificativa": "Por que esta formação é relevante para este professor específico, em 1-2 frases."
}

DADOS DO PROFESSOR:
- Nome: ${professor.name}
- Departamento: ${professor.department_name || 'Não definido'}
- Áreas de Conhecimento: ${areasStr}

FORMAÇÕES JÁ REALIZADAS:
${formationsStr}

TENDÊNCIAS NA INSTITUIÇÃO:
${trendsStr}`;

    // 7. Call the Grok API
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'grok-4.5',
        temperature: 0.9,
        messages: [
          { role: 'system', content: 'Você é um consultor pedagógico criativo. Responda APENAS com JSON válido, sem markdown, sem explicações.' },
          { role: 'user', content: prompt }
        ],
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('xAI API Error:', response.status, errorData);
      const detail = errorData.error || errorData.message || JSON.stringify(errorData);
      return res.status(400).json({
        success: false,
        error: `Erro da API xAI (${response.status}): ${detail}`,
      });
    }

    const result = await response.json();
    const rawContent = result.choices[0]?.message?.content?.trim() || '';

    // Try to parse structured JSON response
    let suggestionData;
    try {
      // Strip markdown code fences if present
      const jsonStr = rawContent.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      suggestionData = JSON.parse(jsonStr);
    } catch (e) {
      // Fallback: use raw text as description
      suggestionData = {
        titulo: 'Sugestão de Formação',
        tipo: 'Curso',
        descricao: rawContent,
        justificativa: '',
        carga_horaria: null,
      };
    }

    const suggestion = suggestionData.descricao || rawContent;

    return res.json({
      success: true,
      data: {
        suggestion,
        titulo: suggestionData.titulo,
        tipo: suggestionData.tipo,
        carga_horaria: suggestionData.carga_horaria,
        descricao: suggestionData.descricao,
        justificativa: suggestionData.justificativa,
        professor_id: Number(professorId),
      }
    });
  } catch (err) {
    console.error('AI suggestion error:', err.message);

    return res.status(500).json({
      success: false,
      error: `Erro interno ao gerar sugestão: ${err.message}`,
    });
  }
});

module.exports = router;
