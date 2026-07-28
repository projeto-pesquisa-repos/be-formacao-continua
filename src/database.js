const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

let db = null;
let SQL = null;
let pgPool = null;

function getDbPath() {
  return process.env.DB_PATH || path.join(__dirname, '..', 'database.sqlite');
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

/**
 * Convert SQLite '?' placeholders to Postgres '$1, $2...' placeholders
 */
function convertSqlToPg(sql) {
  let index = 1;
  let pgSql = sql.replace(/\?/g, () => `$${index++}`);
  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(pgSql)) {
    pgSql = pgSql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
    if (!/ON\s+CONFLICT/i.test(pgSql)) {
      pgSql += ' ON CONFLICT DO NOTHING';
    }
  }
  return pgSql;
}

function sanitizeParams(params) {
  return params.flat().map(p => (p === undefined ? null : p));
}

/**
 * StatementWrapper for PostgreSQL pool
 */
class PgStatementWrapper {
  constructor(pool, sql) {
    this._pool = pool;
    this._sql = sql;
  }

  async get(...params) {
    const flatParams = sanitizeParams(params);
    const pgSql = convertSqlToPg(this._sql);
    const res = await this._pool.query(pgSql, flatParams);
    return res.rows[0];
  }

  async all(...params) {
    const flatParams = sanitizeParams(params);
    const pgSql = convertSqlToPg(this._sql);
    const res = await this._pool.query(pgSql, flatParams);
    return res.rows;
  }

  async run(...params) {
    const flatParams = sanitizeParams(params);
    let pgSql = convertSqlToPg(this._sql);
    const isInsert = pgSql.trim().toUpperCase().startsWith('INSERT');
    if (isInsert && !pgSql.toUpperCase().includes('RETURNING')) {
      pgSql += ' RETURNING id';
    }

    try {
      const res = await this._pool.query(pgSql, flatParams);
      const lastId = (res.rows && res.rows.length > 0 && res.rows[0].id) ? res.rows[0].id : 0;
      return {
        lastInsertRowid: lastId,
        changes: res.rowCount || 0
      };
    } catch (err) {
      const res = await this._pool.query(convertSqlToPg(this._sql), flatParams);
      return {
        lastInsertRowid: 0,
        changes: res.rowCount || 0
      };
    }
  }
}

/**
 * StatementWrapper for sql.js (SQLite)
 */
class SqliteStatementWrapper {
  constructor(database, sql) {
    this._db = database;
    this._sql = sql;
  }

  async get(...params) {
    const flatParams = sanitizeParams(params);
    try {
      const stmt = this._db.prepare(this._sql);
      if (flatParams.length > 0) {
        stmt.bind(flatParams);
      }
      if (stmt.step()) {
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        stmt.free();
        const row = {};
        for (let i = 0; i < cols.length; i++) {
          row[cols[i]] = vals[i];
        }
        return row;
      }
      stmt.free();
      return undefined;
    } catch (err) {
      throw err;
    }
  }

  async all(...params) {
    const flatParams = sanitizeParams(params);
    try {
      const stmt = this._db.prepare(this._sql);
      if (flatParams.length > 0) {
        stmt.bind(flatParams);
      }
      const rows = [];
      const cols = stmt.getColumnNames();
      while (stmt.step()) {
        const vals = stmt.get();
        const row = {};
        for (let i = 0; i < cols.length; i++) {
          row[cols[i]] = vals[i];
        }
        rows.push(row);
      }
      stmt.free();
      return rows;
    } catch (err) {
      throw err;
    }
  }

  async run(...params) {
    const flatParams = sanitizeParams(params);
    try {
      if (flatParams.length > 0) {
        this._db.run(this._sql, flatParams);
      } else {
        this._db.run(this._sql);
      }
      const lastId = this._db.exec("SELECT last_insert_rowid() as id");
      const changesResult = this._db.exec("SELECT changes() as cnt");
      return {
        lastInsertRowid: lastId.length > 0 ? lastId[0].values[0][0] : 0,
        changes: changesResult.length > 0 ? changesResult[0].values[0][0] : 0
      };
    } catch (err) {
      throw err;
    }
  }
}

/**
 * DatabaseWrapper for PostgreSQL
 */
class PgDatabaseWrapper {
  constructor(pool) {
    this._pool = pool;
    this.isPg = true;
  }

  prepare(sql) {
    return new PgStatementWrapper(this._pool, sql);
  }

  async exec(sql) {
    await this._pool.query(sql);
  }

  pragma(pragmaStr) {
    // No-op for Postgres
  }

  async close() {
    await this._pool.end();
  }

  save() {
    // No-op for Postgres
  }
}

/**
 * DatabaseWrapper for sql.js
 */
class SqliteDatabaseWrapper {
  constructor(sqlDb) {
    this._db = sqlDb;
    this.isPg = false;
  }

  prepare(sql) {
    return new SqliteStatementWrapper(this._db, sql);
  }

  exec(sql) {
    this._db.exec(sql);
  }

  pragma(pragmaStr) {
    try {
      this._db.run(`PRAGMA ${pragmaStr}`);
    } catch (e) {}
  }

