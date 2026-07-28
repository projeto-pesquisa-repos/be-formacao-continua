require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : '*',
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Static file serving for uploads
app.use('/api/files', express.static(uploadsDir));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/submissions', require('./routes/submissions'));
app.use('/api/validation', require('./routes/validation'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/gamification', require('./routes/gamification'));
app.use('/api/suggestions', require('./routes/suggestions'));
// Force seed endpoint
app.get('/api/force-seed', async (req, res) => {
  try {
    const { seed } = require('./seed');
    await seed({ skipInit: true });
    res.json({ success: true, message: 'Seed run successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'JSON inválido' });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, error: 'Arquivo muito grande. Limite: 10MB' });
  }

  return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
});

// Initialize database and start server
// Only start listening if this file is run directly (not imported by tests)
if (require.main === module) {
  initDb().then(async () => {
    // Auto-seed if database is empty (first deployment)
    const { getDb } = require('./database');
    const db = getDb();
    const userCount = await db.prepare('SELECT COUNT(*) as count FROM users').get();
    if (userCount && parseInt(userCount.count) === 0) {
      console.log('Empty database detected, running seed...');
      const { seed } = require('./seed');
      await seed({ skipInit: true });
      console.log('Auto-seed complete.');
    }

    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  }).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
}

// Export for testing
module.exports = app;
