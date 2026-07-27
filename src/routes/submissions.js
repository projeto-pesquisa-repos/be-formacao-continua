const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { auth } = require('../middleware/auth');

const router = express.Router();

function normalizeTitle(title) {
  if (!title) return '';
  return String(title)
    .normalize('NFD') // Decompose combined graphemes
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^\w\s]/g, '') // Remove punctuation and zero-width chars
    .replace(/\s+/g, ' ') // Collapse multiple whitespace
    .trim()
    .toLowerCase();
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = uuidv4() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, true); // Allow all file types in MVP
    }
  }
});

// All submission routes require authentication
router.use(auth);

/**
 * GET /api/submissions
 * List submissions. Professors see only their own, coordinators see all.
 * Query params: ?status=, ?tipo=, ?userId=
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const { status, tipo, userId } = req.query;

    let query = `
      SELECT af.*, u.name as user_name, u.email as user_email,
             ac.name as area_nome, d.name as department_name
      FROM acoes_formativas af
      JOIN users u ON af.user_id = u.id
      LEFT JOIN areas_conhecimento ac ON af.area_conhecimento_id = ac.id
      LEFT JOIN departments d ON u.department_id = d.id
    `;
    const conditions = [];
    const params = [];

    // Professors can only see their own submissions
    if (req.user.role !== 'coordenador') {
      conditions.push('af.user_id = ?');
      params.push(req.user.id);
    } else if (userId) {
      conditions.push('af.user_id = ?');
      params.push(userId);
    }

    if (status) {
      conditions.push('af.status = ?');
      params.push(status);
    }
    if (tipo) {
      conditions.push('af.tipo = ?');
      params.push(tipo);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY af.created_at DESC';

    const submissions = await db.prepare(query).all(...params);

    return res.json({ success: true, data: submissions });
  } catch (err) {
    console.error('List submissions error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * POST /api/submissions
 * Create new submission with multipart file upload.
 */
