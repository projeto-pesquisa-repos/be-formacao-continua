/**
 * Milestone 2 (R1 - R6) Integration & Verification Test Suite
 * Run: node test/m2_requirements.test.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const supertest = require('supertest');

process.env.JWT_SECRET = 'test-secret-key-m2';
process.env.DB_PATH = path.join(__dirname, '..', 'test-m2.sqlite');

const { initDb, closeDb, resetDb, getDb } = require('../src/database');
const { seed } = require('../src/seed');

let app;
let request;

async function runM2Tests() {
  console.log('=== Milestone 2 Requirements (R1 - R6) Test Suite ===\n');

  resetDb();
  await initDb();
  app = require('../src/index');
  request = supertest(app);

  // Run seed
  await seed({ skipInit: true });

  // ----------------------------------------------------
  // R4 Test: Seed Cleanup & AI Route Error Handling
  // ----------------------------------------------------
  console.log('R4: Seed cleanup & AI error handling...');
  const db = getDb();
  const userCount = (await db.prepare('SELECT COUNT(*) as cnt FROM users').get()).cnt;
  const acaoCount = (await db.prepare('SELECT COUNT(*) as cnt FROM acoes_formativas').get()).cnt;
  const adminUser = await db.prepare("SELECT * FROM users WHERE email = 'admin@admin.com'").get();
  
  assert.strictEqual(userCount, 1, 'Only admin user should exist after seed');
  assert.strictEqual(acaoCount, 0, 'Zero acoes_formativas should exist after seed');
  assert.ok(adminUser, 'admin@admin.com should exist');
  assert.strictEqual(adminUser.role, 'coordenador');

  // Dev login as admin (coordenador)
  const adminLogin = await request.post('/api/auth/dev-login').send({
    email: 'admin@admin.com', name: 'Admin', role: 'coordenador'
  });
  const adminToken = adminLogin.body.data.token;

  // Dev login as professor
  const profLogin = await request.post('/api/auth/dev-login').send({
    email: 'prof.m2@univ.edu.br', name: 'Prof M2', role: 'professor'
  });
  const profToken = profLogin.body.data.token;
  const profId = profLogin.body.data.user.id;

  // AI suggest without key
  const aiRes = await request.post(`/api/ai/suggest/${profId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.strictEqual(aiRes.status, 400);
  assert.strictEqual(aiRes.body.success, false);
  assert.strictEqual(
    aiRes.body.error,
    'Chave da API xAI Grok não configurada ou inválida. Configure a chave grok_api_key nas configurações do sistema.'
  );
  console.log('  ✓ R4 PASSED\n');

  // ----------------------------------------------------
  // R3 Test: Mobile User Display Name (X-Device-Name)
  // ----------------------------------------------------
  console.log('R3: Mobile user display name (X-Device-Name)...');
  
  // 1. Auto-create user with custom name
  const devRes1 = await request.get('/api/submissions')
    .set('X-Device-ID', 'device_test_123')
    .set('X-Device-Name', 'Prof Carlos Silva');
  assert.strictEqual(devRes1.status, 200);

  const deviceUser1 = await db.prepare("SELECT * FROM users WHERE google_id = 'device:device_test_123'").get();
  assert.ok(deviceUser1, 'Device user 1 created');
  assert.strictEqual(deviceUser1.name, 'Prof Carlos Silva');

  // 2. Auto-create user without name (defaulting to Docente Mobile)
  const devRes2 = await request.get('/api/submissions')
    .set('X-Device-ID', 'device_test_456');
  assert.strictEqual(devRes2.status, 200);

  let deviceUser2 = await db.prepare("SELECT * FROM users WHERE google_id = 'device:device_test_456'").get();
  assert.ok(deviceUser2, 'Device user 2 created');
  assert.strictEqual(deviceUser2.name, 'Docente Mobile');

  // 3. Update existing user 2 when X-Device-Name header is provided
  const devRes2Update = await request.get('/api/submissions')
    .set('X-Device-ID', 'device_test_456')
    .set('X-Device-Name', 'Professora Mariana');
  assert.strictEqual(devRes2Update.status, 200);

  deviceUser2 = await db.prepare("SELECT * FROM users WHERE google_id = 'device:device_test_456'").get();
  assert.strictEqual(deviceUser2.name, 'Professora Mariana');
  console.log('  ✓ R3 PASSED\n');

  // ----------------------------------------------------
  // R1 Test: Award XP on Submission Creation
  // ----------------------------------------------------
  console.log('R1: XP on creation & approval...');
  
  // Check initial XP
  const initialGam = await request.get('/api/gamification').set('Authorization', `Bearer ${profToken}`);
  assert.strictEqual(initialGam.body.data.xp, 0);

  // Submit action
  const subRes1 = await request.post('/api/submissions')
    .set('Authorization', `Bearer ${profToken}`)
    .field('tipo', 'curso')
    .field('titulo', 'Curso de Arquitetura Clean')
    .field('carga_horaria', '30')
    .field('instituicao_promotora', 'MIT');
  assert.strictEqual(subRes1.status, 201);
  const sub1Id = subRes1.body.data.id;

  // Verify 50 XP awarded
  const afterSubGam = await request.get('/api/gamification').set('Authorization', `Bearer ${profToken}`);
  assert.strictEqual(afterSubGam.body.data.xp, 50);

  // Approve action
  const approveRes = await request.post(`/api/validation/${sub1Id}/approve`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.strictEqual(approveRes.status, 200);

  // Verify 150 XP added (total 200 XP)
  const afterApproveGam = await request.get('/api/gamification').set('Authorization', `Bearer ${profToken}`);
  assert.strictEqual(afterApproveGam.body.data.xp, 200);
  console.log('  ✓ R1 PASSED\n');

  // ----------------------------------------------------
  // R2 Test: Badge Requirement Types & Certificacao
  // ----------------------------------------------------
  console.log('R2: Certificacao & badge evaluation...');

  // Submit certificacao
  const certRes = await request.post('/api/submissions')
    .set('Authorization', `Bearer ${profToken}`)
    .field('tipo', 'certificacao')
    .field('titulo', 'Certificação AWS Solutions Architect')
    .field('instituicao_promotora', 'Amazon Web Services');
  assert.strictEqual(certRes.status, 201);
  assert.strictEqual(certRes.body.data.tipo, 'certificacao');
  const certId = certRes.body.data.id;

  // Approve certificacao
  await request.post(`/api/validation/${certId}/approve`)
    .set('Authorization', `Bearer ${adminToken}`);

  // Check badges for certificacao ("Primeira Certificação")
  const profGam = await request.get('/api/gamification').set('Authorization', `Bearer ${profToken}`);
  const hasCertBadge = profGam.body.data.badges.some(b => b.name === 'Primeira Certificação');
  assert.ok(hasCertBadge, 'Should award Primeira Certificação badge');
  console.log('  ✓ R2 PASSED\n');

  // ----------------------------------------------------
  // R5 Test: Status Change Endpoint (/api/validation/:id/change-status)
  // ----------------------------------------------------
  console.log('R5: Change status endpoint (aprovado <-> rejeitado)...');

  // 1. Change sub1 from aprovado to rejeitado without justificativa -> 400
  const changeNoJust = await request.post(`/api/validation/${sub1Id}/change-status`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'rejeitado' });
  assert.strictEqual(changeNoJust.status, 400);

  // 2. Change sub1 from aprovado to rejeitado with justificativa -> 200 & XP deducted
  const changeToRej = await request.post(`/api/validation/${sub1Id}/change-status`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'rejeitado', justificativa: 'Documento inconsistente com os requisitos.' });
  assert.strictEqual(changeToRej.status, 200);
  assert.strictEqual(changeToRej.body.data.status, 'rejeitado');
  assert.strictEqual(changeToRej.body.data.justificativa_rejeicao, 'Documento inconsistente com os requisitos.');

  // Check XP after deduction:
  // 50 (sub1 creation) + 150 (sub1 approval) + 50 (cert creation) + 150 (cert approval) - 150 (sub1 rejection) = 250 XP
  const afterRejGam = await request.get('/api/gamification').set('Authorization', `Bearer ${profToken}`);
  assert.strictEqual(afterRejGam.body.data.xp, 250);

  // 3. Change sub1 back from rejeitado to aprovado -> 200 & 150 XP re-awarded
  const changeToApprove = await request.post(`/api/validation/${sub1Id}/change-status`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'aprovado' });
  assert.strictEqual(changeToApprove.status, 200);
  assert.strictEqual(changeToApprove.body.data.status, 'aprovado');
  assert.strictEqual(changeToApprove.body.data.justificativa_rejeicao, null);

  const afterReApproveGam = await request.get('/api/gamification').set('Authorization', `Bearer ${profToken}`);
  assert.strictEqual(afterReApproveGam.body.data.xp, 400);
  console.log('  ✓ R5 PASSED\n');

  // ----------------------------------------------------
  // R6 Test: Multer Fallback & Static File Serving
  // ----------------------------------------------------
  console.log('R6: Multer fallback & static file serving...');

  const tempFile = path.join(__dirname, 'noextfile');
  fs.writeFileSync(tempFile, 'Dummy content for no-extension image upload');

  const uploadRes = await request.post('/api/submissions')
    .set('Authorization', `Bearer ${profToken}`)
    .field('tipo', 'curso')
    .field('titulo', 'Curso Foto Mobile')
    .field('carga_horaria', '10')
    .field('instituicao_promotora', 'Mobile Inst')
    .attach('arquivo', tempFile, { filename: 'blob', contentType: 'image/jpeg' });

  assert.strictEqual(uploadRes.status, 201);
  const uploadedFilename = uploadRes.body.data.arquivo_path;
  assert.ok(uploadedFilename.endsWith('.jpg'), `Filename should have .jpg extension fallback, got ${uploadedFilename}`);

  // Test static file serving endpoint /api/files/:filename
  const serveRes = await request.get(`/api/files/${uploadedFilename}`);
  assert.strictEqual(serveRes.status, 200);
  const bodyText = serveRes.text || (Buffer.isBuffer(serveRes.body) ? serveRes.body.toString('utf8') : String(serveRes.body));
  assert.strictEqual(bodyText, 'Dummy content for no-extension image upload');

  // Clean up
  fs.unlinkSync(tempFile);
  const diskPath = path.join(__dirname, '..', 'uploads', uploadedFilename);
  if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);

  console.log('  ✓ R6 PASSED\n');

  console.log('=== All Milestone 2 requirements verified successfully! ===\n');
}

runM2Tests().then(() => {
  closeDb();
  const dbPath = path.join(__dirname, '..', 'test-m2.sqlite');
  try { fs.unlinkSync(dbPath); } catch(e) {}
  try { fs.unlinkSync(dbPath + '-wal'); } catch(e) {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch(e) {}
  process.exit(0);
}).catch(err => {
  console.error('M2 TEST FAILED:', err.message);
  console.error(err.stack);
  closeDb();
  const dbPath = path.join(__dirname, '..', 'test-m2.sqlite');
  try { fs.unlinkSync(dbPath); } catch(e) {}
  try { fs.unlinkSync(dbPath + '-wal'); } catch(e) {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch(e) {}
  process.exit(1);
});
