/**
 * Suggestions tests for Formação Continuada Docente backend
 * Run: node test/suggestions.test.js
 */
const assert = require('assert');
const path = require('path');

// Set test environment
process.env.JWT_SECRET = 'test-secret-key-suggestions';
process.env.DB_PATH = path.join(__dirname, '..', 'test-suggestions.sqlite');

const { initDb, closeDb, resetDb } = require('../src/database');

let professorAToken, professorAUser;
let professorBToken, professorBUser;
let coordinatorToken, coordinatorUser;

async function runTests() {
  resetDb();
  await initDb();

  const app = require('../src/index');
  const supertest = require('supertest');
  const request = supertest(app);

  console.log('=== Suggestions Tests ===\n');

  // Setup users via dev-login
  {
    const resA = await request
      .post('/api/auth/dev-login')
      .send({ email: 'profA@univ.edu.br', name: 'Professor A', role: 'professor' });
    professorAToken = resA.body.data.token;
    professorAUser = resA.body.data.user;

    const resB = await request
      .post('/api/auth/dev-login')
      .send({ email: 'profB@univ.edu.br', name: 'Professor B', role: 'professor' });
    professorBToken = resB.body.data.token;
    professorBUser = resB.body.data.user;

    const resCoord = await request
      .post('/api/auth/dev-login')
      .send({ email: 'coord@univ.edu.br', name: 'Coordenador Principal', role: 'coordenador' });
    coordinatorToken = resCoord.body.data.token;
    coordinatorUser = resCoord.body.data.user;
  }

  // Test 1: Unauthenticated requests return 401
  {
    console.log('Test 1: Unauthenticated requests return 401...');
    const getRes = await request.get('/api/suggestions');
    assert.strictEqual(getRes.status, 401, `Expected 401, got ${getRes.status}`);

    const postRes = await request
      .post('/api/suggestions')
      .send({ title: 'Curso de IA', tipo: 'Curso' });
    assert.strictEqual(postRes.status, 401, `Expected 401, got ${postRes.status}`);
    console.log('  ✓ PASSED\n');
  }

  // Test 2: Professor attempting to create a suggestion receives 403
  {
    console.log('Test 2: Professor creating suggestion receives 403...');
    const res = await request
      .post('/api/suggestions')
      .set('Authorization', `Bearer ${professorAToken}`)
      .send({ title: 'Curso Proibido', tipo: 'Curso' });
    assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}`);
    assert.strictEqual(res.body.success, false);
    console.log('  ✓ PASSED\n');
  }

  // Test 3: Validation fails when title or tipo is missing (400)
  {
    console.log('Test 3: Validation fails when title or tipo is missing...');
    const resNoTitle = await request
      .post('/api/suggestions')
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({ tipo: 'Curso', description: 'Sem titulo' });
    assert.strictEqual(resNoTitle.status, 400, `Expected 400, got ${resNoTitle.status}`);

    const resNoTipo = await request
      .post('/api/suggestions')
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({ title: 'Sem tipo', description: 'Descrição' });
    assert.strictEqual(resNoTipo.status, 400, `Expected 400, got ${resNoTipo.status}`);
    console.log('  ✓ PASSED\n');
  }

  let suggestionAllId;
  let suggestionProfAId;
  let suggestionProfBId;

  // Test 4: Coordinator creates a suggestion for ALL professors (target_professor_id is null/all)
  {
    console.log('Test 4: Coordinator creates suggestion for ALL professors...');
    const res = await request
      .post('/api/suggestions')
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({
        title: 'WorkShop Pedagógico Geral',
        description: 'Capacitação pedagógica para todo o corpo docente',
        tipo: 'Capacitação',
        target_professor_id: 'all'
      });
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.title, 'WorkShop Pedagógico Geral');
    assert.strictEqual(res.body.data.tipo, 'Capacitação');
    assert.strictEqual(res.body.data.created_by, coordinatorUser.id);
    assert.strictEqual(res.body.data.target_professor_id, null, 'target_professor_id should be null for all');
    assert.strictEqual(res.body.data.status, 'pending');

    suggestionAllId = res.body.data.id;
    console.log('  ✓ PASSED\n');
  }

  // Test 5: Coordinator creates suggestions targeted at Professor A and Professor B
  {
    console.log('Test 5: Coordinator creates targeted suggestions for Professor A and Professor B...');
    const resA = await request
      .post('/api/suggestions')
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({
        title: 'Especialização em Redes',
        description: 'Foco em redes de computadores para Prof A',
        tipo: 'Curso',
        target_professor_id: professorAUser.id
      });
    assert.strictEqual(resA.status, 201);
    assert.strictEqual(resA.body.data.target_professor_id, professorAUser.id);
    suggestionProfAId = resA.body.data.id;

    const resB = await request
      .post('/api/suggestions')
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({
        title: 'Certificação AWS Cloud',
        description: 'Foco em nuvem para Prof B',
        tipo: 'Certificação',
        target_professor_id: String(professorBUser.id)
      });
    assert.strictEqual(resB.status, 201);
    assert.strictEqual(resB.body.data.target_professor_id, professorBUser.id);
    suggestionProfBId = resB.body.data.id;

    console.log('  ✓ PASSED\n');
  }

  // Test 6: Coordinator GET /api/suggestions returns all suggestions
  {
    console.log('Test 6: Coordinator GET /api/suggestions returns all suggestions...');
    const res = await request
      .get('/api/suggestions')
      .set('Authorization', `Bearer ${coordinatorToken}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.data));
    assert.strictEqual(res.body.data.length, 3, 'Coordinator should see 3 suggestions');

    const ids = res.body.data.map(s => s.id);
    assert.ok(ids.includes(suggestionAllId));
    assert.ok(ids.includes(suggestionProfAId));
    assert.ok(ids.includes(suggestionProfBId));
    console.log('  ✓ PASSED\n');
  }

  // Test 7: Professor A GET /api/suggestions returns suggestions for ALL and for Prof A, but not Prof B
  {
    console.log('Test 7: Professor A GET /api/suggestions returns only matching suggestions...');
    const res = await request
      .get('/api/suggestions')
      .set('Authorization', `Bearer ${professorAToken}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.length, 2, 'Professor A should see 2 suggestions');

    const ids = res.body.data.map(s => s.id);
    assert.ok(ids.includes(suggestionAllId), 'Should include suggestion for ALL');
    assert.ok(ids.includes(suggestionProfAId), 'Should include suggestion for Prof A');
    assert.ok(!ids.includes(suggestionProfBId), 'Should NOT include suggestion for Prof B');
    console.log('  ✓ PASSED\n');
  }

  // Test 8: Professor B GET /api/suggestions returns suggestions for ALL and for Prof B, but not Prof A
  {
    console.log('Test 8: Professor B GET /api/suggestions returns only matching suggestions...');
    const res = await request
      .get('/api/suggestions')
      .set('Authorization', `Bearer ${professorBToken}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.length, 2, 'Professor B should see 2 suggestions');

    const ids = res.body.data.map(s => s.id);
    assert.ok(ids.includes(suggestionAllId), 'Should include suggestion for ALL');
    assert.ok(ids.includes(suggestionProfBId), 'Should include suggestion for Prof B');
    assert.ok(!ids.includes(suggestionProfAId), 'Should NOT include suggestion for Prof A');
    console.log('  ✓ PASSED\n');
  }

  console.log('=== All suggestions tests passed! ===\n');
}

runTests()
  .then(() => {
    closeDb();
    const fs = require('fs');
    const dbPath = path.join(__dirname, '..', 'test-suggestions.sqlite');
    try { fs.unlinkSync(dbPath); } catch(e) {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch(e) {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch(e) {}
    process.exit(0);
  })
  .catch(err => {
    console.error('TEST FAILED:', err);
    closeDb();
    const fs = require('fs');
    const dbPath = path.join(__dirname, '..', 'test-suggestions.sqlite');
    try { fs.unlinkSync(dbPath); } catch(e) {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch(e) {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch(e) {}
    process.exit(1);
  });
