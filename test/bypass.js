const request = require('supertest');
const app = require('../src/index');
const { resetDb, initDb, getDb } = require('../src/database');

let professorToken;
let coordinatorToken;
let professorId;

async function setup() {
  resetDb();
  await initDb();
  
  // Create tokens
  const profRes = await request(app).post('/api/auth/dev-login').send({
    email: 'prof@example.com', name: 'Prof Gamification', role: 'professor'
  });
  professorToken = profRes.body.data.token;
  professorId = profRes.body.data.user.id;
}

async function runTests() {
  await setup();
  console.log('=== Bypass Tests ===\\n');

  let testNum = 1;

  const data = {
    tipo: 'curso',
    titulo: 'Introdução ao React',
    carga_horaria: 40,
    instituicao_promotora: 'Udemy'
  };

  process.stdout.write(`Test ${testNum++}: Exact duplicate blocked... `);
  const res1 = await request(app).post('/api/submissions').set('Authorization', `Bearer ${professorToken}`).send(data);
  const res2 = await request(app).post('/api/submissions').set('Authorization', `Bearer ${professorToken}`).send(data);
  
  if (res2.status === 400) {
    console.log('✓ PASSED');
  } else {
    console.log(`✗ FAILED (Status: ${res2.status})`);
    process.exit(1);
  }

  process.stdout.write(`Test ${testNum++}: Bypass duplicate with trailing space... `);
  const res3 = await request(app).post('/api/submissions').set('Authorization', `Bearer ${professorToken}`).send({
    ...data,
    titulo: 'Introdução ao React '
  });
  
  if (res3.status === 201) {
    console.log('✗ FAILED - It bypassed validation!');
  } else if (res3.status === 400) {
    console.log('✓ PASSED - Validation blocked trailing space!');
  } else {
    console.log(`? UNEXPECTED STATUS (Status: ${res3.status})`);
  }

  process.stdout.write(`Test ${testNum++}: Bypass duplicate with lowercase... `);
  const res4 = await request(app).post('/api/submissions').set('Authorization', `Bearer ${professorToken}`).send({
    ...data,
    titulo: 'introdução ao react'
  });
  
  if (res4.status === 201) {
    console.log('✗ FAILED - It bypassed validation!');
  } else if (res4.status === 400) {
    console.log('✓ PASSED - Validation blocked lowercase!');
  } else {
    console.log(`? UNEXPECTED STATUS (Status: ${res4.status})`);
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
