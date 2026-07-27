const request = require('supertest');
const app = require('../src/index');
const { resetDb, initDb, getDb } = require('../src/database');

async function runBypassTest() {
  resetDb();
  await initDb();
  const db = getDb();
  
  db.prepare("INSERT INTO badges (name, description, icon, requirement_type, requirement_value) VALUES ('Curso 1', 'Fez 1 curso', '📚', 'curso', 1)").run();
  db.prepare("INSERT INTO badges (name, description, icon, requirement_type, requirement_value) VALUES ('Curso 2', 'Fez 2 cursos', '📚📚', 'curso', 2)").run();

  const prof = await request(app).post('/api/auth/dev-login').send({
    email: 'hacker@example.com', name: 'Hacker', role: 'professor'
  });
  const profToken = prof.body.data.token;

  const coord = await request(app).post('/api/auth/dev-login').send({
    email: 'coordhack@example.com', name: 'Coord', role: 'coordenador'
  });
  const coordToken = coord.body.data.token;

  console.log('Sending first submission...');
  const sub1 = await request(app).post('/api/submissions').set('Authorization', `Bearer ${profToken}`)
    .field('tipo', 'curso').field('titulo', 'Meu Curso').field('carga_horaria', 20).field('instituicao_promotora', 'USP');
  console.log('Sub1 status:', sub1.status);

  console.log('Approving first submission...');
  await request(app).post(`/api/validation/${sub1.body.data.id}/approve`).set('Authorization', `Bearer ${coordToken}`);

  console.log('Sending second submission with trailing space...');
  const sub2 = await request(app).post('/api/submissions').set('Authorization', `Bearer ${profToken}`)
    .field('tipo', 'curso').field('titulo', 'Meu Curso ').field('carga_horaria', 20).field('instituicao_promotora', 'USP');
  console.log('Sub2 status:', sub2.status);

  if (sub2.status === 201) {
    console.log('VULNERABILITY FOUND: Bypassed duplicate check with trailing space.');
    console.log('Approving second submission...');
    await request(app).post(`/api/validation/${sub2.body.data.id}/approve`).set('Authorization', `Bearer ${coordToken}`);
    
    let g1 = await request(app).get('/api/gamification').set('Authorization', `Bearer ${profToken}`);
    console.log('Gamification state:', JSON.stringify(g1.body.data, null, 2));
    if (g1.body.data.points >= 200) {
      console.log('VULNERABILITY CONFIRMED: Extra points awarded for duplicate submission.');
    }
  } else {
    console.log('Bypass failed. Duplicate check is robust against trailing spaces (or blocked it somehow).');
  }
}
runBypassTest().catch(console.error);
