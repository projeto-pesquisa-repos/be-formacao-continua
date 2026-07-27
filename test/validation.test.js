/**
 * Validation tests for Formação Continuada Docente backend
 * Run: node test/validation.test.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Set test environment
process.env.JWT_SECRET = 'test-secret-key-validation';
process.env.DB_PATH = path.join(__dirname, '..', 'test-validation.sqlite');

const { initDb, closeDb, resetDb, getDb } = require('../src/database');

let professorToken;
let professorUser;
let coordinatorToken;
let coordinatorUser;
let submissionToApprove;
let submissionToReject;
let submissionForAccessTest;

async function runTests() {
  // Initialize test database (initDb is async due to sql.js)
  resetDb();
  await initDb();

  const app = require('../src/index');
  const supertest = require('supertest');
  const request = supertest(app);
  console.log('=== Validation Tests ===\n');

  // Setup: Create test users
  {
    const res1 = await request.post('/api/auth/dev-login')
      .send({ email: 'prof.val@univ.edu.br', name: 'Professor Validação', role: 'professor' });
    professorToken = res1.body.data.token;
    professorUser = res1.body.data.user;

    const res2 = await request.post('/api/auth/dev-login')
      .send({ email: 'coord.val@univ.edu.br', name: 'Coordenador Validação', role: 'coordenador' });
    coordinatorToken = res2.body.data.token;
    coordinatorUser = res2.body.data.user;
  }

  // Setup: Create test submissions
  {
    const res1 = await request.post('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`)
      .field('tipo', 'curso')
      .field('titulo', 'Curso para Aprovar')
      .field('carga_horaria', '40')
      .field('instituicao_promotora', 'Universidade Aprovação');
    submissionToApprove = res1.body.data;

    const res2 = await request.post('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`)
      .field('tipo', 'evento')
      .field('titulo', 'Evento para Rejeitar')
      .field('nome_evento', 'Congresso Rejeição');
    submissionToReject = res2.body.data;

    const res3 = await request.post('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`)
      .field('tipo', 'producao')
      .field('titulo', 'Produção Teste Acesso')
      .field('tipo_producao', 'artigo');
    submissionForAccessTest = res3.body.data;
  }

  // Test 1: Listing pending submissions (coordinator)
  {
    console.log('Test 1: Listing pending submissions (coordinator)...');
    const res = await request
      .get('/api/validation/pending')
      .set('Authorization', `Bearer ${coordinatorToken}`);

    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.data), 'Data should be an array');
    assert.ok(res.body.data.length >= 3, `Expected at least 3 pending, got ${res.body.data.length}`);

    // All should be pendente
    for (const sub of res.body.data) {
      assert.strictEqual(sub.status, 'pendente', 'All listed should be pendente');
    }
    // Should include user info
    assert.ok(res.body.data[0].user_name, 'Should include user_name');
    console.log('  ✓ PASSED\n');
  }

  // Test 2: Approving a submission changes status to 'aprovado'
  {
    console.log('Test 2: Approving a submission changes status...');
    const res = await request
      .post(`/api/validation/${submissionToApprove.id}/approve`)
      .set('Authorization', `Bearer ${coordinatorToken}`);

    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.status, 'aprovado');
    assert.ok(res.body.data.validado_por, 'Should have validado_por');
    assert.ok(res.body.data.validado_em, 'Should have validado_em');

    // Verify via GET
    const getRes = await request
      .get(`/api/submissions/${submissionToApprove.id}`)
      .set('Authorization', `Bearer ${professorToken}`);
    assert.strictEqual(getRes.body.data.status, 'aprovado');
    console.log('  ✓ PASSED\n');
  }

  // Test 3: Rejecting without justificativa returns 400
  {
    console.log('Test 3: Rejecting without justificativa returns 400...');
    const res = await request
      .post(`/api/validation/${submissionToReject.id}/reject`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({});

    assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.error.toLowerCase().includes('justificativa'), 'Error should mention justificativa');
    console.log('  ✓ PASSED\n');
  }

  // Test 4: Rejecting with empty justificativa returns 400
  {
    console.log('Test 4: Rejecting with empty justificativa returns 400...');
    const res = await request
      .post(`/api/validation/${submissionToReject.id}/reject`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({ justificativa: '   ' });

    assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
    console.log('  ✓ PASSED\n');
  }

  // Test 5: Rejecting updates status and stores justificativa
  {
    console.log('Test 5: Rejecting with justificativa updates status...');
    const justificativa = 'O certificado enviado está ilegível. Por favor, reenvie o documento.';
    const res = await request
      .post(`/api/validation/${submissionToReject.id}/reject`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({ justificativa });

    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.status, 'rejeitado');
    assert.strictEqual(res.body.data.justificativa_rejeicao, justificativa);
    assert.ok(res.body.data.validado_por, 'Should have validado_por');
    assert.ok(res.body.data.validado_em, 'Should have validado_em');

    // Verify via GET
    const getRes = await request
      .get(`/api/submissions/${submissionToReject.id}`)
      .set('Authorization', `Bearer ${professorToken}`);
    assert.strictEqual(getRes.body.data.status, 'rejeitado');
    assert.strictEqual(getRes.body.data.justificativa_rejeicao, justificativa);
    console.log('  ✓ PASSED\n');
  }

  // Test 6: Professor cannot access validation endpoints (403)
  {
    console.log('Test 6: Professor cannot access validation endpoints (403)...');
    const res1 = await request
      .get('/api/validation/pending')
      .set('Authorization', `Bearer ${professorToken}`);
    assert.strictEqual(res1.status, 403, `Expected 403 for pending, got ${res1.status}`);

    const res2 = await request
      .post(`/api/validation/${submissionForAccessTest.id}/approve`)
      .set('Authorization', `Bearer ${professorToken}`);
    assert.strictEqual(res2.status, 403, `Expected 403 for approve, got ${res2.status}`);

    const res3 = await request
      .post(`/api/validation/${submissionForAccessTest.id}/reject`)
      .set('Authorization', `Bearer ${professorToken}`)
      .send({ justificativa: 'Teste' });
    assert.strictEqual(res3.status, 403, `Expected 403 for reject, got ${res3.status}`);
    console.log('  ✓ PASSED\n');
  }

  // Test 7: Cannot approve an already approved submission
  {
    console.log('Test 7: Cannot approve an already approved submission...');
    const res = await request
      .post(`/api/validation/${submissionToApprove.id}/approve`)
      .set('Authorization', `Bearer ${coordinatorToken}`);
    assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
    console.log('  ✓ PASSED\n');
  }

  // Test 8: Cannot reject an already rejected submission
  {
    console.log('Test 8: Cannot reject an already rejected submission...');
    const res = await request
      .post(`/api/validation/${submissionToReject.id}/reject`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({ justificativa: 'Double reject attempt' });
    assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
    console.log('  ✓ PASSED\n');
  }

  // Test 9: After approval, pending list no longer includes approved item
  {
    console.log('Test 9: Approved submissions not in pending list...');
    const res = await request
      .get('/api/validation/pending')
      .set('Authorization', `Bearer ${coordinatorToken}`);

    assert.strictEqual(res.status, 200);
    const ids = res.body.data.map(s => s.id);
    assert.ok(!ids.includes(submissionToApprove.id), 'Approved submission should not be in pending');
    assert.ok(!ids.includes(submissionToReject.id), 'Rejected submission should not be in pending');
    console.log('  ✓ PASSED\n');
  }

  console.log('=== All validation tests passed! ===\n');
}

runTests()
  .then(() => {
    closeDb();
    const dbPath = path.join(__dirname, '..', 'test-validation.sqlite');
    try { fs.unlinkSync(dbPath); } catch(e) {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch(e) {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch(e) {}
    process.exit(0);
  })
  .catch(err => {
    console.error('TEST FAILED:', err.message);
    console.error(err.stack);
    closeDb();
    const dbPath = path.join(__dirname, '..', 'test-validation.sqlite');
    try { fs.unlinkSync(dbPath); } catch(e) {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch(e) {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch(e) {}
    process.exit(1);
  });
