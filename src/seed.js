require('dotenv').config();
const bcrypt = require('bcryptjs');

const { getDb, initDb, closeDb } = require('./database');

async function seed({ skipInit = false } = {}) {
  if (!skipInit) {
    console.log('Initializing database...');
    await initDb();
  }
  const db = getDb();

  console.log('Clearing existing data...');
  if (db.isPg) {
    await db.exec(`
      TRUNCATE TABLE acoes_formativas, user_badges, user_gamification, badges, users, areas_conhecimento, departments CASCADE;
    `);
  } else {
    db.exec(`
      DELETE FROM acoes_formativas;
      DELETE FROM user_badges;
      DELETE FROM user_gamification;
      DELETE FROM badges;
      DELETE FROM users;
      DELETE FROM areas_conhecimento;
      DELETE FROM departments;
    `);
    try {
      db.exec(`
        DELETE FROM sqlite_sequence WHERE name IN ('departments', 'areas_conhecimento', 'users', 'acoes_formativas');
      `);
    } catch (e) {}
  }

  console.log('Creating departments...');
  const insertDept = db.prepare('INSERT INTO departments (name) VALUES (?)');
  const deptExatas = (await insertDept.run('Ciências Exatas')).lastInsertRowid;
  const deptHumanas = (await insertDept.run('Ciências Humanas')).lastInsertRowid;
  const deptSaude = (await insertDept.run('Ciências da Saúde')).lastInsertRowid;

  console.log('Creating áreas de conhecimento...');
  const insertArea = db.prepare('INSERT INTO areas_conhecimento (name, department_id) VALUES (?, ?)');

  // Ciências Exatas
  await insertArea.run('Matemática', deptExatas);
  await insertArea.run('Física', deptExatas);
  await insertArea.run('Computação', deptExatas);

  // Ciências Humanas
  await insertArea.run('Pedagogia', deptHumanas);
  await insertArea.run('Psicologia', deptHumanas);
  await insertArea.run('História', deptHumanas);

  // Ciências da Saúde
  await insertArea.run('Enfermagem', deptSaude);
  await insertArea.run('Farmácia', deptSaude);
  await insertArea.run('Nutrição', deptSaude);

  const adminPassword = bcrypt.hashSync('admin', 10);

  console.log('Creating users...');
  const insertUser = db.prepare(`
    INSERT INTO users (google_id, email, name, password_hash, must_change_password, role, department_id) VALUES (?, ?, ?, ?, 0, ?, ?)
  `);

  // Admin User (admin@admin.com / admin)
  await insertUser.run('google_admin', 'admin@admin.com', 'Admin', adminPassword, 'coordenador', null);

  console.log('Creating badges...');
  const insertBadge = db.prepare('INSERT INTO badges (name, description, icon, requirement_type, requirement_value) VALUES (?, ?, ?, ?, ?)');
  await insertBadge.run('Primeiro Passo', 'Envie sua primeira submissão', 'star', 'level', 1);
  await insertBadge.run('Iniciante', 'Alcance o nível 2', 'target', 'level', 2);
  await insertBadge.run('Explorador', 'Registrou formações em 3 tipos diferentes', 'compass', 'types', 3);
  await insertBadge.run('Veterano', 'Alcançou Nível 5', 'award', 'level', 5);
  await insertBadge.run('Mestre dos Cursos', 'Registrou 5 cursos', 'book-open', 'curso', 5);
  await insertBadge.run('Pesquisador', 'Crie sua primeira produção', 'star', 'producao', 1);
  await insertBadge.run('Acadêmico', 'Registrou 3 produções acadêmicas', 'graduation-cap', 'producao', 3);
  await insertBadge.run('Especialista', 'Alcance o nível 10', 'trophy', 'level', 10);
  await insertBadge.run('Maratonista', 'Streak de 7 dias consecutivos', 'flame', 'streak', 7);
  await insertBadge.run('Dedicado', '30 dias consecutivos de streak', 'flame', 'streak', 30);
  await insertBadge.run('Centurião', 'Alcançou 100 horas de formação', 'clock', 'hours', 100);
  await insertBadge.run('Primeira Certificação', 'Registrou sua primeira certificação', 'award', 'certificacao', 1);
  await insertBadge.run('Elite', 'Alcançou 5000 XP', 'zap', 'xp', 5000);
  await insertBadge.run('Estudo Diário', 'Completou 24h totais de estudos', 'clock', 'hours', 24);

  console.log('Initializing user gamification...');
  await db.exec('INSERT INTO user_gamification (user_id, xp, level) SELECT id, 0, 1 FROM users;');

  // Count total
  const acoesRes = await db.prepare('SELECT COUNT(*) as count FROM acoes_formativas').get();
  const totalAcoes = acoesRes ? parseInt(acoesRes.count) : 0;

  const usersRes = await db.prepare('SELECT COUNT(*) as count FROM users').get();
  const totalUsers = usersRes ? parseInt(usersRes.count) : 0;

  const deptsRes = await db.prepare('SELECT COUNT(*) as count FROM departments').get();
  const totalDepts = deptsRes ? parseInt(deptsRes.count) : 0;

  console.log(`\nSeed completed successfully!`);
  console.log(`  Departments: ${totalDepts}`);
  console.log(`  Users: ${totalUsers}`);
  console.log(`  Ações Formativas: ${totalAcoes}`);

  if (!skipInit) {
    closeDb();
  }
}

module.exports = { seed };

// Auto-execute only when run directly (e.g., `node src/seed.js`)
if (require.main === module) {
  seed().catch(err => {
    console.error('Seed failed:', err.message);
    process.exit(1);
  });
}
