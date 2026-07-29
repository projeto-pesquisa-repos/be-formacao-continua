/**
 * Challenger 2 Test Suite for M2 Backend Requirements
 * Working directory: .agents/teamwork_preview_challenger_m2_2
 * Run: node test/challenger_m2_2.test.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const supertest = require('supertest');

process.env.JWT_SECRET = 'challenger-m2-2-secret-key';
process.env.DB_PATH = path.join(__dirname, '..', 'test-challenger-m2-2.sqlite');

const { initDb, closeDb, resetDb, getDb } = require('../src/database');
const { seed } = require('../src/seed');

let app;
let request;

async function runChallengerTests() {
  console.log('====================================================');
  console.log(' CHALLENGER 2: EMPIRICAL STRESS-TEST SUITE FOR M2');
  console.log('====================================================\n');

  resetDb();
  await initDb();
  app = require('../src/index');
  request = supertest(app);
  await seed({ skipInit: true });
  const db = getDb();

  // Setup tokens
  const adminLogin = await request.post('/api/auth/dev-login').send({
    email: 'admin@admin.com', name: 'Admin Coordenador', role: 'coordenador'
  });
  const adminToken = adminLogin.body.data.token;

  const profLogin = await request.post('/api/auth/dev-login').send({
    email: 'prof.test@univ.edu.br', name: 'Prof Teste', role: 'professor'
  });
  const profToken = profLogin.body.data.token;
  const profId = profLogin.body.data.user.id;

  // ----------------------------------------------------
  // FOCUS 1: X-Device-Name Header Parsing & Auth Logic
  // ----------------------------------------------------
  console.log('--- FOCUS 1: X-Device-Name Header & Auth Middleware ---');

  // 1.1 Empty / Whitespace X-Device-Name
  console.log('  1.1 Empty & Whitespace X-Device-Name Header:');
  
  // Case A: Missing header entirely
  const resEmpty1 = await request.get('/api/submissions').set('X-Device-ID', 'dev_empty_1');
  assert.strictEqual(resEmpty1.status, 200, 'Device auth without device-name should succeed');
  const userEmpty1 = await db.prepare("SELECT * FROM users WHERE google_id = 'device:dev_empty_1'").get();
  assert.strictEqual(userEmpty1.name, 'Docente Mobile', 'Missing device name should default to "Docente Mobile"');
  console.log('    ✓ Missing header -> default "Docente Mobile"');

  // Case B: Empty string X-Device-Name: ""
  const resEmpty2 = await request.get('/api/submissions')
    .set('X-Device-ID', 'dev_empty_2')
    .set('X-Device-Name', '');
  assert.strictEqual(resEmpty2.status, 200);
  const userEmpty2 = await db.prepare("SELECT * FROM users WHERE google_id = 'device:dev_empty_2'").get();
  assert.strictEqual(userEmpty2.name, 'Docente Mobile', 'Empty string device name should default to "Docente Mobile"');
  console.log('    ✓ Empty string header -> default "Docente Mobile"');

  // Case C: Whitespace X-Device-Name: "   "
  const resEmpty3 = await request.get('/api/submissions')
    .set('X-Device-ID', 'dev_empty_3')
    .set('X-Device-Name', '   ');
  assert.strictEqual(resEmpty3.status, 200);
  const userEmpty3 = await db.prepare("SELECT * FROM users WHERE google_id = 'device:dev_empty_3'").get();
  assert.strictEqual(userEmpty3.name, 'Docente Mobile', 'Whitespace device name should default to "Docente Mobile"');
  console.log('    ✓ Whitespace string header -> default "Docente Mobile"');

  // 1.2 Special Characters & Encoding in X-Device-Name
  console.log('\n  1.2 Special Characters & URL-Encoding:');

  // Case A: URL-encoded Portuguese name
  const resSpec1 = await request.get('/api/submissions')
    .set('X-Device-ID', 'dev_spec_1')
    .set('X-Device-Name', 'Prof.%20Jo%C3%A3o%20da%20Silva');
  assert.strictEqual(resSpec1.status, 200);
  const userSpec1 = await db.prepare("SELECT * FROM users WHERE google_id = 'device:dev_spec_1'").get();
  assert.strictEqual(userSpec1.name, 'Prof. João da Silva', 'URL-encoded name should be properly decoded');
  console.log('    ✓ URL-encoded name "Prof.%20Jo%C3%A3o%20da%20Silva" -> "Prof. João da Silva"');

  // Case B: Emojis & Symbols
  const resSpec2 = await request.get('/api/submissions')
    .set('X-Device-ID', 'dev_spec_2')
    .set('X-Device-Name', 'iPhone%2015%20Pro%20%F0%9F%93%B1');
  assert.strictEqual(resSpec2.status, 200);
  const userSpec2 = await db.prepare("SELECT * FROM users WHERE google_id = 'device:dev_spec_2'").get();
  assert.strictEqual(userSpec2.name, 'iPhone 15 Pro 📱', 'Emojis in device name should be decoded');
  console.log('    ✓ Emojis "iPhone%2015%20Pro%20%F0%9F%93%B1" -> "iPhone 15 Pro 📱"');

  // Case C: Raw non-encoded UTF-8 with special characters
  const resSpec3 = await request.get('/api/submissions')
    .set('X-Device-ID', 'dev_spec_3')
    .set('X-Device-Name', 'Galaxy S23 Ultra (Docente & Pesquisador)');
  assert.strictEqual(resSpec3.status, 200);
  const userSpec3 = await db.prepare("SELECT * FROM users WHERE google_id = 'device:dev_spec_3'").get();
  assert.strictEqual(userSpec3.name, 'Galaxy S23 Ultra (Docente & Pesquisador)');
  console.log('    ✓ Raw text with parentheses and ampersand handled correctly');

  // Case D: Malformed URL-encoding (e.g. %)
  const resSpec4 = await request.get('/api/submissions')
    .set('X-Device-ID', 'dev_spec_4')
    .set('X-Device-Name', 'Malformed%');
  console.log(`    ℹ Malformed URI encoding status code: ${resSpec4.status}`);
  console.log(`    ℹ Response body for malformed URI:`, resSpec4.body);

  // 1.3 Updating Existing "Docente Mobile" vs Named Users
  console.log('\n  1.3 Updating Existing "Docente Mobile" vs Named Users:');

  // Step A: Create user without name -> "Docente Mobile"
  await request.get('/api/submissions').set('X-Device-ID', 'dev_upd_1');
  let userUpd = await db.prepare("SELECT * FROM users WHERE google_id = 'device:dev_upd_1'").get();
  assert.strictEqual(userUpd.name, 'Docente Mobile');

  // Step B: Send request WITH device name -> should update name from "Docente Mobile" to "Celular do Carlos"
  await request.get('/api/submissions')
    .set('X-Device-ID', 'dev_upd_1')
    .set('X-Device-Name', 'Celular do Carlos');
  userUpd = await db.prepare("SELECT * FROM users WHERE google_id = 'device:dev_upd_1'").get();
  assert.strictEqual(userUpd.name, 'Celular do Carlos', 'Should update Docente Mobile to new device name');
  console.log('    ✓ "Docente Mobile" successfully updated to "Celular do Carlos"');

  // Step C: Send subsequent request WITHOUT device name header -> name should REMAIN "Celular do Carlos"
  await request.get('/api/submissions').set('X-Device-ID', 'dev_upd_1');
  userUpd = await db.prepare("SELECT * FROM users WHERE google_id = 'device:dev_upd_1'").get();
  assert.strictEqual(userUpd.name, 'Celular do Carlos', 'Subsequent request without header must not overwrite set name');
  console.log('    ✓ Subsequent request without header leaves existing name "Celular do Carlos" intact');

  // Step D: Send subsequent request WITH A DIFFERENT device name -> What happens?
  await request.get('/api/submissions')
    .set('X-Device-ID', 'dev_upd_1')
    .set('X-Device-Name', 'Tablet Samsung');
  userUpd = await db.prepare("SELECT * FROM users WHERE google_id = 'device:dev_upd_1'").get();
  console.log(`    ℹ Changing device name on existing user from "Celular do Carlos" to "Tablet Samsung": result name = "${userUpd.name}"`);

  // Step E: User updates custom profile name in DB (e.g. "Prof. Dr. Carlos Silva"), then makes request with X-Device-Name header
  await db.prepare("UPDATE users SET name = 'Prof. Dr. Carlos Silva' WHERE id = ?").run(userUpd.id);
  db.save();
  let userCustom = await db.prepare("SELECT * FROM users WHERE id = ?").get(userUpd.id);
  assert.strictEqual(userCustom.name, 'Prof. Dr. Carlos Silva');

  // Request from device with X-Device-Name: "Tablet Samsung"
  await request.get('/api/submissions')
    .set('X-Device-ID', 'dev_upd_1')
    .set('X-Device-Name', 'Tablet Samsung');
  let userAfterReq = await db.prepare("SELECT * FROM users WHERE id = ?").get(userUpd.id);
  console.log(`    ⚠️ OVERWRITE CHECK: Custom user name "Prof. Dr. Carlos Silva" after X-Device-Name request: result name = "${userAfterReq.name}"`);


  // ----------------------------------------------------
  // FOCUS 2: Multer File Uploads & Static File Serving
  // ----------------------------------------------------
  console.log('\n--- FOCUS 2: Multer File Uploads & Static File Serving ---');

  // 2.1 File Upload with No Extension & Mimetype Fallback
  console.log('  2.1 Upload File with Missing Extension:');

  const createTempFile = (filename, content) => {
    const tmpPath = path.join(__dirname, filename);
    fs.writeFileSync(tmpPath, content);
    return tmpPath;
  };

  // Case A: Missing extension, mimetype = image/png -> .png fallback
  const tmpPng = createTempFile('tmp_png_noext', 'fake png binary content');
  const resUpPng = await request.post('/api/submissions')
    .set('Authorization', `Bearer ${profToken}`)
    .field('tipo', 'curso')
    .field('titulo', 'Curso PNG Test')
    .field('carga_horaria', '20')
    .field('instituicao_promotora', 'Test Inst')
    .attach('arquivo', tmpPng, { filename: 'upload_no_ext', contentType: 'image/png' });
  assert.strictEqual(resUpPng.status, 201);
  const fnPng = resUpPng.body.data.arquivo_path;
  assert.ok(fnPng.endsWith('.png'), `Expected .png extension, got ${fnPng}`);
  console.log(`    ✓ mimetype image/png without ext -> saved as ${fnPng}`);

  // Case B: Missing extension, mimetype = application/pdf -> .pdf fallback
  const tmpPdf = createTempFile('tmp_pdf_noext', '%PDF-1.4 fake pdf content');
  const resUpPdf = await request.post('/api/submissions')
    .set('Authorization', `Bearer ${profToken}`)
    .field('tipo', 'curso')
    .field('titulo', 'Curso PDF Test')
    .field('carga_horaria', '15')
    .field('instituicao_promotora', 'Test Inst')
    .attach('arquivo', tmpPdf, { filename: 'document_no_ext', contentType: 'application/pdf' });
  assert.strictEqual(resUpPdf.status, 201);
  const fnPdf = resUpPdf.body.data.arquivo_path;
  assert.ok(fnPdf.endsWith('.pdf'), `Expected .pdf extension, got ${fnPdf}`);
  console.log(`    ✓ mimetype application/pdf without ext -> saved as ${fnPdf}`);

  // Case C: Missing extension, unknown mimetype = application/octet-stream -> .bin fallback
  const tmpBin = createTempFile('tmp_bin_noext', 'generic binary blob');
  const resUpBin = await request.post('/api/submissions')
    .set('Authorization', `Bearer ${profToken}`)
    .field('tipo', 'curso')
    .field('titulo', 'Curso BIN Test')
    .field('carga_horaria', '10')
    .field('instituicao_promotora', 'Test Inst')
    .attach('arquivo', tmpBin, { filename: 'raw_data', contentType: 'application/octet-stream' });
  assert.strictEqual(resUpBin.status, 201);
  const fnBin = resUpBin.body.data.arquivo_path;
  assert.ok(fnBin.endsWith('.bin'), `Expected .bin extension, got ${fnBin}`);
  console.log(`    ✓ unknown mimetype application/octet-stream without ext -> saved as ${fnBin}`);

  // Clean up temp source files
  [tmpPng, tmpPdf, tmpBin].forEach(f => { try { fs.unlinkSync(f); } catch(e){} });

  // 2.2 Static File Serving (/api/files/:filename)
  console.log('\n  2.2 Static File Serving via /api/files/:filename:');

  // Case A: Serve uploaded PNG
  const resGetPng = await request.get(`/api/files/${fnPng}`);
  assert.strictEqual(resGetPng.status, 200, 'Should return 200 for existing file');
  assert.strictEqual(resGetPng.headers['content-type'], 'image/png');
  const pngContent = resGetPng.text || (Buffer.isBuffer(resGetPng.body) ? resGetPng.body.toString('utf8') : String(resGetPng.body));
  assert.strictEqual(pngContent, 'fake png binary content');
  console.log('    ✓ GET /api/files/:filename (PNG) -> 200 OK with correct Content-Type: image/png');

  // Case B: Serve uploaded PDF
  const resGetPdf = await request.get(`/api/files/${fnPdf}`);
  assert.strictEqual(resGetPdf.status, 200);
  assert.strictEqual(resGetPdf.headers['content-type'], 'application/pdf');
  console.log('    ✓ GET /api/files/:filename (PDF) -> 200 OK with correct Content-Type: application/pdf');

  // Case C: Non-existent file
  const resGet404 = await request.get('/api/files/nonexistent-file-99999.png');
  assert.strictEqual(resGet404.status, 404, 'Non-existent file should return 404');
  console.log('    ✓ GET /api/files/nonexistent.png -> 404 Not Found');

  // Case D: Path Traversal Security Test
  const resGetTraversal = await request.get('/api/files/../../package.json');
  assert.ok([400, 403, 404].includes(resGetTraversal.status), `Path traversal should be blocked, got ${resGetTraversal.status}`);
  console.log(`    ✓ Path traversal attack /api/files/../../package.json blocked with status ${resGetTraversal.status}`);

  // Clean uploaded disk files
  [fnPng, fnPdf, fnBin].forEach(fn => {
    const dp = path.join(__dirname, '..', 'uploads', fn);
    try { fs.unlinkSync(dp); } catch(e){}
  });

  // ----------------------------------------------------
  // FOCUS 3: AI Route Error Handling (grok_api_key)
  // ----------------------------------------------------
  console.log('\n--- FOCUS 3: AI Route Error Handling ---');

  const EXPECTED_AI_ERROR = 'Chave da API xAI Grok não configurada ou inválida. Configure a chave grok_api_key nas configurações do sistema.';

  // 3.1 Missing grok_api_key in settings (key not present)
  console.log('  3.1 Missing grok_api_key in settings table:');
  await db.prepare("DELETE FROM settings WHERE key = 'grok_api_key'").run();
  db.save();

  const resAiNoKey = await request.post(`/api/ai/suggest/${profId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  
  assert.strictEqual(resAiNoKey.status, 400, 'Should return HTTP 400 when key is missing');
  assert.strictEqual(resAiNoKey.body.success, false);
  assert.strictEqual(resAiNoKey.body.error, EXPECTED_AI_ERROR);
  console.log('    ✓ Deleted key -> 400 Bad Request with exact error message');

  // 3.2 Empty grok_api_key in settings
  console.log('  3.2 Empty grok_api_key in settings table:');
  await db.prepare("INSERT INTO settings (key, value) VALUES ('grok_api_key', '')").run();
  db.save();

  const resAiEmptyKey = await request.post(`/api/ai/suggest/${profId}`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.strictEqual(resAiEmptyKey.status, 400, 'Should return HTTP 400 when key is empty');
  assert.strictEqual(resAiEmptyKey.body.success, false);
  assert.strictEqual(resAiEmptyKey.body.error, EXPECTED_AI_ERROR);
  console.log('    ✓ Empty string key "" -> 400 Bad Request with exact error message');

  // 3.3 Whitespace grok_api_key in settings
  console.log('  3.3 Whitespace-only grok_api_key in settings table:');
  await db.prepare("UPDATE settings SET value = '   ' WHERE key = 'grok_api_key'").run();
  db.save();

  const resAiSpaceKey = await request.post(`/api/ai/suggest/${profId}`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.strictEqual(resAiSpaceKey.status, 400, 'Should return HTTP 400 when key is whitespace');
  assert.strictEqual(resAiSpaceKey.body.success, false);
  assert.strictEqual(resAiSpaceKey.body.error, EXPECTED_AI_ERROR);
  console.log('    ✓ Whitespace key "   " -> 400 Bad Request with exact error message');

  // 3.4 Invalid grok_api_key (xAI API returns 401)
  console.log('  3.4 Invalid grok_api_key (calling API with invalid key):');
  await db.prepare("UPDATE settings SET value = 'xai_invalid_fake_key_12345' WHERE key = 'grok_api_key'").run();
  db.save();

  const resAiInvalidKey = await request.post(`/api/ai/suggest/${profId}`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.strictEqual(resAiInvalidKey.status, 400, 'Should return HTTP 400 when key is rejected by xAI');
  assert.strictEqual(resAiInvalidKey.body.success, false);
  assert.strictEqual(resAiInvalidKey.body.error, EXPECTED_AI_ERROR);
  console.log('    ✓ Invalid key "xai_invalid_fake_key_12345" -> 400 Bad Request with exact error message');

  // 3.5 Role Authorization check on AI route
  console.log('  3.5 Authorization check (Professor accessing AI route):');
  const resAiProf = await request.post(`/api/ai/suggest/${profId}`)
    .set('Authorization', `Bearer ${profToken}`);

  assert.strictEqual(resAiProf.status, 403, 'Professor should be denied access (403)');
  assert.strictEqual(resAiProf.body.success, false);
  console.log('    ✓ Professor attempt -> 403 Forbidden');

  console.log('\n====================================================');
  console.log(' ALL CHALLENGER STRESS TESTS COMPLETED SUCCESSFULLY');
  console.log('====================================================\n');
}

runChallengerTests().then(() => {
  closeDb();
  const dbPath = path.join(__dirname, '..', 'test-challenger-m2-2.sqlite');
  try { fs.unlinkSync(dbPath); } catch(e) {}
  try { fs.unlinkSync(dbPath + '-wal'); } catch(e) {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch(e) {}
  process.exit(0);
}).catch(err => {
  console.error('\n❌ CHALLENGER TEST FAILED:', err.message);
  console.error(err.stack);
  closeDb();
  const dbPath = path.join(__dirname, '..', 'test-challenger-m2-2.sqlite');
  try { fs.unlinkSync(dbPath); } catch(e) {}
  try { fs.unlinkSync(dbPath + '-wal'); } catch(e) {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch(e) {}
  process.exit(1);
});