router.post('/', upload.single('arquivo'), async (req, res) => {
  try {
    const db = getDb();
    const {
      tipo, titulo, descricao,
      carga_horaria, instituicao_promotora, data_conclusao,
      tipo_participacao, nome_evento, local_evento,
      tipo_producao, doi_isbn,
      area_conhecimento_id
    } = req.body;

    // Validate required fields
    if (!tipo || !titulo) {
      return res.status(400).json({ success: false, error: 'Tipo e título são obrigatórios' });
    }

    if (typeof titulo !== 'string') {
      return res.status(400).json({ success: false, error: 'Título deve ser uma string' });
    }

    if (!['curso', 'evento', 'producao'].includes(tipo)) {
      return res.status(400).json({ success: false, error: 'Tipo inválido. Use: curso, evento ou producao' });
    }

    // Type-specific validation
    if (tipo === 'curso') {
      if (!carga_horaria || !instituicao_promotora) {
        return res.status(400).json({
          success: false,
          error: 'Cursos requerem carga_horaria e instituicao_promotora'
        });
      }
    } else if (tipo === 'evento') {
      if (!nome_evento) {
        return res.status(400).json({
          success: false,
          error: 'Eventos requerem nome_evento'
        });
      }
    } else if (tipo === 'producao') {
      if (!tipo_producao) {
        return res.status(400).json({
          success: false,
          error: 'Produções requerem tipo_producao'
        });
      }
    }

    // Normalize the title input string
    const normalizedTitulo = normalizeTitle(titulo);

    // Check for duplicate submission in memory
    const existingSubmissions = await db.prepare(`
      SELECT id, titulo FROM acoes_formativas 
      WHERE user_id = ? AND tipo = ?
    `).all(req.user.id, tipo);

    const duplicate = existingSubmissions.some(
      sub => normalizeTitle(sub.titulo) === normalizedTitulo
    );

    if (duplicate) {
      return res.status(400).json({ 
        success: false, 
        error: 'Você já possui uma submissão com este tipo e título' 
      });
    }

    const stmt = db.prepare(`
      INSERT INTO acoes_formativas (
        user_id, tipo, titulo, descricao,
        carga_horaria, instituicao_promotora, data_conclusao,
        tipo_participacao, nome_evento, local_evento,
        tipo_producao, doi_isbn,
        arquivo_path, arquivo_nome,
        area_conhecimento_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = await stmt.run(
      req.user.id,
      tipo,
      titulo,
      descricao || null,
      carga_horaria ? parseInt(carga_horaria) : null,
      instituicao_promotora || null,
      data_conclusao || null,
      tipo_participacao || null,
      nome_evento || null,
      local_evento || null,
      tipo_producao || null,
      doi_isbn || null,
      req.file ? req.file.filename : null,
      req.file ? req.file.originalname : null,
      area_conhecimento_id ? parseInt(area_conhecimento_id) : null
    );

    const submission = await db.prepare(`
      SELECT af.*, u.name as user_name, u.email as user_email
      FROM acoes_formativas af
      JOIN users u ON af.user_id = u.id
      WHERE af.id = ?
    `).get(result.lastInsertRowid);

    return res.status(201).json({ success: true, data: submission });
  } catch (err) {
    console.error('Create submission error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * GET /api/submissions/:id
 * Get single submission with user info.
 */
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const submission = await db.prepare(`
      SELECT af.*, u.name as user_name, u.email as user_email,
             ac.name as area_nome, d.name as department_name,
             v.name as validado_por_nome
      FROM acoes_formativas af
      JOIN users u ON af.user_id = u.id
      LEFT JOIN areas_conhecimento ac ON af.area_conhecimento_id = ac.id
      LEFT JOIN departments d ON u.department_id = d.id
      LEFT JOIN users v ON af.validado_por = v.id
      WHERE af.id = ?
    `).get(req.params.id);

    if (!submission) {
      return res.status(404).json({ success: false, error: 'Submissão não encontrada' });
    }

    // Professors can only see their own submissions
    if (req.user.role !== 'coordenador' && submission.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Acesso negado' });
    }

    return res.json({ success: true, data: submission });
  } catch (err) {
    console.error('Get submission error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * PUT /api/submissions/:id
 * Update submission (professor only, only if status='pendente').
 */
router.put('/:id', upload.single('arquivo'), async (req, res) => {
  try {
    const db = getDb();
    const submission = await db.prepare('SELECT * FROM acoes_formativas WHERE id = ?').get(req.params.id);

    if (!submission) {
      return res.status(404).json({ success: false, error: 'Submissão não encontrada' });
    }

    if (submission.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Acesso negado' });
    }

    if (submission.status !== 'pendente') {
      return res.status(400).json({ success: false, error: 'Somente submissões pendentes podem ser editadas' });
    }

    const {
      tipo, titulo, descricao,
      carga_horaria, instituicao_promotora, data_conclusao,
      tipo_participacao, nome_evento, local_evento,
      tipo_producao, doi_isbn,
      area_conhecimento_id
    } = req.body;

    const currentTipo = tipo || submission.tipo;
    const currentTitulo = titulo || submission.titulo;
    
    if (currentTitulo) {
      if (typeof currentTitulo !== 'string') {
        return res.status(400).json({ success: false, error: 'Título deve ser uma string' });
      }

      const normalizedTitulo = normalizeTitle(currentTitulo);

      const existingSubmissions = await db.prepare(`
        SELECT id, titulo FROM acoes_formativas 
        WHERE user_id = ? AND tipo = ? AND id != ?
      `).all(req.user.id, currentTipo, req.params.id);

      const duplicate = existingSubmissions.some(
        sub => normalizeTitle(sub.titulo) === normalizedTitulo
      );

      if (duplicate) {
        return res.status(400).json({
          success: false,
          error: 'Você já possui uma submissão com este tipo e título'
        });
      }
    }

    const stmt = db.prepare(`
      UPDATE acoes_formativas SET
        tipo = COALESCE(?, tipo),
        titulo = COALESCE(?, titulo),
        descricao = COALESCE(?, descricao),
        carga_horaria = COALESCE(?, carga_horaria),
        instituicao_promotora = COALESCE(?, instituicao_promotora),
        data_conclusao = COALESCE(?, data_conclusao),
        tipo_participacao = COALESCE(?, tipo_participacao),
        nome_evento = COALESCE(?, nome_evento),
        local_evento = COALESCE(?, local_evento),
        tipo_producao = COALESCE(?, tipo_producao),
        doi_isbn = COALESCE(?, doi_isbn),
        arquivo_path = COALESCE(?, arquivo_path),
        arquivo_nome = COALESCE(?, arquivo_nome),
        area_conhecimento_id = COALESCE(?, area_conhecimento_id),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    await stmt.run(
      tipo || null,
      titulo || null,
      descricao || null,
      carga_horaria ? parseInt(carga_horaria) : null,
      instituicao_promotora || null,
      data_conclusao || null,
      tipo_participacao || null,
      nome_evento || null,
      local_evento || null,
      tipo_producao || null,
      doi_isbn || null,
      req.file ? req.file.filename : null,
      req.file ? req.file.originalname : null,
      area_conhecimento_id ? parseInt(area_conhecimento_id) : null,
      req.params.id
    );

    const updated = await db.prepare(`
      SELECT af.*, u.name as user_name, u.email as user_email
      FROM acoes_formativas af
      JOIN users u ON af.user_id = u.id
      WHERE af.id = ?
    `).get(req.params.id);

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Update submission error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * DELETE /api/submissions/:id
 * Delete submission (professor only, only if status='pendente').
 */
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    const submission = await db.prepare('SELECT * FROM acoes_formativas WHERE id = ?').get(req.params.id);

    if (!submission) {
      return res.status(404).json({ success: false, error: 'Submissão não encontrada' });
    }

    if (submission.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Acesso negado' });
    }

    if (submission.status !== 'pendente') {
      return res.status(400).json({ success: false, error: 'Somente submissões pendentes podem ser excluídas' });
    }

    // Delete associated file if exists
    if (submission.arquivo_path) {
      const filePath = path.join(__dirname, '..', '..', 'uploads', submission.arquivo_path);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await db.prepare('DELETE FROM acoes_formativas WHERE id = ?').run(req.params.id);

    return res.json({ success: true, data: { message: 'Submissão excluída com sucesso' } });
  } catch (err) {
    console.error('Delete submission error:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

module.exports = router;
