import pg from 'pg';
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
  ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
});

const transientConnectionCodes = new Set(['ETIMEDOUT','ECONNREFUSED','ECONNRESET','EHOSTUNREACH','ENETUNREACH','ENOTFOUND','57P03','08000','08001','08003','08006']);
const wait = (ms:number) => new Promise(resolve => setTimeout(resolve,ms));

/** Retry a failed initial connection once, which covers Neon waking from idle. */
export async function withConnectionRetry<T>(operation:(client:pg.PoolClient)=>Promise<T>):Promise<T> {
  for(let attempt=0;attempt<2;attempt++){
    let client:pg.PoolClient|undefined;
    try { client=await pool.connect(); return await operation(client); }
    catch(error:any){
      if(attempt===0&&transientConnectionCodes.has(String(error?.code||''))){await wait(400);continue;}
      throw error;
    } finally { client?.release(); }
  }
  throw new Error('Database connection failed after retry.');
}

export async function transaction<T>(fn:(client:pg.PoolClient)=>Promise<T>):Promise<T>{
  const c=await pool.connect();
  try{await c.query('BEGIN');const v=await fn(c);await c.query('COMMIT');return v;}
  catch(e){await c.query('ROLLBACK');throw e;}
  finally{c.release();}
}
