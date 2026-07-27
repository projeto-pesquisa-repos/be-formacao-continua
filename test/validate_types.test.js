const assert = require('assert');
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'test-secret-key-validation';
process.env.DB_PATH = path.join(__dirname, 'test-validation.sqlite');

const { initDb, closeDb, resetDb } = require('../src/database');

async function runTests() {
  resetDb();
  await initDb();
  
  const app = require('../src/index');
  const supertest = require('supertest');
  const request = supertest(app);

  // Auth: Dev Login
  const res = await request.post('/api/auth/dev-login')
    .send({ email: 'val.test@univ.edu.br', name: 'Validator Test', role: 'professor' });
  const token = res.body.data.token;

  console.log('Testing invalid titulo types...');
  
  const invalidTitles = [[], {}, 123, true, null];
  for (const title of invalidTitles) {
    const response = await request
      .post('/api/submissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'curso', titulo: title, carga_horaria: 10, instituicao_promotora: 'Test' });
      
    assert.strictEqual(response.status, 400, `Expected 400 for invalid title type: ${typeof title}`);
    console.log(`  ✓ PASSED: rejected ${typeof title}`);
  }
}

runTests().then(() => {
    closeDb();
    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
