import {pool} from '../db/pool.js';
import {logger} from './logger.js';
const stopwords=new Set('a an and are as at be by does for from has have in is it its of on or that the this to was were with what when where which who why how'.split(' '));
export function tokenizeTopics(query:string){return query.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(token=>token.length>=3&&!stopwords.has(token));}
export function filterKAnonymousTopics(perUserTerms:Map<string,string[]>,minimumUsers:number){const usersByTerm=new Map<string,Set<string>>();for(const[user,terms]of perUserTerms)for(const term of new Set(terms)){if(!usersByTerm.has(term))usersByTerm.set(term,new Set());usersByTerm.get(term)!.add(user);}return [...usersByTerm].filter(([,users])=>users.size>=minimumUsers).map(([term,users])=>({term,count:users.size})).sort((a,b)=>b.count-a.count||a.term.localeCompare(b.term)).slice(0,20);}
export async function logClassroomUsage(userId:string,kind:'search'|'assistant',queryText:string,unitIds:string[]){
  if(!unitIds.length)return;
  const orgs=await pool.query(`SELECT f.owner_id org_id,array_agg(DISTINCT u.id) cited_unit_ids FROM units u JOIN file_versions v ON v.id=u.version_id JOIN files f ON f.id=v.file_id WHERE u.id=ANY($1::uuid[]) AND f.owner_type='org' AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=$2 AND m.org_id=f.owner_id) GROUP BY f.owner_id`,[unitIds,userId]);
  for(const row of orgs.rows)await pool.query('INSERT INTO usage_events(org_id,user_id,kind,query_text,cited_unit_ids) VALUES($1,$2,$3,$4,$5::uuid[])',[row.org_id,userId,kind,queryText.slice(0,200),row.cited_unit_ids]);
}
export function logClassroomUsageSafely(userId:string,kind:'search'|'assistant',queryText:string,unitIds:string[]){void logClassroomUsage(userId,kind,queryText,unitIds).catch(error=>logger.warn('usage_event_write_failed',{kind,error:error instanceof Error?error.message:'unknown'}));}
