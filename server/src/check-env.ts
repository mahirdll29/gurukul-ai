import 'dotenv/config';
import { pool, withConnectionRetry } from './db/pool.js';
import { checkStorageRoundTrip, missingStorageVariables, s3 } from './core/storage.js';
import { checkEmbedding } from './core/embed.js';

const required=['DATABASE_URL','AWS_ENDPOINT_URL_S3','AWS_REGION','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','S3_BUCKET','GEMINI_API_KEY','JWT_SECRET','EMBEDDING_MODEL','LLM_MODEL'];
const missing=(names:string[])=>names.filter(name=>!process.env[name]);
let failures=0;
function report(name:string,ok:boolean,missingNames:string[]=[]){console.log(`${ok?'PASS':'FAIL'} ${name}${missingNames.length?`: ${missingNames.join(', ')}`:''}`);if(!ok)failures++;}

const requiredMissing=missing(required);
report('required environment variables',requiredMissing.length===0,requiredMissing);

if(!process.env.DATABASE_URL){report('Neon database and vector extension',false,['DATABASE_URL']);}
else try{const result=await withConnectionRetry(client=>client.query("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') AS enabled"));report('Neon database and vector extension',result.rows[0]?.enabled===true);}catch{report('Neon database and vector extension',false);}

const storageMissing=missingStorageVariables();
if(storageMissing.length)report('Neon Object Storage put/read/delete',false,storageMissing);
else try{await checkStorageRoundTrip();report('Neon Object Storage put/read/delete',true);}catch{report('Neon Object Storage put/read/delete',false);}

if(!process.env.GEMINI_API_KEY||!process.env.EMBEDDING_MODEL)report('Gemini embedding dimension 768',false,missing(['GEMINI_API_KEY','EMBEDDING_MODEL']));
else try{await checkEmbedding();report('Gemini embedding dimension 768',true);}catch{report('Gemini embedding dimension 768',false);}

report('JWT_SECRET at least 32 characters',Boolean(process.env.JWT_SECRET&&process.env.JWT_SECRET.length>=32),process.env.JWT_SECRET?[]:['JWT_SECRET']);

await pool.end();s3.destroy();process.exitCode=failures?1:0;
