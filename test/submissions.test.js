/**
 * Submissions tests for Formação Continuada Docente backend
 * Run: node test/submissions.test.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Set test environment
process.env.JWT_SECRET = 'test-secret-key-submissions';
process.env.DB_PATH = path.join(__dirname, '..', 'test-submissions.sqlite');

const { initDb, closeDb, resetDb, getDb } = require('../src/database');

let professorToken;
let professorUser;
let professor2Token;
let professor2User;
let coordinatorToken;
let createdSubmissionId;

async function runTests() {
  // Initialize test database (initDb is async due to sql.js)
  resetDb();
  await initDb();

  // Create a department and area for testing
  const db = getDb();
  db.prepare('INSERT INTO departments (name) VALUES (?)').run('Departamento Teste');
  const deptId = db.prepare('SELECT id FROM departments ORDER BY id DESC LIMIT 1').get().id;
  db.prepare('INSERT INTO areas_conhecimento (name, department_id) VALUES (?, ?)').run('Área Teste', deptId);
  const areaId = db.prepare('SELECT id FROM areas_conhecimento ORDER BY id DESC LIMIT 1').get().id;

  const app = require('../src/index');
  const supertest = require('supertest');
  const request = supertest(app);
  console.log('=== Submissions Tests ===\n');

  // Setup: Create test users
  {
    const res = await request.post('/api/auth/dev-login')
      .send({ email: 'prof1.sub@univ.edu.br', name: 'Professor Sub 1', role: 'professor', department_id: deptId });
    professorToken = res.body.data.token;
    professorUser = res.body.data.user;

    const res2 = await request.post('/api/auth/dev-login')
      .send({ email: 'prof2.sub@univ.edu.br', name: 'Professor Sub 2', role: 'professor', department_id: deptId });
    professor2Token = res2.body.data.token;
    professor2User = res2.body.data.user;

    const res3 = await request.post('/api/auth/dev-login')
      .send({ email: 'coord.sub@univ.edu.br', name: 'Coordenador Sub', role: 'coordenador' });
    coordinatorToken = res3.body.data.token;
  }

  // Test 1: Create a submission (curso) with all required fields
  {
    console.log('Test 1: Create a submission (curso) with required fields...');
    const res = await request
      .post('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`)
      .field('tipo', 'curso')
      .field('titulo', 'Curso de Teste Automatizado')
      .field('descricao', 'Descrição do curso de teste')
      .field('carga_horaria', '40')
      .field('instituicao_promotora', 'Universidade Teste')
      .field('data_conclusao', '2026-06-15')
      .field('area_conhecimento_id', String(areaId));

    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.id, 'Should have an ID');
    assert.strictEqual(res.body.data.tipo, 'curso');
    assert.strictEqual(res.body.data.titulo, 'Curso de Teste Automatizado');
    assert.strictEqual(res.body.data.status, 'pendente');
    assert.strictEqual(res.body.data.carga_horaria, 40);
    assert.strictEqual(res.body.data.user_id, professorUser.id);

    createdSubmissionId = res.body.data.id;
    console.log('  ✓ PASSED\n');
  }

  // Test 2: Create a submission (evento)
  {
    console.log('Test 2: Create a submission (evento) with required fields...');
    const res = await request
      .post('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`)
      .field('tipo', 'evento')
      .field('titulo', 'Evento de Teste')
      .field('nome_evento', 'Congresso Teste 2026')
      .field('tipo_participacao', 'apresentador')
      .field('local_evento', 'São Paulo, SP')
      .field('area_conhecimento_id', String(areaId));

    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
    assert.strictEqual(res.body.data.tipo, 'evento');
    assert.strictEqual(res.body.data.nome_evento, 'Congresso Teste 2026');
    console.log('  ✓ PASSED\n');
  }

  // Test 3: Create a submission (producao)
  {
    console.log('Test 3: Create a submission (producao) with required fields...');
    const res = await request
      .post('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`)
      .field('tipo', 'producao')
      .field('titulo', 'Artigo de Teste Acadêmico')
      .field('tipo_producao', 'artigo')
      .field('doi_isbn', '10.1234/test.2026')
      .field('area_conhecimento_id', String(areaId));

    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
    assert.strictEqual(res.body.data.tipo, 'producao');
    assert.strictEqual(res.body.data.tipo_producao, 'artigo');
    console.log('  ✓ PASSED\n');
  }

  // Test 4: Listing submissions returns created items
  {
    console.log('Test 4: Listing submissions returns created items...');
    const res = await request
      .get('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`);

    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.data), 'Data should be an array');
    assert.ok(res.body.data.length >= 3, `Expected at least 3 submissions, got ${res.body.data.length}`);
    console.log('  ✓ PASSED\n');
  }

  // Test 5: Getting a single submission by ID
  {
    console.log('Test 5: Getting a single submission by ID...');
    const res = await request
      .get(`/api/submissions/${createdSubmissionId}`)
      .set('Authorization', `Bearer ${professorToken}`);

    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.id, createdSubmissionId);
    assert.strictEqual(res.body.data.titulo, 'Curso de Teste Automatizado');
    console.log('  ✓ PASSED\n');
  }

  // Test 6: File upload works
  {
    console.log('Test 6: File upload works...');
    // Create a temporary test file
    const testFilePath = path.join(__dirname, 'test-upload.txt');
    fs.writeFileSync(testFilePath, 'This is a test certificate file content for upload testing.');

    const res = await request
      .post('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`)
      .field('tipo', 'curso')
      .field('titulo', 'Curso com Arquivo')
      .field('carga_horaria', '20')
      .field('instituicao_promotora', 'Universidade Upload')
      .attach('arquivo', testFilePath);

    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.arquivo_path, 'Should have arquivo_path');
    assert.ok(res.body.data.arquivo_nome, 'Should have arquivo_nome');

    // Verify file exists in uploads
    const uploadedPath = path.join(__dirname, '..', 'uploads', res.body.data.arquivo_path);
    assert.ok(fs.existsSync(uploadedPath), 'Uploaded file should exist on disk');

    // Clean up test file
    fs.unlinkSync(testFilePath);
    // Clean up uploaded file
    if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
    console.log('  ✓ PASSED\n');
  }

  // Test 7: Professor can only see their own submissions
  {
    console.log('Test 7: Professor can only see their own submissions...');
    // Create a submission for professor 2
    await request
      .post('/api/submissions')
      .set('Authorization', `Bearer ${professor2Token}`)
      .field('tipo', 'curso')
      .field('titulo', 'Curso do Professor 2')
      .field('carga_horaria', '30')
      .field('instituicao_promotora', 'Universidade Dois');

    // Professor 1 should only see their own
    const res1 = await request
      .get('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`);

    assert.strictEqual(res1.status, 200);
    const prof1Submissions = res1.body.data;
    for (const sub of prof1Submissions) {
      assert.strictEqual(sub.user_id, professorUser.id, 'Professor 1 should only see own submissions');
    }

    // Professor 2 should only see their own
    const res2 = await request
      .get('/api/submissions')
      .set('Authorization', `Bearer ${professor2Token}`);

    assert.strictEqual(res2.status, 200);
    const prof2Submissions = res2.body.data;
    for (const sub of prof2Submissions) {
      assert.strictEqual(sub.user_id, professor2User.id, 'Professor 2 should only see own submissions');
    }

    // Coordinator should see all
    const res3 = await request
      .get('/api/submissions')
      .set('Authorization', `Bearer ${coordinatorToken}`);

    assert.strictEqual(res3.status, 200);
    assert.ok(res3.body.data.length >= prof1Submissions.length + prof2Submissions.length,
      'Coordinator should see all submissions');
    console.log('  ✓ PASSED\n');
  }

  // Test 8: Validation of required fields
  {
    console.log('Test 8: Validation rejects missing required fields...');
    // Missing titulo
    const res = await request
      .post('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`)
      .field('tipo', 'curso');

    assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
    assert.strictEqual(res.body.success, false);
    console.log('  ✓ PASSED\n');
  }

  // Test 9: Type-specific validation for curso
  {
    console.log('Test 9: Type-specific validation for curso...');
    const res = await request
      .post('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`)
      .field('tipo', 'curso')
      .field('titulo', 'Curso Sem Carga Horária');

    assert.strictEqual(res.status, 400, `Expected 400 for curso without carga_horaria, got ${res.status}`);
    console.log('  ✓ PASSED\n');
  }

  // Test 10: Delete a pending submission
  {
    console.log('Test 10: Delete a pending submission...');
    const res = await request
      .delete(`/api/submissions/${createdSubmissionId}`)
      .set('Authorization', `Bearer ${professorToken}`);

    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.success, true);

    // Verify it's gone
    const res2 = await request
      .get(`/api/submissions/${createdSubmissionId}`)
      .set('Authorization', `Bearer ${professorToken}`);
    assert.strictEqual(res2.status, 404);
    console.log('  ✓ PASSED\n');
  }

  // Test 11: Duplicate submission check
  {
    console.log('Test 11: Duplicate submission returns 400 error...');
    const duplicateTitulo = 'Evento Duplicado Teste';
    const firstRes = await request
      .post('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`)
      .field('tipo', 'evento')
      .field('titulo', duplicateTitulo)
      .field('nome_evento', 'Congresso Teste Duplicado')
      .field('tipo_participacao', 'apresentador')
      .field('local_evento', 'Rio de Janeiro, RJ')
      .field('area_conhecimento_id', String(areaId));
      
    assert.strictEqual(firstRes.status, 201, `Expected 201 for first submission, got ${firstRes.status}`);
    
    const duplicateRes = await request
      .post('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`)
      .field('tipo', 'evento')
      .field('titulo', duplicateTitulo)
      .field('nome_evento', 'Congresso Teste Duplicado 2')
      .field('tipo_participacao', 'ouvinte')
      .field('local_evento', 'São Paulo, SP')
      .field('area_conhecimento_id', String(areaId));
      
    assert.strictEqual(duplicateRes.status, 400, `Expected 400 for duplicate submission, got ${duplicateRes.status}`);
    assert.strictEqual(duplicateRes.body.success, false);
    assert.strictEqual(duplicateRes.body.error, 'Você já possui uma submissão com este tipo e título');
    console.log('  ✓ PASSED\\n');
  }

  // Test 12: Duplicate submission bypass check (whitespace/casing)
  {
    console.log('Test 12: Duplicate submission bypass check (whitespace/casing)...');
    const duplicateRes2 = await request
      .post('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`)
      .field('tipo', 'evento')
      .field('titulo', '   evento DUPLICADO teste  ')
      .field('nome_evento', 'Congresso Teste Duplicado Bypass')
      .field('tipo_participacao', 'ouvinte')
      .field('local_evento', 'São Paulo, SP')
      .field('area_conhecimento_id', String(areaId));
      
    assert.strictEqual(duplicateRes2.status, 400, `Expected 400 for duplicate submission with different casing/spacing, got ${duplicateRes2.status}`);
    assert.strictEqual(duplicateRes2.body.success, false);
    assert.strictEqual(duplicateRes2.body.error, 'Você já possui uma submissão com este tipo e título');
    console.log('  ✓ PASSED\\n');
  }

  // Test 13: Punctuation and zero-width chars check
  {
    console.log('Test 13: Punctuation and zero-width chars check...');
    const duplicateRes3 = await request
      .post('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`)
      .field('tipo', 'evento')
      .field('titulo', 'Evento! Duplicado\u200B Teste')
      .field('nome_evento', 'Congresso Teste Duplicado Punct')
      .field('tipo_participacao', 'ouvinte')
      .field('local_evento', 'São Paulo, SP')
      .field('area_conhecimento_id', String(areaId));
      
    assert.strictEqual(duplicateRes3.status, 400, `Expected 400 for duplicate submission with punctuation, got ${duplicateRes3.status}`);
    assert.strictEqual(duplicateRes3.body.success, false);
    assert.strictEqual(duplicateRes3.body.error, 'Você já possui uma submissão com este tipo e título');
    console.log('  ✓ PASSED\\n');
  }

  // Test 14: Array in titulo doesn't crash server
  {
    console.log('Test 14: Array in titulo doesnt crash server...');
    const arrayRes = await request
      .post('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`)
      .send({
        tipo: 'curso',
        titulo: ['Curso 1', 'Curso 2'],
        carga_horaria: 40,
        instituicao_promotora: 'Teste'
      });
      
    assert.strictEqual(arrayRes.status, 400, `Expected 400 when sending array as titulo, got ${arrayRes.status}`);
    assert.strictEqual(arrayRes.body.success, false);
    assert.strictEqual(arrayRes.body.error, 'Título deve ser uma string');
    console.log('  ✓ PASSED\n');
  }

  // Test 15: PUT duplicate submission check (prevent renaming to existing submission title)
  {
    console.log('Test 15: PUT duplicate submission check...');
    // Create a new submission
    const resA = await request
      .post('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`)
      .field('tipo', 'curso')
      .field('titulo', 'Curso de Node.js Avançado')
      .field('carga_horaria', '30')
      .field('instituicao_promotora', 'Universidade Node');
    assert.strictEqual(resA.status, 201);
    const subAId = resA.body.data.id;

    // Create a second submission
    const resB = await request
      .post('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`)
      .field('tipo', 'curso')
      .field('titulo', 'Curso de Python Intermediário')
      .field('carga_horaria', '20')
      .field('instituicao_promotora', 'Universidade Python');
    assert.strictEqual(resB.status, 201);
    const subBId = resB.body.data.id;

    // Attempt to update subB's title to match subA's title with accents/whitespace variations
    const putRes = await request
      .put(`/api/submissions/${subBId}`)
      .set('Authorization', `Bearer ${professorToken}`)
      .field('titulo', '  cúrso   de   NODE.JS   avançado  ');
      
    assert.strictEqual(putRes.status, 400, `Expected 400 when renaming submission to existing title, got ${putRes.status}`);
    assert.strictEqual(putRes.body.success, false);
    assert.strictEqual(putRes.body.error, 'Você já possui uma submissão com este tipo e título');

    // Updating non-title fields on subB should succeed
    const putOkRes = await request
      .put(`/api/submissions/${subBId}`)
      .set('Authorization', `Bearer ${professorToken}`)
      .field('descricao', 'Nova descrição para Python');
    assert.strictEqual(putOkRes.status, 200, `Expected 200 when updating non-title fields, got ${putOkRes.status}`);

    console.log('  ✓ PASSED\n');
  }

  console.log('=== All submissions tests passed! ===\n');
}

runTests()
  .then(() => {
    closeDb();
    const dbPath = path.join(__dirname, '..', 'test-submissions.sqlite');
    try { fs.unlinkSync(dbPath); } catch(e) {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch(e) {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch(e) {}
    process.exit(0);
  })
  .catch(err => {
    console.error('TEST FAILED:', err.message);
    console.error(err.stack);
    closeDb();
    const dbPath = path.join(__dirname, '..', 'test-submissions.sqlite');
    try { fs.unlinkSync(dbPath); } catch(e) {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch(e) {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch(e) {}
    process.exit(1);
  });
