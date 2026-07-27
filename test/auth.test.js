/**
 * Auth tests for Formação Continuada Docente backend
 * Run: node test/auth.test.js
 */
const assert = require('assert');
const path = require('path');

// Set test environment
process.env.JWT_SECRET = 'test-secret-key-auth';
process.env.DB_PATH = path.join(__dirname, '..', 'test-auth.sqlite');

const { initDb, closeDb, resetDb } = require('../src/database');

let professorToken;
let professorUser;
let coordinatorToken;
let coordinatorUser;

async function runTests() {
  // Initialize test database (initDb is async due to sql.js)
  resetDb();
  await initDb();

  const app = require('../src/index');
  const supertest = require('supertest');
  const request = supertest(app);
  console.log('=== Auth Tests ===\n');

  // Test 1: Protected routes return 401 without token
  {
    console.log('Test 1: Protected route returns 401 without token...');
    const res = await request.get('/api/submissions');
    assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
    assert.strictEqual(res.body.success, false);
    console.log('  ✓ PASSED\n');
  }

  // Test 2: Protected routes return 401 with invalid token
  {
    console.log('Test 2: Protected route returns 401 with invalid token...');
    const res = await request
      .get('/api/submissions')
      .set('Authorization', 'Bearer invalid-token-here');
    assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
    assert.strictEqual(res.body.success, false);
    console.log('  ✓ PASSED\n');
  }

  // Test 3: Dev-login creates user and returns JWT
  {
    console.log('Test 3: Dev-login creates user and returns JWT...');
    const res = await request
      .post('/api/auth/dev-login')
      .send({ email: 'prof.test@univ.edu.br', name: 'Professor Teste', role: 'professor' });
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.token, 'Should return a token');
    assert.ok(res.body.data.user, 'Should return user data');
    assert.strictEqual(res.body.data.user.email, 'prof.test@univ.edu.br');
    assert.strictEqual(res.body.data.user.name, 'Professor Teste');
    assert.strictEqual(res.body.data.user.role, 'professor');

    professorToken = res.body.data.token;
    professorUser = res.body.data.user;
    console.log('  ✓ PASSED\n');
  }

  // Test 4: Dev-login with coordinator role
  {
    console.log('Test 4: Dev-login with coordinator role...');
    const res = await request
      .post('/api/auth/dev-login')
      .send({ email: 'coord.test@univ.edu.br', name: 'Coordenador Teste', role: 'coordenador' });
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.token, 'Should return a token');
    assert.strictEqual(res.body.data.user.role, 'coordenador');

    coordinatorToken = res.body.data.token;
    coordinatorUser = res.body.data.user;
    console.log('  ✓ PASSED\n');
  }

  // Test 5: Protected route returns 200 with valid JWT
  {
    console.log('Test 5: Protected route returns 200 with valid JWT...');
    const res = await request
      .get('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.success, true);
    console.log('  ✓ PASSED\n');
  }

  // Test 6: GET /api/auth/me returns user info with valid token
  {
    console.log('Test 6: GET /api/auth/me returns user info...');
    const res = await request
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${professorToken}`);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.email, 'prof.test@univ.edu.br');
    assert.strictEqual(res.body.data.name, 'Professor Teste');
    assert.strictEqual(res.body.data.role, 'professor');
    // Should not expose google_id
    assert.strictEqual(res.body.data.google_id, undefined);
    console.log('  ✓ PASSED\n');
  }

  // Test 7: Dev-login requires email and name
  {
    console.log('Test 7: Dev-login requires email and name...');
    const res = await request
      .post('/api/auth/dev-login')
      .send({ email: 'incomplete@test.com' });
    assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
    assert.strictEqual(res.body.success, false);
    console.log('  ✓ PASSED\n');
  }

  // Test 8: Existing user dev-login returns same user
  {
    console.log('Test 8: Existing user dev-login returns same user...');
    const res = await request
      .post('/api/auth/dev-login')
      .send({ email: 'prof.test@univ.edu.br', name: 'Professor Teste' });
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.data.user.id, professorUser.id, 'Should return same user ID');
    console.log('  ✓ PASSED\n');
  }

  console.log('=== All auth tests passed! ===\n');
}

runTests()
  .then(() => {
    closeDb();
    // Clean up test database
    const fs = require('fs');
    const dbPath = path.join(__dirname, '..', 'test-auth.sqlite');
    try { fs.unlinkSync(dbPath); } catch(e) {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch(e) {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch(e) {}
    process.exit(0);
  })
  .catch(err => {
    console.error('TEST FAILED:', err.message);
    closeDb();
    const fs = require('fs');
    const dbPath = path.join(__dirname, '..', 'test-auth.sqlite');
    try { fs.unlinkSync(dbPath); } catch(e) {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch(e) {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch(e) {}
    process.exit(1);
  });
