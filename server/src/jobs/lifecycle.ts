import 'dotenv/config';
import { pool, transaction } from '../db/pool.js';
import { logger } from '../core/logger.js';

export async function runLifecycle() {
  const dueRules = await pool.query(`SELECT r.id FROM lifecycle_rules r JOIN files f ON f.id=r.file_id WHERE r.state IN ('dry_run','active') AND f.deleted_at IS NULL AND f.archived_at IS NULL ORDER BY r.created_at`);
  let evaluated = 0;
  for (const { id } of dueRules.rows) {
    await transaction(async client => {
      const selected = await client.query(`SELECT r.*,f.created_at file_created,f.archived_at,f.deleted_at FROM lifecycle_rules r JOIN files f ON f.id=r.file_id WHERE r.id=$1 FOR UPDATE OF r,f`, [id]);
      if (!selected.rowCount) return;
      const rule = selected.rows[0];
      if (rule.deleted_at || rule.archived_at || !['dry_run','active'].includes(rule.state)) return;
      if (rule.state === 'dry_run' && new Date(rule.activates_at).getTime() <= Date.now()) {
        await client.query("UPDATE lifecycle_rules SET state='active' WHERE id=$1", [id]);
        rule.state = 'active';
      }
      let due = false, reason = '';
      if (rule.type === 'AFTER_DAYS') {
        const days = Number(rule.params.days);
        due = Number.isInteger(days) && days >= 1 && new Date(rule.file_created).getTime() + days * 86400000 <= Date.now();
        reason = `File age reached ${days} days`;
      } else if (rule.type === 'WHEN_FILE_UPDATED') {
        const watched = await client.query(`SELECT fv.created_at FROM files f JOIN file_versions fv ON fv.id=f.current_version_id WHERE f.id=$1 AND f.deleted_at IS NULL`, [rule.params.watch_file_id]);
        due = Boolean(watched.rowCount && new Date(watched.rows[0].created_at).getTime() > new Date(rule.created_at).getTime());
        reason = 'Watched file was updated after this rule was created';
      }
      if (!due) { evaluated++; return; }
      if (rule.state === 'dry_run') {
        const exists = await client.query("SELECT 1 FROM lifecycle_events WHERE rule_id=$1 AND action='would_archive' LIMIT 1", [id]);
        if (!exists.rowCount) await client.query("INSERT INTO lifecycle_events(file_id,rule_id,action,reason) VALUES($1,$2,'would_archive',$3)", [rule.file_id, id, reason]);
      } else {
        await client.query('UPDATE files SET archived_at=now() WHERE id=$1 AND archived_at IS NULL AND deleted_at IS NULL', [rule.file_id]);
        await client.query("INSERT INTO lifecycle_events(file_id,rule_id,action,reason) VALUES($1,$2,'archive',$3)", [rule.file_id, id, reason]);
        await client.query("UPDATE lifecycle_rules SET state='fired' WHERE id=$1", [id]);
      }
      evaluated++;
    });
  }
  return evaluated;
}

if (process.argv[1]?.replaceAll('\\','/').endsWith('/jobs/lifecycle.ts') || process.argv[1]?.replaceAll('\\','/').endsWith('/jobs/lifecycle.js')) {
  runLifecycle().then(count => logger.info('lifecycle_complete',{evaluated:count})).catch(error => { logger.error('lifecycle_failed',{error:error instanceof Error?error.message:'unknown error'}); process.exitCode = 1; }).finally(() => pool.end());
}
