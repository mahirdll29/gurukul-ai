import 'dotenv/config';
import { pool, transaction } from '../db/pool.js';
import { removeObject } from '../core/storage.js';
import { logger } from '../core/logger.js';

export async function runGc({ retentionDays }: { retentionDays: number }) {
  const oldSessions=await pool.query("SELECT id,object_key FROM upload_sessions WHERE status='pending' AND created_at<now()-interval '24 hours' AND object_key LIKE 'staging/%'");
  for(const session of oldSessions.rows){try{await removeObject(session.object_key);await pool.query("UPDATE upload_sessions SET status='expired' WHERE id=$1 AND status='pending'",[session.id]);}catch(error){logger.warn('staging_object_cleanup_failed',{session_id:session.id,error:error instanceof Error?error.message:'unknown'});}}
  const expired = await pool.query('SELECT id FROM files WHERE deleted_at < now()-($1::text||\' days\')::interval', [retentionDays]);
  const affected = new Set<string>();
  for (const file of expired.rows) {
    try {
      await transaction(async client => {
        const versions = await client.query('SELECT id,blob_id FROM file_versions WHERE file_id=$1 FOR UPDATE', [file.id]);
        versions.rows.forEach(v => affected.add(v.blob_id));
        for (const version of versions.rows) await client.query('UPDATE blobs SET ref_count=GREATEST(ref_count-1,0) WHERE id=$1', [version.blob_id]);
        await client.query('UPDATE files SET current_version_id=NULL WHERE id=$1', [file.id]);
        await client.query('DELETE FROM lifecycle_events WHERE file_id=$1', [file.id]);
        await client.query('DELETE FROM lifecycle_rules WHERE file_id=$1', [file.id]);
        await client.query('DELETE FROM file_versions WHERE file_id=$1', [file.id]);
        await client.query('DELETE FROM files WHERE id=$1 AND deleted_at < now()-($2::text||\' days\')::interval', [file.id, retentionDays]);
      });
      logger.info('gc_file_collected',{file_id:file.id});
    } catch (error) { logger.error('gc_file_collection_failed',{file_id:file.id,error:error instanceof Error ? error.message : 'unknown error'}); }
  }
  const candidates = await pool.query(`SELECT b.id,b.storage_key FROM blobs b WHERE (b.id=ANY($1::uuid[]) OR b.created_at<now()-interval '1 day') AND NOT EXISTS(SELECT 1 FROM file_versions fv WHERE fv.blob_id=b.id)`, [[...affected]]);
  for (const blob of candidates.rows) {
    const actual = await pool.query('SELECT COUNT(*)::int count FROM file_versions WHERE blob_id=$1', [blob.id]);
    if (Number(actual.rows[0].count) !== 0) continue;
    try {
      await removeObject(blob.storage_key);
      await pool.query('DELETE FROM blobs WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM file_versions WHERE blob_id=$1)', [blob.id]);
      logger.info('gc_blob_removed',{blob_id:blob.id});
    } catch (error) { logger.error('gc_blob_removal_failed',{blob_id:blob.id,error:error instanceof Error ? error.message : 'unknown error'}); }
  }
  return { filesCollected: expired.rowCount || 0, blobsConsidered: candidates.rowCount || 0, stagingSessionsExpired: oldSessions.rowCount || 0 };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/jobs/gc.ts') || process.argv[1]?.replaceAll('\\', '/').endsWith('/jobs/gc.js')) {
  runGc({ retentionDays: Number(process.env.TRASH_RETENTION_DAYS || 30) }).then(result => logger.info('gc_complete',result)).catch(error => { logger.error('gc_failed',{error:error instanceof Error ? error.message : 'unknown error'}); process.exitCode = 1; }).finally(() => pool.end());
}
