const request = require('supertest');
const app = require('../src/index');
const { resetDb, initDb, getDb } = require('../src/database');

let professorToken;
let coordinatorToken;
let professorId;
let coordinatorId;

async function setup() {
  resetDb();
  await initDb();
  
  // Create tokens
  const profRes = await request(app).post('/api/auth/dev-login').send({
    email: 'prof@example.com', name: 'Prof Gamification', role: 'professor'
  });
  professorToken = profRes.body.data.token;
  professorId = profRes.body.data.user.id;

  const coordRes = await request(app).post('/api/auth/dev-login').send({
    email: 'coord@example.com', name: 'Coord', role: 'coordenador'
  });
  coordinatorToken = coordRes.body.data.token;
  coordinatorId = coordRes.body.data.user.id;

  // Insert seed data for badges if they don't exist
  const db = getDb();
  await db.prepare("INSERT INTO badges (name, description, icon, requirement_type, requirement_value) VALUES ('Iniciante', 'Primeiro passo', '⭐', 'level', 1)").run();
  await db.prepare("INSERT INTO badges (name, description, icon, requirement_type, requirement_value) VALUES ('Intermediário', 'Nível 2', '🌟', 'level', 2)").run();
  await db.prepare("INSERT INTO badges (name, description, icon, requirement_type, requirement_value) VALUES ('Pesquisador', 'Primeira produção', '🔬', 'producao', 1)").run();
}

async function runTests() {
  await setup();
  console.log('=== Gamification Tests ===\\n');

  let testNum = 1;

  // Test 1: Initially, gamification data should be 0 XP and level 1
  process.stdout.write(`Test ${testNum++}: Initial gamification data is 0 XP, Level 1... `);
  const res1 = await request(app).get('/api/gamification').set('Authorization', `Bearer ${professorToken}`);
  if (res1.status === 200 && res1.body.data.xp === 0 && res1.body.data.level === 1) {
    console.log('✓ PASSED');
  } else {
    console.log('✗ FAILED');
    console.log(res1.body);
    process.exit(1);
  }

  // Test 2: Submission awards 50 XP
  process.stdout.write(`Test ${testNum++}: Submitting awards 50 XP... `);
  const subRes = await request(app)
    .post('/api/submissions')
    .set('Authorization', `Bearer ${professorToken}`)
    .field('tipo', 'curso')
    .field('titulo', 'Curso de Gamificacao')
    .field('carga_horaria', 20)
    .field('instituicao_promotora', 'USP');
  
  if (subRes.status !== 201) {
    console.log('✗ FAILED (Submission error)');
    console.log(subRes.body);
    process.exit(1);
  }

  const res2 = await request(app).get('/api/gamification').set('Authorization', `Bearer ${professorToken}`);
  if (res2.status === 200 && res2.body.data.xp === 50 && res2.body.data.level === 1) {
    console.log('✓ PASSED');
  } else {
    console.log('✗ FAILED');
    console.log(res2.body);
    process.exit(1);
  }

  const submissionId = subRes.body.data.id;

  // Test 3: Validation (Approve) awards 150 XP (total 200 XP)
  process.stdout.write(`Test ${testNum++}: Approving awards 150 XP... `);
  const approveRes = await request(app)
    .post(`/api/validation/${submissionId}/approve`)
    .set('Authorization', `Bearer ${coordinatorToken}`);
  
  if (approveRes.status !== 200) {
    console.log('✗ FAILED (Approve error)');
    console.log(approveRes.body);
    process.exit(1);
  }

  const res3 = await request(app).get('/api/gamification').set('Authorization', `Bearer ${professorToken}`);
  if (res3.status === 200 && res3.body.data.xp === 200) {
    console.log('✓ PASSED');
  } else {
    console.log('✗ FAILED');
    console.log(res3.body);
    process.exit(1);
  }

  // Test 4: Level up when XP >= 1000
  process.stdout.write(`Test ${testNum++}: XP above 1000 increases level... `);
  // Let's directly award XP
  const { awardXP } = require('../src/services/gamification');
  await awardXP(professorId, 900); // total 1100 (200 + 900)
  
  const res4 = await request(app).get('/api/gamification').set('Authorization', `Bearer ${professorToken}`);
  if (res4.status === 200 && res4.body.data.xp === 1100 && res4.body.data.level === 2) {
    console.log('✓ PASSED');
  } else {
    console.log('✗ FAILED');
    console.log(res4.body);
    process.exit(1);
  }

  // Test 5: Action badge is awarded on submission approval
  process.stdout.write(`Test ${testNum++}: Action badge is awarded... `);
  
  const subProdRes = await request(app)
    .post('/api/submissions')
    .set('Authorization', `Bearer ${professorToken}`)
    .field('tipo', 'producao')
    .field('titulo', 'Artigo de Gamificacao')
    .field('tipo_producao', 'artigo');
    
  if (subProdRes.status !== 201) {
    console.log('✗ FAILED (Submission error)');
    console.log(subProdRes.body);
    process.exit(1);
  }

  const subProdId = subProdRes.body.data.id;

  const approveProdRes = await request(app)
    .post(`/api/validation/${subProdId}/approve`)
    .set('Authorization', `Bearer ${coordinatorToken}`);
    
  if (approveProdRes.status !== 200) {
    console.log('✗ FAILED (Approve error)');
    console.log(approveProdRes.body);
    process.exit(1);
  }

  const res5 = await request(app).get('/api/gamification').set('Authorization', `Bearer ${professorToken}`);
  const hasActionBadge = res5.body.data.badges && res5.body.data.badges.some(b => b.name === 'Pesquisador');
  
  if (res5.status === 200 && hasActionBadge) {
    console.log('✓ PASSED');
  } else {
    console.log('✗ FAILED');
    console.log(res5.body);
    process.exit(1);
  }

  // Test 6: Leaderboard returns users ordered by XP DESC
  process.stdout.write(`Test ${testNum++}: GET /api/gamification/leaderboard returns ranked data... `);
  const res6 = await request(app).get('/api/gamification/leaderboard').set('Authorization', `Bearer ${professorToken}`);
  if (res6.status === 200 && res6.body.success && Array.isArray(res6.body.data)) {
    const leaderboard = res6.body.data;
    if (leaderboard.length >= 2 && leaderboard[0].xp >= leaderboard[1].xp && leaderboard[0].rank === 1) {
      console.log('✓ PASSED');
    } else {
      console.log('✗ FAILED (Invalid leaderboard ordering or ranks)');
      console.log(leaderboard);
      process.exit(1);
    }
  } else {
    console.log('✗ FAILED');
    console.log(res6.body);
    process.exit(1);
  }

  // Test 7: GET /api/gamification/badges returns all badges
  process.stdout.write(`Test ${testNum++}: GET /api/gamification/badges returns badges list... `);
  const res7 = await request(app).get('/api/gamification/badges').set('Authorization', `Bearer ${professorToken}`);
  if (res7.status === 200 && res7.body.success && Array.isArray(res7.body.data) && res7.body.data.length >= 3) {
    console.log('✓ PASSED');
  } else {
    console.log('✗ FAILED');
    console.log(res7.body);
    process.exit(1);
  }

  console.log('\n=== All gamification tests passed! ===\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
