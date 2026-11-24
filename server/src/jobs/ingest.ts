import { pool, transaction } from '../db/pool.js';
import { parseDocument } from '../parsers/index.js';
import { embedTexts } from '../core/embed.js';
import { s3 } from '../core/storage.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '../core/logger.js';

async function scanSimilar(versionId:string,userId:string,fileId:string) {
  const current=await pool.query(`SELECT u.id,u.text_hash,u.embedding::text,fv.blob_id FROM units u JOIN file_versions fv ON fv.id=u.version_id WHERE u.version_id=$1 AND u.embedding IS NOT NULL`,[versionId]);
  if(current.rows.length<3)return;
  const threshold=Number(process.env.NEAR_DUP_UNIT_SIM||0.9),minFraction=Number(process.env.NEAR_DUP_DOC_FRAC||0.7),matches=new Map<string,Set<string>>(),eligible=new Set<string>();
  for(const unit of current.rows){
    const q=await pool.query(`SELECT f.id file_id,fv.id version_id,u.id unit_id,1-(u.embedding <=> $1::vector) score
      FROM units u JOIN file_versions fv ON fv.id=u.version_id JOIN files f ON f.id=fv.file_id
      WHERE u.embedding IS NOT NULL AND f.current_version_id=fv.id AND f.id<>$2 AND f.deleted_at IS NULL AND f.archived_at IS NULL AND fv.status='ready' AND fv.retracted_at IS NULL
      AND ((f.owner_type='user' AND f.owner_id=$3) OR (f.owner_type='org' AND f.owner_id IN(SELECT org_id FROM memberships WHERE user_id=$3)))
      AND fv.blob_id IS DISTINCT FROM (SELECT blob_id FROM file_versions WHERE id=f.current_version_id)
      ORDER BY u.embedding <=> $1::vector LIMIT 5`,[unit.embedding, fileId,userId]);
    const best=new Map<string,any>();for(const row of q.rows)if(Number(row.score)>=threshold&&(!best.has(row.file_id)||Number(row.score)>Number(best.get(row.file_id).score)))best.set(row.file_id,row);
    for(const row of best.values()){eligible.add(row.file_id);if(!matches.has(row.file_id))matches.set(row.file_id,new Set());matches.get(row.file_id)!.add(unit.id);}
  }
  for(const candidate of eligible){const frac=(matches.get(candidate)?.size||0)/current.rows.length;if(frac<minFraction)continue;const version=await pool.query('SELECT current_version_id FROM files WHERE id=$1',[candidate]);if(version.rowCount&&version.rows[0].current_version_id)await pool.query(`INSERT INTO near_duplicate_links(user_id,version_id,matched_version_id,match_fraction) SELECT $1,$2,$3,$4 WHERE NOT EXISTS(SELECT 1 FROM near_duplicate_links WHERE user_id=$1 AND version_id=$2 AND matched_version_id=$3)`,[userId,versionId,version.rows[0].current_version_id,frac]);}
}

export async function processVersion(versionId:string,buffer?:Buffer,leaseValid:()=>boolean=()=>true){
  try{
    if(!leaseValid())throw new Error('Ingestion lease lost');
    const q=await pool.query(`SELECT fv.*,b.storage_key,f.format FROM file_versions fv JOIN blobs b ON b.id=fv.blob_id JOIN files f ON f.id=fv.file_id WHERE fv.id=$1`,[versionId]);
    if(!q.rowCount)return;
    let bytes=buffer;
    if(!bytes){const o=await s3.send(new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:q.rows[0].storage_key}));bytes=Buffer.from(await o.Body!.transformToByteArray());}
    if(!leaseValid())throw new Error('Ingestion lease lost');
    const units=await parseDocument(q.rows[0].format,bytes);
    if(!leaseValid())throw new Error('Ingestion lease lost');
    await transaction(async c=>{await c.query('DELETE FROM units WHERE version_id=$1',[versionId]);for(const u of units)await c.query(`INSERT INTO units(version_id,idx,locator,text,text_hash,char_count) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(version_id,idx) DO UPDATE SET locator=EXCLUDED.locator,text=EXCLUDED.text,text_hash=EXCLUDED.text_hash,char_count=EXCLUDED.char_count`,[versionId,u.idx,u.locator,u.text,u.text_hash,u.char_count]);});
    if(units.length){
      const embeddedUnits=units.filter(unit=>unit.char_count>=5);
      for(let i=0;i<embeddedUnits.length;i+=20){
        if(!leaseValid())throw new Error('Ingestion lease lost');
        const batch=embeddedUnits.slice(i,i+20),existing=await pool.query('SELECT DISTINCT ON(text_hash) text_hash,embedding::text FROM units WHERE text_hash=ANY($1) AND embedding IS NOT NULL',[batch.map(x=>x.text_hash)]),vectors=new Map(existing.rows.map(x=>[x.text_hash,x.embedding]));
        const missing=batch.filter(x=>!vectors.has(x.text_hash));
        if(missing.length){const em=await embedTexts(missing.map(x=>`Represent this document for retrieval: ${x.text.slice(0,6000)}`));for(let k=0;k<missing.length;k++)vectors.set(missing[k].text_hash,`[${em[k].join(',')}]`);}
        for(const unit of batch){const vector=vectors.get(unit.text_hash);if(vector)await pool.query('UPDATE units SET embedding=$1::vector WHERE version_id=$2 AND idx=$3',[vector,versionId,unit.idx]);}
      }
    }
    if(!leaseValid())throw new Error('Ingestion lease lost');
    const details=await transaction(async c=>{
      const v=(await c.query('SELECT * FROM file_versions WHERE id=$1 FOR UPDATE',[versionId])).rows[0];
      const f=(await c.query('SELECT * FROM files WHERE id=$1 FOR UPDATE',[v.file_id])).rows[0];
      const prev=f.current_version_id;
      if(prev){
        const [a,b]=await Promise.all([c.query('SELECT text_hash FROM units WHERE version_id=$1 ORDER BY idx',[prev]),c.query('SELECT text_hash FROM units WHERE version_id=$1 ORDER BY idx',[versionId])]);
        const old=a.rows.map(x=>x.text_hash),now=b.rows.map(x=>x.text_hash),oldSet=new Set(old),newSet=new Set(now);
        await c.query(`INSERT INTO lineage_edges(from_version_id,to_version_id,kind,stats) VALUES($1,$2,'revision',$3) ON CONFLICT DO NOTHING`,[prev,versionId,JSON.stringify({added:now.filter((x:string)=>!oldSet.has(x)).length,removed:old.filter((x:string)=>!newSet.has(x)).length,unchanged:now.filter((x:string)=>oldSet.has(x)).length})]);
      }
      const noTextWarning=units.length===0&&f.format==='pdf'?'No extractable text (OCR not supported)':null;
      await c.query("UPDATE file_versions SET status='ready',unit_count=(SELECT count(*) FROM units WHERE version_id=$1),error=$2 WHERE id=$1",[versionId,noTextWarning]);
      await c.query('UPDATE files SET current_version_id=$1 WHERE id=$2',[versionId,v.file_id]);
      return{fileId:v.file_id,userId:v.uploaded_by,searchable:f.searchable};
    });
    if(details.searchable)try{await scanSimilar(versionId,details.userId,details.fileId);}catch(e){logger.error('similarity_scan_failed',{version_id:versionId,error:e instanceof Error?e.message:'unknown error'});}
  }catch(e){
    logger.error('ingestion_attempt_failed', { version_id: versionId, error: e instanceof Error ? e.message : 'unknown error' });
    throw e;
  }
}
