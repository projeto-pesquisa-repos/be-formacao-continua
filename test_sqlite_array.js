const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec('CREATE TABLE test (id INTEGER, status TEXT)');
db.exec('INSERT INTO test VALUES (1, "pendente")');
try {
  const result = db.prepare('SELECT * FROM test WHERE status = ?').all(["pendente"]);
  console.log("Success:", result);
} catch (e) {
  console.error("Error:", e.message);
}
