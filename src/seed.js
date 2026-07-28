require('dotenv').config();
const bcrypt = require('bcryptjs');

const { getDb, initDb, closeDb } = require('./database');

async function seed({ skipInit = false } = {}) {
  if (!skipInit) {
    console.log('Initializing database...');
    await initDb();
  }
  const db = getDb();

  console.log('Clearing existing data...');
  if (db.isPg) {
    await db.exec(`
      TRUNCATE TABLE acoes_formativas, user_badges, user_gamification, badges, users, areas_conhecimento, departments CASCADE;
    `);
  } else {
    db.exec(`
      DELETE FROM acoes_formativas;
      DELETE FROM user_badges;
      DELETE FROM user_gamification;
      DELETE FROM badges;
      DELETE FROM users;
      DELETE FROM areas_conhecimento;
      DELETE FROM departments;
    `);
    try {
      db.exec(`
        DELETE FROM sqlite_sequence WHERE name IN ('departments', 'areas_conhecimento', 'users', 'acoes_formativas');
      `);
    } catch (e) {}
  }

  console.log('Creating departments...');
  const insertDept = db.prepare('INSERT INTO departments (name) VALUES (?)');
  const deptExatas = (await insertDept.run('Ciências Exatas')).lastInsertRowid;
  const deptHumanas = (await insertDept.run('Ciências Humanas')).lastInsertRowid;
  const deptSaude = (await insertDept.run('Ciências da Saúde')).lastInsertRowid;

  console.log('Creating áreas de conhecimento...');
  const insertArea = db.prepare('INSERT INTO areas_conhecimento (name, department_id) VALUES (?, ?)');

  // Ciências Exatas
  const areaMatematica = (await insertArea.run('Matemática', deptExatas)).lastInsertRowid;
  const areaFisica = (await insertArea.run('Física', deptExatas)).lastInsertRowid;
  const areaComputacao = (await insertArea.run('Computação', deptExatas)).lastInsertRowid;

  // Ciências Humanas
  const areaPedagogia = (await insertArea.run('Pedagogia', deptHumanas)).lastInsertRowid;
  const areaPsicologia = (await insertArea.run('Psicologia', deptHumanas)).lastInsertRowid;
  const areaHistoria = (await insertArea.run('História', deptHumanas)).lastInsertRowid;

  // Ciências da Saúde
  const areaEnfermagem = (await insertArea.run('Enfermagem', deptSaude)).lastInsertRowid;
  const areaFarmacia = (await insertArea.run('Farmácia', deptSaude)).lastInsertRowid;
  const areaNutricao = (await insertArea.run('Nutrição', deptSaude)).lastInsertRowid;

  const coordPassword = bcrypt.hashSync('admin123', 10);
  const profPassword = bcrypt.hashSync('professor123', 10);

  console.log('Creating users...');
  const insertUser = db.prepare(`
    INSERT INTO users (google_id, email, name, password_hash, must_change_password, role, department_id) VALUES (?, ?, ?, ?, 0, ?, ?)
  `);

  // Coordinators
  const coord1 = (await insertUser.run('google_coord_001', 'maria.silva@univ.edu.br', 'Maria da Silva', coordPassword, 'coordenador', null)).lastInsertRowid;
  const coord2 = (await insertUser.run('google_coord_002', 'joao.santos@univ.edu.br', 'João Santos', coordPassword, 'coordenador', null)).lastInsertRowid;

  // Professors - Ciências Exatas
  const prof1 = (await insertUser.run('google_prof_001', 'ana.oliveira@univ.edu.br', 'Ana Oliveira', profPassword, 'professor', deptExatas)).lastInsertRowid;
  const prof2 = (await insertUser.run('google_prof_002', 'carlos.ferreira@univ.edu.br', 'Carlos Ferreira', profPassword, 'professor', deptExatas)).lastInsertRowid;
  const prof3 = (await insertUser.run('google_prof_003', 'patricia.lima@univ.edu.br', 'Patrícia Lima', profPassword, 'professor', deptExatas)).lastInsertRowid;
  const prof4 = (await insertUser.run('google_prof_004', 'roberto.mendes@univ.edu.br', 'Roberto Mendes', profPassword, 'professor', deptExatas)).lastInsertRowid;

  // Professors - Ciências Humanas
  const prof5 = (await insertUser.run('google_prof_005', 'fernanda.costa@univ.edu.br', 'Fernanda Costa', profPassword, 'professor', deptHumanas)).lastInsertRowid;
  const prof6 = (await insertUser.run('google_prof_006', 'ricardo.almeida@univ.edu.br', 'Ricardo Almeida', profPassword, 'professor', deptHumanas)).lastInsertRowid;
  const prof7 = (await insertUser.run('google_prof_007', 'juliana.rocha@univ.edu.br', 'Juliana Rocha', profPassword, 'professor', deptHumanas)).lastInsertRowid;

  // Professors - Ciências da Saúde
  const prof8 = (await insertUser.run('google_prof_008', 'marcos.souza@univ.edu.br', 'Marcos Souza', profPassword, 'professor', deptSaude)).lastInsertRowid;
  const prof9 = (await insertUser.run('google_prof_009', 'camila.pereira@univ.edu.br', 'Camila Pereira', profPassword, 'professor', deptSaude)).lastInsertRowid;
  const prof10 = (await insertUser.run('google_prof_010', 'luciana.barbosa@univ.edu.br', 'Luciana Barbosa', profPassword, 'professor', deptSaude)).lastInsertRowid;

  console.log('Creating ações formativas...');
  const insertAcao = db.prepare(`
    INSERT INTO acoes_formativas (
      user_id, tipo, titulo, descricao,
      carga_horaria, instituicao_promotora, data_conclusao,
      tipo_participacao, nome_evento, local_evento,
      tipo_producao, doi_isbn,
      status, justificativa_rejeicao, validado_por, validado_em,
      area_conhecimento_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Helper for dates
  const d = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const ts = (year, month, day) => `${d(year, month, day)} 10:00:00`;

  // ========== CURSOS ==========

  await insertAcao.run(
    prof1, 'curso', 'Métodos Numéricos Avançados com Python',
    'Curso sobre implementação de métodos numéricos usando Python e NumPy',
    40, 'IMPA - Instituto de Matemática Pura e Aplicada', d(2026, 3, 15),
    null, null, null, null, null,
    'aprovado', null, coord1, ts(2026, 3, 20),
    areaMatematica, ts(2026, 3, 1)
  );

  await insertAcao.run(
    prof1, 'curso', 'Estatística Bayesiana Aplicada',
    'Introdução à inferência bayesiana para análise de dados educacionais',
    30, 'Universidade de São Paulo (USP)', d(2025, 11, 20),
    null, null, null, null, null,
    'aprovado', null, coord1, ts(2025, 12, 1),
    areaMatematica, ts(2025, 11, 1)
  );

  await insertAcao.run(
    prof2, 'curso', 'Física Quântica para o Ensino Superior',
    'Atualização em mecânica quântica com simulações computacionais',
    60, 'Sociedade Brasileira de Física (SBF)', d(2026, 5, 10),
    null, null, null, null, null,
    'aprovado', null, coord1, ts(2026, 5, 15),
    areaFisica, ts(2026, 4, 1)
  );

  await insertAcao.run(
    prof2, 'curso', 'Laboratório Virtual de Física',
    'Capacitação em ferramentas de simulação para ensino remoto',
    20, 'PhET Interactive Simulations / UFRGS', d(2025, 8, 30),
    null, null, null, null, null,
    'aprovado', null, coord2, ts(2025, 9, 5),
    areaFisica, ts(2025, 8, 1)
  );

  await insertAcao.run(
    prof3, 'curso', 'Inteligência Artificial na Educação',
    'Uso de IA generativa como ferramenta pedagógica',
    40, 'Google for Education', d(2025, 11, 15),
    null, null, null, null, null,
    'aprovado', null, coord1, ts(2025, 11, 20),
    areaComputacao, ts(2025, 11, 1)
  );

  await insertAcao.run(
    prof4, 'curso', 'Cálculo Diferencial: Novas Abordagens',
    'Workshop sobre ensino de cálculo com tecnologias digitais',
    16, 'Universidade Estadual de Campinas (UNICAMP)', d(2024, 6, 20),
    null, null, null, null, null,
    'aprovado', null, coord2, ts(2024, 7, 1),
    areaMatematica, ts(2024, 6, 1)
  );

  await insertAcao.run(
    prof5, 'curso', 'Metodologias Ativas no Ensino Superior',
    'Formação completa sobre PBL, Sala de Aula Invertida e Gamificação',
    80, 'Instituto Península', d(2026, 4, 30),
    null, null, null, null, null,
    'aprovado', null, coord1, ts(2026, 5, 5),
    areaPedagogia, ts(2026, 4, 1)
  );

  await insertAcao.run(
    prof5, 'curso', 'Avaliação Formativa e Feedback Efetivo',
    'Estratégias de avaliação centradas na aprendizagem',
    24, 'Fundação Lemann', d(2026, 2, 28),
    null, null, null, null, null,
    'pendente', null, null, null,
    areaPedagogia, ts(2026, 2, 15)
  );

  await insertAcao.run(
    prof6, 'curso', 'Neurociência e Aprendizagem',
    'Bases neurocientíficas dos processos de aprendizagem em adultos',
    32, 'Instituto de Neurociências Aplicadas', d(2026, 1, 25),
    null, null, null, null, null,
    'aprovado', null, coord2, ts(2026, 2, 1),
    areaPsicologia, ts(2026, 1, 10)
  );

  await insertAcao.run(
    prof7, 'curso', 'História Digital: Humanidades e Tecnologia',
    'Uso de ferramentas digitais na pesquisa e ensino de história',
    40, 'Associação Nacional de História (ANPUH)', d(2026, 6, 10),
    null, null, null, null, null,
    'rejeitado', 'Comprovante de conclusão ilegível. Por favor, reenvie o certificado em melhor resolução.', coord1, ts(2026, 6, 15),
    areaHistoria, ts(2026, 6, 1)
  );

  await insertAcao.run(
    prof7, 'curso', 'Paleografia e Fontes Documentais',
    'Leitura e interpretação de documentos históricos',
    20, 'Arquivo Nacional', d(2026, 5, 15),
    null, null, null, null, null,
    'pendente', null, null, null,
    areaHistoria, ts(2026, 5, 1)
  );

  await insertAcao.run(
    prof8, 'curso', 'Enfermagem Baseada em Evidências',
    'Metodologias de pesquisa para prática clínica em enfermagem',
    48, 'Conselho Federal de Enfermagem (COFEN)', d(2026, 4, 20),
    null, null, null, null, null,
    'aprovado', null, coord1, ts(2026, 4, 25),
    areaEnfermagem, ts(2026, 4, 1)
  );

  await insertAcao.run(
    prof9, 'curso', 'Farmacologia Clínica Atualizada',
    'Atualização em farmacologia com foco em interações medicamentosas',
    36, 'Conselho Federal de Farmácia (CFF)', d(2026, 3, 30),
    null, null, null, null, null,
    'aprovado', null, coord2, ts(2026, 4, 5),
    areaFarmacia, ts(2026, 3, 15)
  );

  await insertAcao.run(
    prof10, 'curso', 'Nutrição Funcional e Integrativa',
    'Abordagens integrativas na prática clínica nutricional',
    40, 'Associação Brasileira de Nutrição (ASBRAN)', d(2025, 10, 15),
    null, null, null, null, null,
    'aprovado', null, coord1, ts(2025, 10, 20),
    areaNutricao, ts(2025, 10, 1)
  );

  // ========== EVENTOS ==========

  await insertAcao.run(
    prof1, 'evento', 'XXII Congresso Brasileiro de Matemática Aplicada',
    'Apresentação de trabalho sobre modelos matemáticos preditivos',
    null, null, null,
    'apresentador', 'CNMAC 2026', 'São Paulo, SP',
    null, null,
    'aprovado', null, coord1, ts(2026, 6, 20),
    areaMatematica, ts(2026, 6, 10)
  );

  await insertAcao.run(
    prof2, 'evento', 'Simpósio Nacional de Ensino de Física',
    'Participação como ouvinte nas sessões de metodologias ativas',
    null, null, null,
    'ouvinte', 'SNEF 2026', 'Curitiba, PR',
    null, null,
    'pendente', null, null, null,
    areaFisica, ts(2026, 7, 1)
  );

  await insertAcao.run(
    prof3, 'evento', 'Semana Nacional de Ciência e Tecnologia',
    'Palestra sobre tendências em computação quântica',
    null, null, null,
    'apresentador', 'SNCT 2025', 'Brasília, DF',
    null, null,
    'aprovado', null, coord2, ts(2025, 10, 25),
    areaComputacao, ts(2025, 10, 15)
  );

  await insertAcao.run(
    prof5, 'evento', 'Encontro Nacional de Didática e Práticas de Ensino',
    'Apresentação de pesquisa sobre gamificação no ensino superior',
    null, null, null,
    'apresentador', 'ENDIPE 2026', 'Salvador, BA',
    null, null,
    'aprovado', null, coord1, ts(2026, 5, 25),
    areaPedagogia, ts(2026, 5, 10)
  );

  await insertAcao.run(
    prof6, 'evento', 'Congresso Brasileiro de Psicologia',
    'Mesa redonda sobre saúde mental no ambiente acadêmico',
    null, null, null,
    'apresentador', 'CBP 2026', 'Rio de Janeiro, RJ',
    null, null,
    'pendente', null, null, null,
    areaPsicologia, ts(2026, 7, 5)
  );

  await insertAcao.run(
    prof8, 'evento', 'Congresso Brasileiro de Enfermagem',
    'Participação em workshop de simulação realística',
    null, null, null,
    'ouvinte', 'CBEn 2026', 'Florianópolis, SC',
    null, null,
    'aprovado', null, coord1, ts(2026, 3, 15),
    areaEnfermagem, ts(2026, 3, 5)
  );

  await insertAcao.run(
    prof9, 'evento', 'Simpósio Internacional de Farmácia Clínica',
    'Apresentação de poster sobre farmacovigilância',
    null, null, null,
    'apresentador', 'SIFC 2026', 'Porto Alegre, RS',
    null, null,
    'rejeitado', 'Certificado de participação não corresponde ao evento informado. Verifique os dados.', coord2, ts(2026, 5, 20),
    areaFarmacia, ts(2026, 5, 10)
  );

  await insertAcao.run(
    prof10, 'evento', 'Jornada de Nutrição Clínica',
    'Participação em oficina de avaliação nutricional',
    null, null, null,
    'ouvinte', 'JNC 2026', 'Belo Horizonte, MG',
    null, null,
    'pendente', null, null, null,
    areaNutricao, ts(2026, 6, 15)
  );

  // ========== PRODUÇÕES ACADÊMICAS ==========

  await insertAcao.run(
    prof1, 'producao', 'Modelagem Matemática no Ensino de Cálculo: Uma Revisão Sistemática',
    'Artigo publicado na Revista Brasileira de Educação Matemática',
    null, null, null,
    null, null, null,
    'artigo', '10.1590/s0103-636x2026000100012',
    'aprovado', null, coord1, ts(2026, 2, 10),
    areaMatematica, ts(2026, 1, 15)
  );

  await insertAcao.run(
    prof2, 'producao', 'Experimentos de Física com Materiais de Baixo Custo',
    'Capítulo de livro publicado pela Editora UFRGS',
    null, null, null,
    null, null, null,
    'capitulo_livro', '978-85-386-0512-3',
    'aprovado', null, coord2, ts(2026, 4, 10),
    areaFisica, ts(2026, 3, 20)
  );

  await insertAcao.run(
    prof5, 'producao', 'Gamificação como Estratégia Pedagógica no Ensino Superior Brasileiro',
    'Artigo publicado na Revista Educação & Sociedade',
    null, null, null,
    null, null, null,
    'artigo', '10.1590/es.252876',
    'aprovado', null, coord1, ts(2026, 6, 5),
    areaPedagogia, ts(2026, 5, 20)
  );

  await insertAcao.run(
    prof6, 'producao', 'Burnout Docente: Fatores de Risco e Proteção em IES Privadas',
    'Artigo submetido à Revista Psicologia: Ciência e Profissão',
    null, null, null,
    null, null, null,
    'artigo', null,
    'pendente', null, null, null,
    areaPsicologia, ts(2026, 7, 1)
  );

  await insertAcao.run(
    prof8, 'producao', 'Manual de Simulação Realística para Enfermagem',
    'Livro publicado pela Editora Atheneu',
    null, null, null,
    null, null, null,
    'livro', '978-85-388-0932-1',
    'aprovado', null, coord1, ts(2026, 2, 20),
    areaEnfermagem, ts(2026, 1, 30)
  );

  await insertAcao.run(
    prof10, 'producao', 'Impacto da Dieta Mediterrânea na Saúde de Docentes Universitários',
    'Artigo em colaboração com o Departamento de Nutrição da USP',
    null, null, null,
    null, null, null,
    'artigo', '10.1016/j.nutres.2026.03.005',
    'rejeitado', 'O artigo informado ainda está em fase de revisão e não foi publicado. Reenvie quando houver confirmação de publicação.', coord2, ts(2026, 4, 15),
    areaNutricao, ts(2026, 3, 25)
  );

  // Additional actions to reach 30+
  await insertAcao.run(
    prof4, 'evento', 'Workshop de Álgebra Linear Computacional',
    'Participação em workshop intensivo',
    null, null, null,
    'ouvinte', 'WALC 2024', 'Recife, PE',
    null, null,
    'aprovado', null, coord1, ts(2024, 8, 10),
    areaMatematica, ts(2024, 8, 1)
  );

  await insertAcao.run(
    prof7, 'evento', 'Semana de História e Cultura',
    'Palestra sobre ensino de história afro-brasileira',
    null, null, null,
    'apresentador', 'SHC 2026', 'Manaus, AM',
    null, null,
    'aprovado', null, coord2, ts(2026, 4, 20),
    areaHistoria, ts(2026, 4, 10)
  );

  await insertAcao.run(
    prof7, 'producao', 'Memória e Identidade no Ensino de História Local',
    'Artigo publicado na Revista de História Regional',
    null, null, null,
    null, null, null,
    'artigo', '10.5212/rev.hist.reg.v31i1.0003',
    'aprovado', null, coord1, ts(2026, 3, 25),
    areaHistoria, ts(2026, 3, 10)
  );

  await insertAcao.run(
    prof9, 'curso', 'Atenção Farmacêutica e Cuidado Centrado no Paciente',
    'Curso de extensão universitária',
    24, 'Universidade Federal de Minas Gerais (UFMG)', d(2026, 6, 20),
    null, null, null, null, null,
    'pendente', null, null, null,
    areaFarmacia, ts(2026, 6, 10)
  );

  await insertAcao.run(
    prof3, 'producao', 'Machine Learning Aplicado à Análise de Desempenho Acadêmico',
    'Artigo publicado na Revista Brasileira de Informática na Educação',
    null, null, null,
    null, null, null,
    'artigo', '10.5753/rbie.2026.1234',
    'aprovado', null, coord1, ts(2025, 12, 10),
    areaComputacao, ts(2025, 11, 20)
  );

  await insertAcao.run(
    prof4, 'producao', 'Resolução de Problemas no Ensino de Cálculo',
    'Material didático publicado como recurso educacional aberto',
    null, null, null,
    null, null, null,
    'material_didatico', null,
    'aprovado', null, coord2, ts(2024, 9, 15),
    areaMatematica, ts(2024, 9, 1)
  );

  console.log('Creating badges...');
  const insertBadge = db.prepare('INSERT INTO badges (name, description, icon, requirement_type, requirement_value) VALUES (?, ?, ?, ?, ?)');
  await insertBadge.run('Primeiro Passo', 'Envie sua primeira submissão', 'star', 'level', 1);
  await insertBadge.run('Iniciante', 'Alcance o nível 2', 'target', 'level', 2);
  await insertBadge.run('Explorador', 'Registrou formações em 3 tipos diferentes', 'compass', 'types', 3);
  await insertBadge.run('Veterano', 'Alcançou Nível 5', 'award', 'level', 5);
  await insertBadge.run('Mestre dos Cursos', 'Registrou 5 cursos', 'book-open', 'curso', 5);
  await insertBadge.run('Pesquisador', 'Crie sua primeira produção', 'star', 'producao', 1);
  await insertBadge.run('Acadêmico', 'Registrou 3 produções acadêmicas', 'graduation-cap', 'producao', 3);
  await insertBadge.run('Especialista', 'Alcance o nível 10', 'trophy', 'level', 10);
  await insertBadge.run('Maratonista', 'Streak de 7 dias consecutivos', 'flame', 'streak', 7);
  await insertBadge.run('Dedicado', '30 dias consecutivos de streak', 'flame', 'streak', 30);
  await insertBadge.run('Centurião', 'Alcançou 100 horas de formação', 'clock', 'hours', 100);
  await insertBadge.run('Primeira Certificação', 'Registrou sua primeira certificação', 'award', 'certificacao', 1);
  await insertBadge.run('Elite', 'Alcançou 5000 XP', 'zap', 'xp', 5000);
  await insertBadge.run('Estudo Diário', 'Completou 24h totais de estudos', 'clock', 'hours', 24);

  console.log('Initializing user gamification...');
  await db.exec('INSERT INTO user_gamification (user_id, xp, level) SELECT id, 0, 1 FROM users;');

  // Count total
  const acoesRes = await db.prepare('SELECT COUNT(*) as count FROM acoes_formativas').get();
  const totalAcoes = acoesRes ? parseInt(acoesRes.count) : 0;

  const usersRes = await db.prepare('SELECT COUNT(*) as count FROM users').get();
  const totalUsers = usersRes ? parseInt(usersRes.count) : 0;

  const deptsRes = await db.prepare('SELECT COUNT(*) as count FROM departments').get();
  const totalDepts = deptsRes ? parseInt(deptsRes.count) : 0;

  console.log(`\nSeed completed successfully!`);
  console.log(`  Departments: ${totalDepts}`);
  console.log(`  Users: ${totalUsers}`);
  console.log(`  Ações Formativas: ${totalAcoes}`);
  console.log(`    - By status:`);
  const byStatus = await db.prepare('SELECT status, COUNT(*) as count FROM acoes_formativas GROUP BY status').all();
  byStatus.forEach(s => console.log(`      ${s.status}: ${s.count}`));
  console.log(`    - By tipo:`);
  const byTipo = await db.prepare('SELECT tipo, COUNT(*) as count FROM acoes_formativas GROUP BY tipo').all();
  byTipo.forEach(t => console.log(`      ${t.tipo}: ${t.count}`));

  if (!skipInit) {
    closeDb();
  }
}

module.exports = { seed };

// Auto-execute only when run directly (e.g., `node src/seed.js`)
if (require.main === module) {
  seed().catch(err => {
    console.error('Seed failed:', err.message);
    process.exit(1);
  });
}
