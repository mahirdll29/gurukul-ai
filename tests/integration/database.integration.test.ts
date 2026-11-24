import 'dotenv/config';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const {Client}=pg;
const originalUrl=process.env.DATABASE_URL;
let reachable=false;
if(originalUrl){const probe=new Client({connectionString:originalUrl,connectionTimeoutMillis:2500});try{await probe.connect();reachable=true;}catch{}finally{try{await probe.end();}catch{}}}
if(!originalUrl)process.stderr.write('SKIP database integration: DATABASE_URL is not configured.\n');
else if(!reachable)process.stderr.write('SKIP database integration: DATABASE_URL is configured but the database is unreachable.\n');

describe.skipIf(!reachable)('isolated database integration',()=>{
  const schema=`test_gurukul_${Date.now()}_${Math.random().toString(16).slice(2,8)}`;
  const baseUrl=originalUrl!;let admin:InstanceType<typeof Client>;let db:any;let queue:any;let permissions:any;let fixture:any;
  beforeAll(async()=>{
    admin=new Client({connectionString:baseUrl});await admin.connect();await admin.query(`CREATE SCHEMA "${schema}"`);await admin.query(`SET search_path TO "${schema}",public`);
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');await admin.query(await readFile(path.join(root,'server/src/db/schema.sql'),'utf8'));await admin.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
    const names=(await readdir(path.join(root,'server/src/db/migrations'))).filter(x=>x.endsWith('.sql')).sort();for(const name of names)await admin.query(await readFile(path.join(root,'server/src/db/migrations',name),'utf8'));
    const url=new URL(baseUrl);url.searchParams.set('options',`-c search_path=${schema},public`);process.env.DATABASE_URL=url.toString();
    db=await import('../../server/src/db/pool.js');queue=await import('../../server/src/jobs/queue.js');permissions=await import('../../server/src/core/permissions.js');
    const user=(await db.pool.query("INSERT INTO users(email,name,password_hash,account_role) VALUES($1,'Test professor','x','professor') RETURNING id",[`prof-${schema}@test.invalid`])).rows[0].id;
    const student=(await db.pool.query("INSERT INTO users(email,name,password_hash) VALUES($1,'Test student','x') RETURNING id",[`student-${schema}@test.invalid`])).rows[0].id;
    const friend=(await db.pool.query("INSERT INTO users(email,name,password_hash) VALUES($1,'Test friend','x') RETURNING id",[`friend-${schema}@test.invalid`])).rows[0].id;
    const outsider=(await db.pool.query("INSERT INTO users(email,name,password_hash) VALUES($1,'Test outsider','x') RETURNING id",[`out-${schema}@test.invalid`])).rows[0].id;
    const org=(await db.pool.query("INSERT INTO orgs(code,name) VALUES($1,'Test class') RETURNING id",[`T${Math.random().toString(16).slice(2,8)}`])).rows[0].id;
    await db.pool.query("INSERT INTO memberships(user_id,org_id,role) VALUES($1,$2,'faculty'),($3,$2,'student'),($4,$2,'student')",[user,org,student,friend]);
    fixture={user,student,friend,outsider,org};
  },30000);
  afterAll(async()=>{if(db?.pool)await db.pool.end();if(admin){await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();}process.env.DATABASE_URL=originalUrl;});

  it('enforces private, shared-classmate, and non-member file access',async()=>{
    const {student,friend,outsider,org}=fixture;
    const blob=(await db.pool.query("INSERT INTO blobs(scope_type,scope_id,sha256,size_bytes,storage_key) VALUES('user',$1,$2,1,$3) RETURNING id",[student,'a'.repeat(64),`test/${schema}/a`])).rows[0].id;
    const privateFile=(await db.pool.query("INSERT INTO files(owner_type,owner_id,name,format,kind,created_by) VALUES('user',$1,'private.pdf','pdf','upload',$1) RETURNING id",[student])).rows[0].id;
    const classFile=(await db.pool.query("INSERT INTO files(owner_type,owner_id,name,format,kind,visibility,created_by) VALUES('org',$1,'shared.pdf','pdf','upload','selected',$2) RETURNING id",[org,student])).rows[0].id;
    await db.pool.query("INSERT INTO file_shares(file_id,user_id,shared_by) VALUES($1,$2,$3)",[classFile,friend,student]);
    expect(await permissions.canRead(friend,privateFile)).toBeFalsy();expect(await permissions.canRead(friend,classFile)).toBeTruthy();expect(await permissions.canRead(outsider,classFile)).toBeFalsy();
  });

  it('claims a queue job once at a time and reclaims an expired lease',async()=>{
    const {student}=fixture;const blob=(await db.pool.query("INSERT INTO blobs(scope_type,scope_id,sha256,size_bytes,storage_key) VALUES('user',$1,$2,1,$3) RETURNING id",[student,'b'.repeat(64),`test/${schema}/b`])).rows[0].id;
    const file=(await db.pool.query("INSERT INTO files(owner_type,owner_id,name,format,kind,created_by) VALUES('user',$1,'queue.pdf','pdf','upload',$1) RETURNING id",[student])).rows[0].id;
    const version=(await db.pool.query("INSERT INTO file_versions(file_id,version_no,blob_id,original_name,size_bytes,sha256,status,uploaded_by) VALUES($1,1,$2,'queue.pdf',1,$3,'processing',$4) RETURNING id",[file,blob,'b'.repeat(64),student])).rows[0].id;
    await queue.enqueueIngestion(version);const [one,two]=await Promise.all([queue.claimJob('worker-a'),queue.claimJob('worker-b')]);expect([one,two].filter(Boolean)).toHaveLength(1);const claimed=one||two;
    await db.pool.query("UPDATE ingestion_jobs SET locked_until=now()-interval '1 second' WHERE id=$1",[claimed.id]);const recovered=await queue.claimJob('worker-recovered');expect(recovered.id).toBe(claimed.id);
    await db.pool.query('UPDATE ingestion_jobs SET attempts=max_attempts WHERE id=$1',[recovered.id]);await queue.failJob({...recovered,attempts:recovered.max_attempts,max_attempts:recovered.max_attempts},'worker-recovered',new Error('permanent'));const state=await db.pool.query('SELECT status FROM ingestion_jobs WHERE id=$1',[recovered.id]);expect(state.rows[0].status).toBe('dead');
  });

  it('keeps exact blob deduplication scoped by owner',async()=>{
    const {student,friend}=fixture,hash='c'.repeat(64);await db.pool.query("INSERT INTO blobs(scope_type,scope_id,sha256,size_bytes,storage_key) VALUES('user',$1,$2,1,$3),('user',$4,$2,1,$5)",[student,hash,`test/${schema}/c1`,friend,`test/${schema}/c2`]);const q=await db.pool.query('SELECT count(DISTINCT id)::int n FROM blobs WHERE scope_type=\'user\' AND scope_id=ANY($1::uuid[]) AND sha256=$2',[[student,friend],hash]);expect(q.rows[0].n).toBe(2);
  });
});
