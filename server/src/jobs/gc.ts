import 'dotenv/config';
import { pool, transaction } from '../db/pool.js';
import { removeObject } from '../core/storage.js';

export async function runGc({ retentionDays }: { retentionDays: number }) {
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
      console.log('Collected expired file', file.id);
    } catch (error) { console.error('Could not collect expired file', file.id, error instanceof Error ? error.message : 'unknown error'); }
  }
  const candidates = await pool.query(`SELECT b.id,b.storage_key FROM blobs b WHERE (b.id=ANY($1::uuid[]) OR b.created_at<now()-interval '1 day') AND NOT EXISTS(SELECT 1 FROM file_versions fv WHERE fv.blob_id=b.id)`, [[...affected]]);
  for (const blob of candidates.rows) {
    const actual = await pool.query('SELECT COUNT(*)::int count FROM file_versions WHERE blob_id=$1', [blob.id]);
    if (Number(actual.rows[0].count) !== 0) continue;
    try {
      await removeObject(blob.storage_key);
      await pool.query('DELETE FROM blobs WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM file_versions WHERE blob_id=$1)', [blob.id]);
      console.log('Removed unreferenced blob', blob.id);
    } catch (error) { console.error('Could not remove unreferenced blob', blob.id, error instanceof Error ? error.message : 'unknown error'); }
  }
  return { filesCollected: expired.rowCount || 0, blobsConsidered: candidates.rowCount || 0 };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/jobs/gc.ts') || process.argv[1]?.replaceAll('\\', '/').endsWith('/jobs/gc.js')) {
  runGc({ retentionDays: Number(process.env.TRASH_RETENTION_DAYS || 30) }).then(result => console.log('GC complete', result)).catch(error => { console.error('GC failed', error instanceof Error ? error.message : 'unknown error'); process.exitCode = 1; }).finally(() => pool.end());
}
