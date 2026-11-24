import { transaction } from '../db/pool.js';
import type { PoolClient } from 'pg';
import { enqueueIngestion } from '../jobs/queue.js';

export async function registerUploadedBlob(input: {
  blobId: string; fileId?: string; ownerType: 'user'|'org'; ownerId: string; name: string;
  format: string; visibility: 'classroom'|'selected'; userId: string; size: number;
  sha256: string; shareWith: string[];
}, client?: PoolClient) {
  const create = async (c: PoolClient) => {
    let fileId = input.fileId;
    if (!fileId) fileId = (await c.query(
      "INSERT INTO files(owner_type,owner_id,name,format,kind,visibility,created_by) VALUES($1,$2,$3,$4,'upload',$5,$6) RETURNING id",
      [input.ownerType,input.ownerId,input.name,input.format,input.visibility,input.userId]
    )).rows[0].id;
    else await c.query('UPDATE files SET visibility=$1 WHERE id=$2',[input.visibility,fileId]);
    const no = Number((await c.query('SELECT coalesce(max(version_no),0)+1 n FROM file_versions WHERE file_id=$1',[fileId])).rows[0].n);
    const versionId = (await c.query("INSERT INTO file_versions(file_id,version_no,blob_id,original_name,size_bytes,sha256,status,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,'processing',$7) RETURNING id",[fileId,no,input.blobId,input.name,input.size,input.sha256,input.userId])).rows[0].id;
    await c.query('UPDATE blobs SET ref_count=ref_count+1 WHERE id=$1',[input.blobId]);
    if (input.ownerType==='org' && input.visibility==='selected') {
      await c.query('DELETE FROM file_shares WHERE file_id=$1',[fileId]);
      for (const recipient of input.shareWith) await c.query('INSERT INTO file_shares(file_id,user_id,shared_by) VALUES($1,$2,$3)',[fileId,recipient,input.userId]);
    }
    await enqueueIngestion(versionId,c);
    return {fileId,versionId};
  };
  return client ? create(client) : transaction(create);
}
