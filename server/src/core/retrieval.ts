import { pool } from '../db/pool.js';
import { embedText } from './embed.js';

export type RetrievalHit=Record<string,any>&{unit_id:string;vector_score?:number;keyword_score?:number;signals:string[];score:number};
export function reciprocalRankFusion(lists:RetrievalHit[][],limit:number,constant=60){
  const combined=new Map<string,RetrievalHit>();
  for(const [listIndex,list] of lists.entries())list.forEach((hit,index)=>{const old=combined.get(hit.unit_id)||{...hit,score:0,signals:[]};old.score+=1/(constant+index+1);const signal=listIndex===0?'vector':'keyword';if(!old.signals.includes(signal))old.signals.push(signal);if(hit.vector_score!==undefined)old.vector_score=hit.vector_score;if(hit.keyword_score!==undefined)old.keyword_score=hit.keyword_score;combined.set(hit.unit_id,old);});
  return [...combined.values()].sort((a,b)=>b.score-a.score).slice(0,limit);
}

const access=`((f.owner_type='user' AND f.owner_id=$4) OR (f.owner_type='org' AND f.owner_id IN(SELECT org_id FROM memberships WHERE user_id=$4) AND (f.created_by=$4 OR f.visibility='classroom' OR EXISTS(SELECT 1 FROM memberships fac WHERE fac.user_id=$4 AND fac.org_id=f.owner_id AND fac.role='faculty') OR EXISTS(SELECT 1 FROM file_shares fs WHERE fs.file_id=f.id AND fs.user_id=$4)))`;
export async function hybridRetrieve(input:{userId:string;query:string;fileIds?:string[]|null;name?:string|null;limit:number;mode?:'hybrid'|'semantic'|'keyword'}){
  const mode=input.mode||'hybrid',query=input.query.trim();let vector:string|null=null,degraded=false;
  if(mode!=='keyword')try{vector=`[${(await embedText(`Represent this question for retrieving relevant document passages: ${query}`)).join(',')}]`;}catch{degraded=true;}
  const params=[query,input.fileIds?.length?input.fileIds:null,input.name?`%${input.name}%`:null,input.userId] as any[];
  const candidates:RetrievalHit[][]=[];
  if(vector){
    const q=await pool.query(`SELECT u.id unit_id,u.locator,u.text,f.id file_id,f.name file_name,fv.id version_id,1-(u.embedding <=> $5::vector) vector_score FROM units u JOIN file_versions fv ON fv.id=u.version_id JOIN files f ON f.id=fv.file_id WHERE u.embedding IS NOT NULL AND fv.status='ready' AND fv.retracted_at IS NULL AND f.current_version_id=fv.id AND f.deleted_at IS NULL AND f.archived_at IS NULL AND f.searchable=true AND ($2::uuid[] IS NULL OR f.id=ANY($2)) AND ($3::text IS NULL OR f.name ILIKE $3) AND ${access} ORDER BY u.embedding <=> $5::vector LIMIT $6`,[...params,vector,Math.max(input.limit*4,20)]);
    candidates.push(q.rows.filter(x=>Number(x.vector_score)>=Number(process.env.RETRIEVAL_MIN_SCORE||0.35)).map(x=>({...x,score:0,signals:[]})));
  }
  if(mode!=='semantic'||degraded){
    const q=await pool.query(`SELECT u.id unit_id,u.locator,u.text,f.id file_id,f.name file_name,fv.id version_id,ts_rank_cd(u.tsv,websearch_to_tsquery('english',$1)) keyword_score FROM units u JOIN file_versions fv ON fv.id=u.version_id JOIN files f ON f.id=fv.file_id WHERE u.tsv @@ websearch_to_tsquery('english',$1) AND fv.status='ready' AND fv.retracted_at IS NULL AND f.current_version_id=fv.id AND f.deleted_at IS NULL AND f.archived_at IS NULL AND f.searchable=true AND ($2::uuid[] IS NULL OR f.id=ANY($2)) AND ($3::text IS NULL OR f.name ILIKE $3) AND ${access} ORDER BY keyword_score DESC LIMIT $5`,[...params,Math.max(input.limit*4,20)]);
    candidates.push(q.rows.filter(x=>Number(x.keyword_score)>=0.01).map(x=>({...x,score:0,signals:[]})));
  }
  return {results:reciprocalRankFusion(candidates,input.limit),degraded};
}
