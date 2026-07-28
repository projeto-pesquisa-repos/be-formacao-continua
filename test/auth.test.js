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

  // Test 9: Requesting /api/auth/me with X-Device-ID auto-creates a user with role 'professor' and returns 200
  {
    console.log('Test 9: Requesting /api/auth/me with X-Device-ID auto-creates a user with role professor...');
    const testDeviceId = 'device-test-uuid-12345';
    const res = await request
      .get('/api/auth/me')
      .set('X-Device-ID', testDeviceId);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.role, 'professor');
    assert.strictEqual(res.body.data.name, 'Docente Mobile');

    const crypto = require('crypto');
    const expectedHash = crypto.createHash('md5').update(testDeviceId).digest('hex').substring(0, 10);
    const expectedEmail = `device_${expectedHash}@device.local`;
    const expectedGoogleId = `device:${testDeviceId}`;

    assert.strictEqual(res.body.data.email, expectedEmail);

    const { getDb } = require('../src/database');
    const db = getDb();
    const user = await db.prepare('SELECT * FROM users WHERE google_id = ?').get(expectedGoogleId);
    assert.ok(user, 'User should be created in database');
    assert.strictEqual(user.role, 'professor', `Role should be professor, got ${user.role}`);
    assert.strictEqual(user.name, 'Docente Mobile');
    assert.strictEqual(user.email, expectedEmail);

    const gamification = await db.prepare('SELECT * FROM user_gamification WHERE user_id = ?').get(user.id);
    assert.ok(gamification, 'Gamification profile should be initialized');
    assert.strictEqual(gamification.xp, 0);
    assert.strictEqual(gamification.level, 1);
    assert.strictEqual(gamification.streak, 0);
    console.log('  ✓ PASSED\n');
  }

  // Test 10: Subsequent requests with the same X-Device-ID reuse the existing user (idempotent)
  {
    console.log('Test 10: Subsequent requests with same X-Device-ID reuse existing user...');
    const testDeviceId = 'device-test-uuid-12345';

    const res1 = await request
      .get('/api/auth/me')
      .set('X-Device-ID', testDeviceId);
    assert.strictEqual(res1.status, 200, `Expected 200, got ${res1.status}`);
    assert.strictEqual(res1.body.success, true);

    const res2 = await request
      .get('/api/auth/me')
      .set('X-Device-ID', testDeviceId);
    assert.strictEqual(res2.status, 200, `Expected 200, got ${res2.status}`);
    assert.strictEqual(res2.body.data.id, res1.body.data.id, 'Repeat calls should return same user ID');
    console.log('  ✓ PASSED\n');
  }

  // Test 11: Accessing /api/submissions with X-Device-ID works (200 OK)
  {
    console.log('Test 11: Accessing /api/submissions with X-Device-ID works (200 OK)...');
    const deviceId = 'device-sub-test-999';
    const res = await request
      .get('/api/submissions')
      .set('X-Device-ID', deviceId);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.data), 'Data should be an array of submissions');
    console.log('  ✓ PASSED\n');
  }

  // Test 12: Device user with role 'professor' receives 403 on coordinator routes (/api/validation/pending)
  {
    console.log('Test 12: Device user receives 403 on coordinator routes...');
    const deviceId = 'device-sub-test-999';
    const res = await request
      .get('/api/validation/pending')
      .set('X-Device-ID', deviceId);
    assert.strictEqual(res.status, 403, `Expected 403 Forbidden, got ${res.status}`);
    assert.strictEqual(res.body.success, false);
    console.log('  ✓ PASSED\n');
  }

  // Test 13: JWT takes priority over X-Device-ID header if both provided
  {
    console.log('Test 13: JWT takes priority over X-Device-ID...');
    const deviceId = 'device-sub-test-999';
    const res = await request
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .set('X-Device-ID', deviceId);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.data.id, coordinatorUser.id, 'Should resolve to JWT user');
    assert.strictEqual(res.body.data.role, 'coordenador');
    console.log('  ✓ PASSED\n');
  }

  // Test 14: X-Device-ID never grants coordinator access, even with target device IDs or DB role override
  {
    console.log('Test 14: X-Device-ID never grants coordinator access...');
    for (const devId of ['google_coord_001', 'coord_123']) {
      const meRes = await request
        .get('/api/auth/me')
        .set('X-Device-ID', devId);
      assert.strictEqual(meRes.status, 200, `Expected 200, got ${meRes.status}`);
      assert.strictEqual(meRes.body.data.role, 'professor', `Role should be professor for ${devId}`);

      const coordRes = await request
        .get('/api/validation/pending')
        .set('X-Device-ID', devId);
      assert.strictEqual(coordRes.status, 403, `Expected 403 on coordinator route for ${devId}`);
    }

    // Even if DB record has role = 'coordenador' manually set, auth middleware forces req.user.role to 'professor'
    const { getDb } = require('../src/database');
    const db = getDb();
    await db.prepare("UPDATE users SET role = 'coordenador' WHERE google_id = ?").run('device:coord_123');
    db.save();

    const checkRes = await request
      .get('/api/auth/me')
      .set('X-Device-ID', 'coord_123');
    assert.strictEqual(checkRes.status, 200);
    assert.strictEqual(checkRes.body.data.role, 'professor', 'auth middleware must enforce role professor for device auth');

    const checkCoordRes = await request
      .get('/api/validation/pending')
      .set('X-Device-ID', 'coord_123');
    assert.strictEqual(checkCoordRes.status, 403, 'Should deny coordinator access even if DB role is coordenador');
    console.log('  ✓ PASSED\n');
  }

  // Test 15: Device IDs with special characters work cleanly without email collisions
  {
    console.log('Test 15: Special character device IDs work cleanly without email collisions...');
    const specialIds = ['device/test#1', 'device.test!2', 'device/test@1'];

    const emails = new Set();
    for (const id of specialIds) {
      const res = await request
        .get('/api/auth/me')
        .set('X-Device-ID', id);
      assert.strictEqual(res.status, 200, `Expected 200 for ${id}`);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.email.endsWith('@device.local'));
      emails.add(res.body.data.email);
    }

    assert.strictEqual(emails.size, specialIds.length, 'Each special character device ID must produce a unique email');
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
