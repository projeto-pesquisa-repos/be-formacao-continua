const assert = require('assert');
const path = require('path');
const fs = require('fs');
const supertest = require('supertest');
const { initDb, closeDb, resetDb, getDb } = require('../src/database');

process.env.JWT_SECRET = 'test-secret-key-stress';
process.env.DB_PATH = path.join(__dirname, '..', 'test-stress.sqlite');

async function runStressTests() {
  resetDb();
  await initDb();

  const db = getDb();
  db.prepare('INSERT INTO departments (name) VALUES (?)').run('Dep');
  const deptId = db.prepare('SELECT id FROM departments ORDER BY id DESC LIMIT 1').get().id;
  db.prepare('INSERT INTO areas_conhecimento (name, department_id) VALUES (?, ?)').run('Area', deptId);
  const areaId = db.prepare('SELECT id FROM areas_conhecimento ORDER BY id DESC LIMIT 1').get().id;

  const app = require('../src/index');
  const request = supertest(app);

  const res = await request.post('/api/auth/dev-login')
    .send({ email: 'prof.stress@univ.edu.br', name: 'Prof Stress', role: 'professor', department_id: deptId });
  const token = res.body.data.token;

  console.log('--- STRESS TESTING BYPASS ---');

  // Original Submission
  const orig = await request.post('/api/submissions')
    .set('Authorization', `Bearer ${token}`)
    .field('tipo', 'evento')
    .field('titulo', 'Evento Original')
    .field('nome_evento', 'Congresso A')
    .field('area_conhecimento_id', String(areaId));
  assert.strictEqual(orig.status, 201);

  // 1. Double embedded spaces
  const doubleSpace = await request.post('/api/submissions')
    .set('Authorization', `Bearer ${token}`)
    .field('tipo', 'evento')
    .field('titulo', 'Evento  Original') // 2 spaces
    .field('nome_evento', 'Congresso A')
    .field('area_conhecimento_id', String(areaId));
  
  console.log('Double space status:', doubleSpace.status); // Expect 201 because of exact match bypass

  // 2. Tab character at start
  const origTab = await request.post('/api/submissions')
    .set('Authorization', `Bearer ${token}`)
    .field('tipo', 'evento')
    .field('titulo', '\tEvento Original')
    .field('nome_evento', 'Congresso B')
    .field('area_conhecimento_id', String(areaId));
  
  console.log('Leading tab status (should be 400 if fixed properly):', origTab.status); // Might be 201 if SQLite TRIM ignores tabs

  // 3. Newline character at end
  const origNewline = await request.post('/api/submissions')
    .set('Authorization', `Bearer ${token}`)
    .field('tipo', 'evento')
    .field('titulo', 'Evento Original\n')
    .field('nome_evento', 'Congresso C')
    .field('area_conhecimento_id', String(areaId));
  
  console.log('Trailing newline status:', origNewline.status);

  console.log('--- STRESS TEST COMPLETE ---');
}

runStressTests().then(() => {
  closeDb();
  process.exit(0);
}).catch(err => {
  console.error(err);
  closeDb();
  process.exit(1);
});
