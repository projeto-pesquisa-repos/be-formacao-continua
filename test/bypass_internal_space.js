const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'test-secret-key-submissions';
process.env.DB_PATH = path.join(__dirname, '..', 'test-submissions-bypass.sqlite');

const { initDb, closeDb, resetDb, getDb } = require('../src/database');

async function testInternalSpaceBypass() {
  resetDb();
  await initDb();

  const db = getDb();
  db.prepare('INSERT INTO departments (name) VALUES (?)').run('Departamento Teste');
  const deptId = db.prepare('SELECT id FROM departments ORDER BY id DESC LIMIT 1').get().id;
  db.prepare('INSERT INTO areas_conhecimento (name, department_id) VALUES (?, ?)').run('Área Teste', deptId);
  const areaId = db.prepare('SELECT id FROM areas_conhecimento ORDER BY id DESC LIMIT 1').get().id;

  const app = require('../src/index');
  const supertest = require('supertest');
  const request = supertest(app);

  let professorToken;
  let professorUser;

  const res = await request.post('/api/auth/dev-login')
    .send({ email: 'prof.bypass@univ.edu.br', name: 'Professor Bypass', role: 'professor', department_id: deptId });
  professorToken = res.body.data.token;
  professorUser = res.body.data.user;

  // 1. Submit original
  const originalTitle = 'Evento Duplicado Teste';
  const firstRes = await request
    .post('/api/submissions')
    .set('Authorization', `Bearer ${professorToken}`)
    .field('tipo', 'evento')
    .field('titulo', originalTitle)
    .field('nome_evento', 'Congresso Teste Duplicado')
    .field('tipo_participacao', 'apresentador')
    .field('local_evento', 'Rio de Janeiro, RJ')
    .field('area_conhecimento_id', String(areaId));

  if (firstRes.status !== 201) throw new Error('First submission failed');

  // 2. Submit with internal space variation
  const bypassedTitle = 'Evento  Duplicado Teste'; // Two spaces
  const duplicateRes = await request
    .post('/api/submissions')
    .set('Authorization', `Bearer ${professorToken}`)
    .field('tipo', 'evento')
    .field('titulo', bypassedTitle)
    .field('nome_evento', 'Congresso Teste Duplicado 2')
    .field('tipo_participacao', 'ouvinte')
    .field('local_evento', 'São Paulo, SP')
    .field('area_conhecimento_id', String(areaId));

  if (duplicateRes.status === 201) {
    console.log('VULNERABILITY FOUND: Duplicate submission allowed with internal spaces');
    console.log(`Original: "${originalTitle}"`);
    console.log(`Bypass:   "${bypassedTitle}"`);
  } else {
    console.log('SECURE: Duplicate submission blocked');
  }

  // Cleanup
  closeDb();
  const dbPath = process.env.DB_PATH;
  try { fs.unlinkSync(dbPath); } catch(e) {}
  try { fs.unlinkSync(dbPath + '-wal'); } catch(e) {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch(e) {}
  process.exit(0);
}

testInternalSpaceBypass().catch(console.error);
