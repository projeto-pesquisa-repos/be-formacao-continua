const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec('CREATE TABLE test (title TEXT)');
db.prepare('INSERT INTO test (title) VALUES (?)').run('AÇÃO');
const res = db.prepare('SELECT LOWER(title) as lower_title FROM test').get();
console.log('SQLite LOWER:', res.lower_title);
console.log('JS toLowerCase:', 'AÇÃO'.toLowerCase());
