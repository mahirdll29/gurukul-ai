import { pool, transaction } from '../db/pool.js';
import { sha256 } from './hash.js';
import { putObject } from './storage.js';

export async function saveGenerated(userId: string, name: string, format: 'quiz' | 'pptx', bytes: Buffer,
  sources: {version_id: string}[], classroomId?: string) {
  const scope = classroomId ? 'org' : 'user';
  const owner = classroomId ?? userId;
  const hash = sha256(bytes);
  const key = `${scope}/${owner}/${hash}`;
  const existing = await pool.query('SELECT id FROM blobs WHERE scope_type=$1 AND scope_id=$2 AND sha256=$3', [scope, owner, hash]);
  if (!existing.rowCount) {
    await putObject(key, bytes, format === 'quiz' ? 'application/json' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  }
  return transaction(async client => {
    const blob = await client.query(
      `INSERT INTO blobs(scope_type,scope_id,sha256,size_bytes,storage_key,ref_count) VALUES($1,$2,$3,$4,$5,1)
       ON CONFLICT(scope_type,scope_id,sha256) DO UPDATE SET ref_count=blobs.ref_count+1 RETURNING id`,
      [scope, owner, hash, bytes.length, key]);
    const file = await client.query(
      `INSERT INTO files(owner_type,owner_id,name,format,kind,searchable,visibility,created_by)
       VALUES($1,$2,$3,$4,'generated',false,'classroom',$5) RETURNING id`, [scope, owner, name, format, userId]);
    const fileId: string = file.rows[0].id;
    const version = await client.query(
      `INSERT INTO file_versions(file_id,version_no,blob_id,original_name,size_bytes,sha256,status,uploaded_by)
       VALUES($1,1,$2,$3,$4,$5,'ready',$6) RETURNING id`, [fileId, blob.rows[0].id, name, bytes.length, hash, userId]);
    await client.query('UPDATE files SET current_version_id=$1 WHERE id=$2', [version.rows[0].id, fileId]);
    for (const source of new Set(sources.map(s => s.version_id))) {
      await client.query("INSERT INTO lineage_edges(from_version_id,to_version_id,kind) VALUES($1,$2,'derived')", [source, version.rows[0].id]);
    }
    return fileId;
  });
}