  close() {
    this._db.close();
  }

  save() {
    const data = this._db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(getDbPath(), buffer);
  }
}

async function initDb() {
  if (db) return db;

  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (dbUrl) {
    console.log('Connecting to PostgreSQL database...');
    pgPool = new Pool({
      connectionString: dbUrl,
      ssl: dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
    });
    db = new PgDatabaseWrapper(pgPool);

    // Create tables using Postgres syntax
    await db.exec(`
      CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS areas_conhecimento (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        department_id INTEGER REFERENCES departments(id)
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        google_id TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        avatar_url TEXT,
        password_hash TEXT,
        must_change_password INTEGER DEFAULT 0,
        role TEXT CHECK(role IN ('professor', 'coordenador') OR role IS NULL),
        department_id INTEGER REFERENCES departments(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS acoes_formativas (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        tipo TEXT NOT NULL CHECK(tipo IN ('curso', 'evento', 'producao')),
        titulo TEXT NOT NULL,
        descricao TEXT,
        carga_horaria INTEGER,
        instituicao_promotora TEXT,
        data_conclusao DATE,
        tipo_participacao TEXT,
        nome_evento TEXT,
        local_evento TEXT,
        tipo_producao TEXT,
        doi_isbn TEXT,
        status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente', 'aprovado', 'rejeitado')),
        justificativa_rejeicao TEXT,
        validado_por INTEGER REFERENCES users(id),
        validado_em TIMESTAMP,
        arquivo_path TEXT,
        arquivo_nome TEXT,
        area_conhecimento_id INTEGER REFERENCES areas_conhecimento(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS badges (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        icon TEXT NOT NULL,
        requirement_type TEXT NOT NULL,
        requirement_value INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_gamification (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        xp INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        streak INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS user_badges (
        user_id INTEGER REFERENCES users(id),
        badge_id INTEGER REFERENCES badges(id),
        awarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, badge_id)
      );

      CREATE TABLE IF NOT EXISTS formation_suggestions (
        id SERIAL PRIMARY KEY,
        created_by INTEGER REFERENCES users(id),
        title TEXT NOT NULL,
        description TEXT,
        tipo TEXT NOT NULL,
        target_professor_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'pending'
      );
    `);
  } else {
    // SQLite (sql.js) fallback
    if (!SQL) {
      SQL = await initSqlJs();
    }

    const dbPath = getDbPath();
    let sqlDb;
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      sqlDb = new SQL.Database(fileBuffer);
    } else {
      sqlDb = new SQL.Database();
    }

    db = new SqliteDatabaseWrapper(sqlDb);
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS departments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS areas_conhecimento (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        department_id INTEGER REFERENCES departments(id)
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        google_id TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        avatar_url TEXT,
        password_hash TEXT,
        must_change_password INTEGER DEFAULT 0,
        role TEXT CHECK(role IN ('professor', 'coordenador') OR role IS NULL),
        department_id INTEGER REFERENCES departments(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS acoes_formativas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        tipo TEXT NOT NULL CHECK(tipo IN ('curso', 'evento', 'producao')),
        titulo TEXT NOT NULL,
        descricao TEXT,
        carga_horaria INTEGER,
        instituicao_promotora TEXT,
        data_conclusao DATE,
        tipo_participacao TEXT,
        nome_evento TEXT,
        local_evento TEXT,
        tipo_producao TEXT,
        doi_isbn TEXT,
        status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente', 'aprovado', 'rejeitado')),
        justificativa_rejeicao TEXT,
        validado_por INTEGER REFERENCES users(id),
        validado_em TIMESTAMP,
        arquivo_path TEXT,
        arquivo_nome TEXT,
        area_conhecimento_id INTEGER REFERENCES areas_conhecimento(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        icon TEXT NOT NULL,
        requirement_type TEXT NOT NULL,
        requirement_value INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_gamification (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        xp INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        streak INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS user_badges (
        user_id INTEGER REFERENCES users(id),
        badge_id INTEGER REFERENCES badges(id),
        awarded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, badge_id)
      );

      CREATE TABLE IF NOT EXISTS formation_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_by INTEGER REFERENCES users(id),
        title TEXT NOT NULL,
        description TEXT,
        tipo TEXT NOT NULL,
        target_professor_id INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'pending'
      );
    `);

    db.save();

    if (!global._dbAutoSaveInterval) {
      global._dbAutoSaveInterval = setInterval(() => {
        try { if (db && !db.isPg) db.save(); } catch (e) {}
      }, 60000);
      if (global._dbAutoSaveInterval.unref) {
        global._dbAutoSaveInterval.unref();
      }
    }
  }

  const uploadsDir = path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  return db;
}

function closeDb() {
  if (db) {
    try { db.save(); } catch (e) {}
    db.close();
    db = null;
  }
}

function resetDb() {
  if (db) {
    try { db.close(); } catch(e) {}
    db = null;
  }
  const dbPath = getDbPath();
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}

module.exports = { getDb, initDb, closeDb, resetDb };
