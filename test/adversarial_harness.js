/**
 * Adversarial test harness for submission duplicate prevention.
 * Tests edge cases like control characters, unusual whitespace.
 */
const request = require('supertest');
const app = require('../src/index');
const { getDb } = require('../src/database');

async function testEdgeCases(professorToken, areaId) {
  const agent = request(app);
  console.log('--- Adversarial Testing: Edge Cases ---');

  const testCases = [
    { name: 'Control char (null)', titulo: 'Curso\0Teste', tipo: 'curso' },
    { name: 'Control char (newline)', titulo: 'Curso\nTeste', tipo: 'curso' },
    { name: 'Control char (tab)', titulo: 'Curso\tTeste', tipo: 'curso' },
    { name: 'Unicode escape', titulo: 'Curso\u0000Teste', tipo: 'curso' },
  ];

  for (const tc of testCases) {
    console.log(`Testing: ${tc.name}`);
    // First, submit one
    await agent.post('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`)
      .field('tipo', tc.tipo)
      .field('titulo', tc.titulo)
      .field('carga_horaria', '10')
      .field('instituicao_promotora', 'TestOrg');

    // Try to submit the same (or normalized same)
    const res = await agent.post('/api/submissions')
      .set('Authorization', `Bearer ${professorToken}`)
      .field('tipo', tc.tipo)
      .field('titulo', tc.titulo)
      .field('carga_horaria', '10')
      .field('instituicao_promotora', 'TestOrg');

    if (res.status !== 400) {
      throw new Error(`Failed to reject duplicate: ${tc.name}`);
    }
    console.log(`  ✓ Passed: Rejected ${tc.name}`);
  }
}
