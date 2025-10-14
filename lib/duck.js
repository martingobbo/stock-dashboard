// lib/duck.js
import path from 'path';
import { existsSync } from 'fs';
import duckdb from 'duckdb';

const dbPath = path.join(process.cwd(), 'data', 'serving', 'analytics.duckdb');

if (!existsSync(dbPath)) {
  throw new Error(`DuckDB file not found at ${dbPath}`);
}

// Lazy-init connection (create once, reuse across all queries)
let connPromise = null;

function getConnection() {
  if (!connPromise) {
    const db = new duckdb.Database(dbPath);
    connPromise = new Promise((resolve, reject) => {
      try {
        const conn = db.connect();
        resolve(conn);
      } catch (err) {
        reject(err);
      }
    });
  }
  return connPromise;
}

export async function queryDuckDB(sql) {
  const conn = await getConnection();
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, res) => (err ? reject(err) : resolve(res)));
  });
}
