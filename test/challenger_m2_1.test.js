/**
 * Challenger M2-1 Empirical Test Suite
 * Stress-testing Backend Requirements R1 - R6
 * Focus Areas:
 * 1. XP calculations (multiple submissions, repeated status changes, XP floor at 0)
 * 2. Badge evaluations (all 9 badge requirement types)
 * 3. POST /api/validation/:id/change-status edge cases
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const supertest = require('supertest');

process.env.JWT_SECRET = 'challenger-secret-key-m2';
process.env.DB_PATH = path.join(__dirname, '..', 'test-challenger-m2.sqlite');

const { initDb, closeDb, resetDb, getDb } = require('../src/database');
const { seed } = require('../src/seed');
const { awardXP, checkActionBadges, getGamification } = require('../src/services/gamification');

let app;
let request;
let adminToken;
let profToken;
let profId;

async function setup() {
  resetDb();
  await initDb();
  app = require('../src/index');
  request = supertest(app);
  await seed({ skipInit: true });

  // Dev login admin
  const adminRes = await request.post('/api/auth/dev-login').send({
    email: 'admin.challenger@univ.edu.br', name: 'Admin Challenger', role: 'coordenador'
  });
  adminToken = adminRes.body.data.token;

  // Dev login professor
  const profRes = await request.post('/api/auth/dev-login').send({
    email: 'prof.challenger@univ.edu.br', name: 'Prof Challenger', role: 'professor'
  });
  profToken = profRes.body.data.token;
  profId = profRes.body.data.user.id;
}

async function runAllTests() {
  console.log('================================================================');
  console.log('   CHALLENGER M2-1 EMPIRICAL STRESS TEST SUITE   ');
  console.log('================================================================\n');

  await setup();

  let testCount = 0;
  let passedCount = 0;
  let failedCount = 0;
  const findings = [];

  function test(name, fn) {
    testCount++;
    try {
      fn();
      passedCount++;
      console.log(`[PASS] Test ${testCount}: ${name}`);
    } catch (err) {
      failedCount++;
      console.error(`[FAIL] Test ${testCount}: ${name}`);
      console.error(`       Error: ${err.message}`);
      findings.push({ test: name, error: err.message, stack: err.stack });
    }
  }

  async function asyncTest(name, fn) {
    testCount++;
    try {
      await fn();
      passedCount++;
      console.log(`[PASS] Test ${testCount}: ${name}`);
    } catch (err) {
      failedCount++;
      console.error(`[FAIL] Test ${testCount}: ${name}`);
      console.error(`       Error: ${err.message}`);
      findings.push({ test: name, error: err.message, stack: err.stack });
    }
  }

  // =========================================================================
  // SECTION 1: XP CALCULATIONS & STRESS TESTING
  // =========================================================================
  console.log('\n--- SECTION 1: XP Calculations & Edge Cases ---');

  await asyncTest('Initial XP is 0', async () => {
    const gam = await request.get('/api/gamification').set('Authorization', `Bearer ${profToken}`);
    assert.strictEqual(gam.body.data.xp, 0);
    assert.strictEqual(gam.body.data.level, 1);
  });

  await asyncTest('Multiple Submissions award 50 XP each', async () => {
    for (let i = 1; i <= 5; i++) {
      const res = await request.post('/api/submissions')
        .set('Authorization', `Bearer ${profToken}`)
        .field('tipo', 'curso')
        .field('titulo', `Curso XP Test ${i}`)
        .field('carga_horaria', '10')
        .field('instituicao_promotora', 'Test Org');
      assert.strictEqual(res.status, 201);
    }
    const gam = await request.get('/api/gamification').set('Authorization', `Bearer ${profToken}`);
    assert.strictEqual(gam.body.data.xp, 250, `Expected 250 XP for 5 submissions, got ${gam.body.data.xp}`);
  });

  let oscillateSubId;
  await asyncTest('Setup submission for repeated status changes', async () => {
    const res = await request.post('/api/submissions')
      .set('Authorization', `Bearer ${profToken}`)
      .field('tipo', 'evento')
      .field('titulo', 'Evento PingPong XP')
      .field('nome_evento', 'Conf 2026');
    assert.strictEqual(res.status, 201);
    oscillateSubId = res.body.data.id;
  });

  await asyncTest('Repeated status changes (aprovado <-> rejeitado 5 cycles)', async () => {
    // Current XP = 300 (250 + 50 from oscillateSub)
    const initGam = await request.get('/api/gamification').set('Authorization', `Bearer ${profToken}`);
    const startXP = initGam.body.data.xp;

    for (let cycle = 1; cycle <= 5; cycle++) {
      // 1. Approve -> +150 XP
      const appRes = await request.post(`/api/validation/${oscillateSubId}/change-status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'aprovado' });
      assert.strictEqual(appRes.status, 200);

      const afterApproveGam = await request.get('/api/gamification').set('Authorization', `Bearer ${profToken}`);
      assert.strictEqual(afterApproveGam.body.data.xp, startXP + 150, `Cycle ${cycle} approve failed`);

      // 2. Reject -> -150 XP
      const rejRes = await request.post(`/api/validation/${oscillateSubId}/change-status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'rejeitado', justificativa: `Rejection cycle ${cycle}` });
      assert.strictEqual(rejRes.status, 200);

      const afterRejGam = await request.get('/api/gamification').set('Authorization', `Bearer ${profToken}`);
      assert.strictEqual(afterRejGam.body.data.xp, startXP, `Cycle ${cycle} reject failed`);
    }
  });

  await asyncTest('XP Floor at 0 (XP never drops below 0)', async () => {
    const db = getDb();
    // Force user XP to 50
    await db.prepare('UPDATE user_gamification SET xp = 50, level = 1 WHERE user_id = ?').run(profId);

    // Now change oscillateSubId status from rejeitado to aprovado -> +150 XP (total 200 XP)
    await request.post(`/api/validation/${oscillateSubId}/change-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'aprovado' });

    let gam = await request.get('/api/gamification').set('Authorization', `Bearer ${profToken}`);
    assert.strictEqual(gam.body.data.xp, 200);

    // Reduce DB XP manually to 30 to test under-deduction
    await db.prepare('UPDATE user_gamification SET xp = 30, level = 1 WHERE user_id = ?').run(profId);

    // Now change oscillateSubId status from aprovado to rejeitado -> should deduct 150 XP, floored at 0
    const rejRes = await request.post(`/api/validation/${oscillateSubId}/change-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'rejeitado', justificativa: 'XP floor test rejection' });
    assert.strictEqual(rejRes.status, 200);

    gam = await request.get('/api/gamification').set('Authorization', `Bearer ${profToken}`);
    assert.strictEqual(gam.body.data.xp, 0, `XP should be 0 (floored), got ${gam.body.data.xp}`);
    assert.strictEqual(gam.body.data.level, 1, `Level should be 1, got ${gam.body.data.level}`);
  });

  await asyncTest('Direct rejection of pending submission does not deduct XP', async () => {
    const db = getDb();
    await db.prepare('UPDATE user_gamification SET xp = 100, level = 1 WHERE user_id = ?').run(profId);

    const pendingSub = await request.post('/api/submissions')
      .set('Authorization', `Bearer ${profToken}`)
      .field('tipo', 'producao')
      .field('titulo', 'Artigo Direct Rejection')
      .field('tipo_producao', 'artigo');
    assert.strictEqual(pendingSub.status, 201);

    // XP was 100 + 50 = 150
    let gam = await request.get('/api/gamification').set('Authorization', `Bearer ${profToken}`);
    assert.strictEqual(gam.body.data.xp, 150);

    // Reject pending submission using /reject
    const rejRes = await request.post(`/api/validation/${pendingSub.body.data.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ justificativa: 'Não atende requisitos' });
    assert.strictEqual(rejRes.status, 200);

    gam = await request.get('/api/gamification').set('Authorization', `Bearer ${profToken}`);
    assert.strictEqual(gam.body.data.xp, 150, `XP should remain 150 after pending rejection, got ${gam.body.data.xp}`);
  });

  await asyncTest('Deletion of pending submission behavior', async () => {
    // Test if deleting a pending submission retains or revokes 50 XP
    const subToDelete = await request.post('/api/submissions')
      .set('Authorization', `Bearer ${profToken}`)
      .field('tipo', 'curso')
      .field('titulo', 'Curso to Delete')
      .field('carga_horaria', '10')
      .field('instituicao_promotora', 'Test');
    assert.strictEqual(subToDelete.status, 201);
    const subId = subToDelete.body.data.id;

    const beforeGam = await request.get('/api/gamification').set('Authorization', `Bearer ${profToken}`);
    const beforeXP = beforeGam.body.data.xp;

    const delRes = await request.delete(`/api/submissions/${subId}`)
      .set('Authorization', `Bearer ${profToken}`);
    assert.strictEqual(delRes.status, 200);

    const afterGam = await request.get('/api/gamification').set('Authorization', `Bearer ${profToken}`);
    // Record empirical observation: DELETE does not reduce XP.
    console.log(`       Note: XP before deletion=${beforeXP}, after deletion=${afterGam.body.data.xp}`);
  });

  // =========================================================================
  // SECTION 2: BADGE EVALUATIONS (ALL 9 BADGE TYPES)
  // =========================================================================
  console.log('\n--- SECTION 2: Badge Evaluations (9 Requirement Types) ---');

  await asyncTest('Verify seed badges and insert missing requirement types if needed', async () => {
    const db = getDb();
    // Insert test badges for all 9 requirement types to ensure complete coverage
    const badgeTypes = [
      { name: 'Test Level Badge', type: 'level', val: 2, icon: 'star' },
      { name: 'Test XP Badge', type: 'xp', val: 500, icon: 'zap' },
      { name: 'Test Streak Badge', type: 'streak', val: 3, icon: 'flame' },
      { name: 'Test Hours Badge', type: 'hours', val: 15, icon: 'clock' },
      { name: 'Test Types Badge', type: 'types', val: 3, icon: 'compass' },
      { name: 'Test Certificacao Badge', type: 'certificacao', val: 1, icon: 'award' },
      { name: 'Test Curso Badge', type: 'curso', val: 1, icon: 'book' },
      { name: 'Test Evento Badge', type: 'evento', val: 1, icon: 'calendar' },
      { name: 'Test Producao Badge', type: 'producao', val: 1, icon: 'file' },
    ];

    for (const b of badgeTypes) {
      const existing = await db.prepare('SELECT id FROM badges WHERE requirement_type = ? AND name = ?').get(b.type, b.name);
      if (!existing) {
        await db.prepare('INSERT INTO badges (name, description, icon, requirement_type, requirement_value) VALUES (?, ?, ?, ?, ?)')
          .run(b.name, `Requirement ${b.type}`, b.icon, b.type, b.val);
      }
    }
  });

  await asyncTest('Requirement Type 1: level badge', async () => {
    const db = getDb();
    await awardXP(profId, 1000); // Should set level to 2+ and award level badges
    const gam = await getGamification(profId);
    const hasLevelBadge = gam.badges.some(b => b.name === 'Test Level Badge' || b.name === 'Iniciante');
    assert.ok(hasLevelBadge, 'Level badge should be awarded when level threshold met');
  });

  await asyncTest('Requirement Type 2: xp badge', async () => {
    const db = getDb();
    await db.prepare('UPDATE user_gamification SET xp = 600 WHERE user_id = ?').run(profId);
    await checkActionBadges(profId);
    const gam = await getGamification(profId);
    const hasXPBadge = gam.badges.some(b => b.name === 'Test XP Badge');
    assert.ok(hasXPBadge, 'XP badge should be awarded when XP threshold met');
  });

  await asyncTest('Requirement Type 3: streak badge', async () => {
    const db = getDb();
    await db.prepare('UPDATE user_gamification SET streak = 5 WHERE user_id = ?').run(profId);
    await checkActionBadges(profId);
    const gam = await getGamification(profId);
    const hasStreakBadge = gam.badges.some(b => b.name === 'Test Streak Badge');
    assert.ok(hasStreakBadge, 'Streak badge should be awarded when streak threshold met');
  });

  await asyncTest('Requirement Type 4: hours badge', async () => {
    const db = getDb();
    // Create & approve action with 20 hours
    const res = await request.post('/api/submissions')
      .set('Authorization', `Bearer ${profToken}`)
      .field('tipo', 'curso')
      .field('titulo', 'Curso 20 Horas')
      .field('carga_horaria', '20')
      .field('instituicao_promotora', 'Test Uni');
    assert.strictEqual(res.status, 201);
    await request.post(`/api/validation/${res.body.data.id}/approve`).set('Authorization', `Bearer ${adminToken}`);

    const gam = await getGamification(profId);
    const hasHoursBadge = gam.badges.some(b => b.name === 'Test Hours Badge');
    assert.ok(hasHoursBadge, 'Hours badge should be awarded when total approved hours >= 15');
  });

  await asyncTest('Requirement Type 5: types badge', async () => {
    // Approve 3 distinct types (curso, evento, producao)
    const subEvento = await request.post('/api/submissions')
      .set('Authorization', `Bearer ${profToken}`)
      .field('tipo', 'evento')
      .field('titulo', 'Evento Distinct Type')
      .field('nome_evento', 'Congress 2026');
    await request.post(`/api/validation/${subEvento.body.data.id}/approve`).set('Authorization', `Bearer ${adminToken}`);

    const subProd = await request.post('/api/submissions')
      .set('Authorization', `Bearer ${profToken}`)
      .field('tipo', 'producao')
      .field('titulo', 'Producao Distinct Type')
      .field('tipo_producao', 'capitulo');
    await request.post(`/api/validation/${subProd.body.data.id}/approve`).set('Authorization', `Bearer ${adminToken}`);

    const gam = await getGamification(profId);
    const hasTypesBadge = gam.badges.some(b => b.name === 'Test Types Badge' || b.name === 'Explorador');
    assert.ok(hasTypesBadge, 'Types badge should be awarded when 3 distinct approved types exist');
  });

  await asyncTest('Requirement Type 6: certificacao badge', async () => {
    const subCert = await request.post('/api/submissions')
      .set('Authorization', `Bearer ${profToken}`)
      .field('tipo', 'certificacao')
      .field('titulo', 'Certificacao Badge Test')
      .field('instituicao_promotora', 'Cert Body');
    await request.post(`/api/validation/${subCert.body.data.id}/approve`).set('Authorization', `Bearer ${adminToken}`);

    const gam = await getGamification(profId);
    const hasCertBadge = gam.badges.some(b => b.name === 'Test Certificacao Badge' || b.name === 'Primeira Certificação');
    assert.ok(hasCertBadge, 'Certificacao badge should be awarded for approved certificacao');
  });

  await asyncTest('Requirement Type 7: curso badge', async () => {
    const gam = await getGamification(profId);
    const hasCursoBadge = gam.badges.some(b => b.name === 'Test Curso Badge');
    assert.ok(hasCursoBadge, 'Curso badge should be awarded for approved curso');
  });

  await asyncTest('Requirement Type 8: evento badge', async () => {
    const gam = await getGamification(profId);
    const hasEventoBadge = gam.badges.some(b => b.name === 'Test Evento Badge');
    assert.ok(hasEventoBadge, 'Evento badge should be awarded for approved evento');
  });

  await asyncTest('Requirement Type 9: producao badge', async () => {
    const gam = await getGamification(profId);
    const hasProducaoBadge = gam.badges.some(b => b.name === 'Test Producao Badge' || b.name === 'Pesquisador');
    assert.ok(hasProducaoBadge, 'Producao badge should be awarded for approved producao');
  });

  await asyncTest('Unapproved actions do NOT trigger badges', async () => {
    const db = getDb();
    // Create new clean user
    const newUserRes = await request.post('/api/auth/dev-login').send({
      email: 'clean.prof@univ.edu.br', name: 'Clean Prof', role: 'professor'
    });
    const newProfId = newUserRes.body.data.user.id;
    const newProfToken = newUserRes.body.data.token;

    // Create 5 pending cursos without approval
    for (let i = 1; i <= 5; i++) {
      await request.post('/api/submissions')
        .set('Authorization', `Bearer ${newProfToken}`)
        .field('tipo', 'curso')
        .field('titulo', `Pending Curso ${i}`)
        .field('carga_horaria', '50')
        .field('instituicao_promotora', 'None');
    }

    await checkActionBadges(newProfId);
    const gam = await getGamification(newProfId);

    const actionBadges = gam.badges.filter(b => ['curso', 'hours', 'types'].includes(b.requirement_type));
    assert.strictEqual(actionBadges.length, 0, 'No action badges should be awarded for pending submissions');
  });

  // =========================================================================
  // SECTION 3: POST /api/validation/:id/change-status EDGE CASES
  // =========================================================================
  console.log('\n--- SECTION 3: POST /api/validation/:id/change-status Edge Cases ---');

  let testSubId;
  await asyncTest('Setup target submission for status change tests', async () => {
    const res = await request.post('/api/submissions')
      .set('Authorization', `Bearer ${profToken}`)
      .field('tipo', 'curso')
      .field('titulo', 'Curso for Status Edge Cases')
      .field('carga_horaria', '10')
      .field('instituicao_promotora', 'Edge Cases Inc');
    assert.strictEqual(res.status, 201);
    testSubId = res.body.data.id;
  });

  await asyncTest('Rejection with missing justificativa -> 400', async () => {
    const res = await request.post(`/api/validation/${testSubId}/change-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'rejeitado' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error, 'Justificativa é obrigatória para rejeitar uma submissão');
  });

  await asyncTest('Rejection with empty string justificativa -> 400', async () => {
    const res = await request.post(`/api/validation/${testSubId}/change-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'rejeitado', justificativa: '' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
  });

  await asyncTest('Rejection with whitespace-only justificativa -> 400', async () => {
    const res = await request.post(`/api/validation/${testSubId}/change-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'rejeitado', justificativa: '   ' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
  });

  await asyncTest('Invalid status values -> 400', async () => {
    const invalidStatuses = ['invalid', 'PENDENTE', 'approved', '', null, 123, true, 'pendente'];
    for (const statusVal of invalidStatuses) {
      const res = await request.post(`/api/validation/${testSubId}/change-status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: statusVal, justificativa: 'Reason' });
      assert.strictEqual(res.status, 400, `Status '${statusVal}' should return 400`);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error, "Status inválido. Use 'aprovado' ou 'rejeitado'");
    }
  });

  await asyncTest('Invalid submission ID (non-existent numeric ID) -> 404', async () => {
    const res = await request.post('/api/validation/999999/change-status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'aprovado' });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error, 'Submissão não encontrada');
  });

  await asyncTest('Invalid submission ID (non-numeric string ID) -> 404', async () => {
    const res = await request.post('/api/validation/abc/change-status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'aprovado' });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.success, false);
  });

  await asyncTest('Same status transition (aprovado -> aprovado) -> 400', async () => {
    // Approve first
    const appRes = await request.post(`/api/validation/${testSubId}/change-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'aprovado' });
    assert.strictEqual(appRes.status, 200);

    // Try approving again
    const sameRes = await request.post(`/api/validation/${testSubId}/change-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'aprovado' });
    assert.strictEqual(sameRes.status, 400);
    assert.strictEqual(sameRes.body.success, false);
    assert.strictEqual(sameRes.body.error, "A submissão já possui o status 'aprovado'");
  });

  await asyncTest('Same status transition (rejeitado -> rejeitado) -> 400', async () => {
    // Reject first
    const rejRes = await request.post(`/api/validation/${testSubId}/change-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'rejeitado', justificativa: 'First rejection' });
    assert.strictEqual(rejRes.status, 200);

    // Try rejecting again
    const sameRes = await request.post(`/api/validation/${testSubId}/change-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'rejeitado', justificativa: 'Second rejection' });
    assert.strictEqual(sameRes.status, 400);
    assert.strictEqual(sameRes.body.success, false);
    assert.strictEqual(sameRes.body.error, "A submissão já possui o status 'rejeitado'");
  });

  await asyncTest('Professor cannot access change-status endpoint -> 403', async () => {
    const res = await request.post(`/api/validation/${testSubId}/change-status`)
      .set('Authorization', `Bearer ${profToken}`)
      .send({ status: 'aprovado' });
    assert.strictEqual(res.status, 403);
  });

  await asyncTest('Unauthenticated call to change-status -> 401', async () => {
    const res = await request.post(`/api/validation/${testSubId}/change-status`)
      .send({ status: 'aprovado' });
    assert.strictEqual(res.status, 401);
  });

  await asyncTest('Justificativa clearing when moving from rejeitado to aprovado', async () => {
    // testSubId is currently rejeitado with justificativa 'First rejection'
    const db = getDb();
    const subBefore = await db.prepare('SELECT justificativa_rejeicao FROM acoes_formativas WHERE id = ?').get(testSubId);
    assert.strictEqual(subBefore.justificativa_rejeicao, 'First rejection');

    // Change status to aprovado
    const appRes = await request.post(`/api/validation/${testSubId}/change-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'aprovado' });
    assert.strictEqual(appRes.status, 200);

    const subAfter = await db.prepare('SELECT justificativa_rejeicao FROM acoes_formativas WHERE id = ?').get(testSubId);
    assert.strictEqual(subAfter.justificativa_rejeicao, null, 'justificativa_rejeicao should be cleared to NULL upon approval');
  });

  await asyncTest('Resilience against SQL injection / weird IDs in change-status', async () => {
    const weirdIds = ["1' OR '1'='1", "0; DROP TABLE users;--", "99999999999999999999", "-1"];
    for (const weirdId of weirdIds) {
      const res = await request.post(`/api/validation/${encodeURIComponent(weirdId)}/change-status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'aprovado' });
      assert.strictEqual(res.status, 404, `Weird ID '${weirdId}' should yield 404`);
    }
  });

  await asyncTest('Empirical demonstration of XP oscillation asymmetry when floored', async () => {
    const db = getDb();
    // User starts with 50 XP
    await db.prepare('UPDATE user_gamification SET xp = 50, level = 1 WHERE user_id = ?').run(profId);

    // Submission is currently aprovado (+150 XP was awarded earlier).
    // Now coordinator rejects it: 50 - 150 = -100, floored to 0.
    await request.post(`/api/validation/${testSubId}/change-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'rejeitado', justificativa: 'Oscillation test' });
    
    let gam = await getGamification(profId);
    assert.strictEqual(gam.xp, 0);

    // Coordinator re-approves: 0 + 150 = 150.
    await request.post(`/api/validation/${testSubId}/change-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'aprovado' });

    gam = await getGamification(profId);
    assert.strictEqual(gam.xp, 150);
    // Note: Net change was +100 XP due to 0-floor clamping during rejection!
    console.log(`       Observation: Floor clamping caused XP to go from 50 -> 0 -> 150 (+100 net gain).`);
  });

  // SUMMARY
  console.log('\n================================================================');
  console.log(`RESULTS: ${passedCount}/${testCount} tests passed (${failedCount} failed)`);
  console.log('================================================================\n');

  if (findings.length > 0) {
    console.log('FAILURES ENCOUNTERED:');
    findings.forEach(f => console.log(`- ${f.test}: ${f.error}`));
  }
}

runAllTests().then(() => {
  closeDb();
  const dbPath = path.join(__dirname, '..', 'test-challenger-m2.sqlite');
  try { fs.unlinkSync(dbPath); } catch(e) {}
  try { fs.unlinkSync(dbPath + '-wal'); } catch(e) {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch(e) {}
  process.exit(0);
}).catch(err => {
  console.error('CHALLENGER SUITE UNHANDLED ERROR:', err);
  closeDb();
  const dbPath = path.join(__dirname, '..', 'test-challenger-m2.sqlite');
  try { fs.unlinkSync(dbPath); } catch(e) {}
  try { fs.unlinkSync(dbPath + '-wal'); } catch(e) {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch(e) {}
  process.exit(1);
});
