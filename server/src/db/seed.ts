import 'dotenv/config';
import { pool, withConnectionRetry } from './pool.js';

await withConnectionRetry(client => client.query('SELECT 1'));

for (const [code, name] of [
  ['CS301', 'Database Systems'],
  ['CS302', 'Operating Systems'],
]) {
  await pool.query(
    'INSERT INTO orgs(code, name) VALUES($1, $2) ON CONFLICT(code) DO UPDATE SET name = EXCLUDED.name',
    [code, name],
  );
}

console.log('Course spaces created. Create user accounts through the registration page.');
await pool.end();
