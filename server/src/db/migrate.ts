import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, transaction, withConnectionRetry } from './pool.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const sql = await readFile(path.join(here, 'schema.sql'), 'utf8');
await withConnectionRetry(client => client.query(sql));
const migrationDir = path.join(here, 'migrations');
const migrations = (await readdir(migrationDir)).filter(name => name.endsWith('.sql')).sort();
await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
for (const name of migrations) {
  const exists = await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
  if (exists.rowCount) continue;
  const migration = await readFile(path.join(migrationDir, name), 'utf8');
  await transaction(async client => { await client.query(migration); await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]); });
  console.log('Applied migration', name);
}
console.log('Database schema applied.'); await pool.end();
