import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { pool, withConnectionRetry } from './db/pool.js';
import authRoutes from './routes/auth.js';
import fileRoutes from './routes/files.js';
import assistantRoutes from './routes/assistant.js';
import miscRoutes from './routes/misc.js';
import classroomRoutes from './routes/classrooms.js';
import { runGc } from './jobs/gc.js';
import { runLifecycle } from './jobs/lifecycle.js';
import { startWorker, stopWorker } from './worker.js';
import { randomUUID } from 'node:crypto';
import { logger } from './core/logger.js';
import { configureBucketCors } from './core/storage.js';
import studyRoutes from './routes/study.js';
import annotationRoutes from './routes/annotations.js';

const app = express();
app.use((req,res,next)=>{const supplied=req.header('x-request-id');const requestId=supplied&&supplied.length<=128?supplied:randomUUID();res.setHeader('x-request-id',requestId);const started=Date.now();res.once('finish',()=>logger.info('http_request',{request_id:requestId,method:req.method,path:req.path,status:res.statusCode,duration_ms:Date.now()-started,user_id:req.user?.id}));next();});
const allowedOrigins = new Set([
  'http://localhost:5173', 'http://127.0.0.1:5173',
  ...(process.env.CLIENT_ORIGIN || '').split(',').map(origin => origin.trim()).filter(Boolean),
]);
app.use(cors({ origin: (origin, callback) => {
  return callback(null, !origin || allowedOrigins.has(origin));
} }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Allow the API to be embedded by our own client origin; don't block all frames.
  // frame-ancestors is set per-route for sensitive endpoints.
  next();
});
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (_req, res) => {
  const aiConfigured = Boolean(process.env.GEMINI_API_KEY && process.env.EMBEDDING_MODEL && process.env.LLM_MODEL);
  const storageConfigured = Boolean(process.env.AWS_ENDPOINT_URL_S3 && process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.S3_BUCKET);
  if (!process.env.DATABASE_URL) return res.status(503).json({ ok: false, database: 'not_configured', authConfigured: Boolean(process.env.JWT_SECRET), aiConfigured, storageConfigured, workerMode:process.env.WORKER_MODE||'embedded', queueDepth:null });
  try {
    await pool.query('SELECT 1');
    const jobs=await pool.query("SELECT count(*)::int n FROM ingestion_jobs WHERE status IN ('queued','running')");
    res.json({ ok: true, database: 'connected', authConfigured: Boolean(process.env.JWT_SECRET), aiConfigured, storageConfigured, workerMode:process.env.WORKER_MODE||'embedded', queueDepth:Number(jobs.rows[0]?.n||0) });
  } catch {
    res.status(503).json({ ok: false, database: 'unavailable', authConfigured: Boolean(process.env.JWT_SECRET), aiConfigured, storageConfigured, workerMode:process.env.WORKER_MODE||'embedded', queueDepth:null });
  }
});
app.use('/api/auth', authRoutes);
app.use('/api/classrooms', classroomRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api', miscRoutes);
app.use('/api', studyRoutes);
app.use('/api', annotationRoutes);

// ─── PDF stream proxy ─────────────────────────────────────────────────────────
// Serves PDF bytes directly from S3 through the API server.
// This avoids CORS/iframe issues with Neon Object Storage.
// Auth: JWT passed as ?token= query param (for iframe src URLs).
app.get('/api/stream/:fileId', async (req, res) => {
  try {
    const token = String(req.query.token || req.headers.authorization?.replace(/^Bearer\s+/i, '') || '');
    if (!token || !process.env.JWT_SECRET) return res.status(401).end();
    let userId: string;
    try {
      const claims = jwt.verify(token, process.env.JWT_SECRET) as jwt.JwtPayload;
      if (typeof claims.sub !== 'string') throw new Error();
      userId = claims.sub;
    } catch { return res.status(401).end(); }

    // Check access
    const fileResult = await pool.query(
      `SELECT f.*, fv.id version_id, b.storage_key, fv.original_name
       FROM files f
       JOIN file_versions fv ON fv.id = f.current_version_id
       JOIN blobs b ON b.id = fv.blob_id
       WHERE f.id = $1 AND f.deleted_at IS NULL AND f.format = 'pdf' AND fv.status = 'ready'
         AND (
           (f.owner_type = 'user' AND f.owner_id = $2)
           OR (
             f.owner_type = 'org'
             AND f.owner_id IN (SELECT org_id FROM memberships WHERE user_id = $2)
             AND (
               f.created_by = $2
               OR f.visibility = 'classroom'
               OR EXISTS (SELECT 1 FROM memberships fac WHERE fac.user_id = $2 AND fac.org_id = f.owner_id AND fac.role = 'faculty')
               OR EXISTS (SELECT 1 FROM file_shares fs WHERE fs.file_id = f.id AND fs.user_id = $2)
             )
           )
         )`,
      [req.params.fileId, userId]
    );
    if (!fileResult.rowCount) return res.status(404).end();
    const { storage_key, original_name } = fileResult.rows[0];

    // Fetch from S3 and pipe to client
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { s3 } = await import('./core/storage.js');
    const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: storage_key }));
    const safeName = (original_name || 'file.pdf').replace(/["\r\n]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    // Stream the body
    const bytes = await obj.Body!.transformToByteArray();
    res.send(Buffer.from(bytes));
  } catch (e) {
    logger.error('pdf_stream_failed',{error:e instanceof Error?e.name:'unknown'});
    res.status(500).end();
  }
});

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const transientDatabaseCodes = new Set(['ETIMEDOUT','ECONNREFUSED','ECONNRESET','EHOSTUNREACH','ENETUNREACH','ENOTFOUND','57P03','08000','08001','08003','08006']);
  const databaseUnavailable = transientDatabaseCodes.has(String(err?.code || ''));
  const missingConfiguration = typeof err?.message === 'string' && err.message.startsWith('Missing required environment variable:');
  const missingVariable = missingConfiguration ? err.message.slice('Missing required environment variable:'.length).trim() : '';
  const status = err?.code === 'LIMIT_FILE_SIZE' ? 413 : databaseUnavailable || missingConfiguration ? 503 : Number(err?.statusCode) >= 400 && Number(err.statusCode) < 600 ? Number(err.statusCode) : 500;
  const requestId=String(res.getHeader('x-request-id')||'');
  logger.error('api_request_failed',{request_id:requestId,error_name:err?.name||'Error',error_class:databaseUnavailable?'database_unavailable':missingConfiguration?'service_configuration_incomplete':err?.code||'internal',error_message:String(err?.message||'').slice(0,500),method:req.method,path:req.path});
  res.status(status).json({ error: {
    code: status === 413 ? 'PAYLOAD_TOO_LARGE' : databaseUnavailable ? 'DATABASE_UNAVAILABLE' : missingConfiguration ? 'SERVICE_NOT_CONFIGURED' : err?.publicCode || (status === 400 ? 'BAD_REQUEST' : 'INTERNAL'),
    message: status === 413 ? `Maximum upload size is ${process.env.MAX_UPLOAD_MB || 20} MB` : databaseUnavailable ? 'The database is unavailable. Check the server health endpoint and DATABASE_URL configuration.' : missingConfiguration ? `Server configuration is missing ${missingVariable}. Contact the administrator.` : err?.publicMessage || (status === 400 ? 'Invalid request' : 'Internal server error'),
    requestId,
  } });
});
const port = Number(process.env.PORT || 3000);

async function start() {
  app.listen(port, () => logger.info('api_listening',{port}));
  if (!process.env.DATABASE_URL) { logger.warn('api_diagnostic_mode',{reason:'database_not_configured'}); return; }
  try {
    await withConnectionRetry(client => client.query('SELECT 1'));
    await pool.query("UPDATE file_versions SET status='failed',error='Interrupted' WHERE status='processing' AND created_at < now()-interval '10 minutes'");
  } catch {
    logger.warn('api_diagnostic_mode',{reason:'database_unavailable'});
    return;
  }
  if (process.env.DISABLE_JOBS !== 'true') {
    const lifecycle = setInterval(() => { void runLifecycle().catch(error => logger.error('lifecycle_job_failed',{error:error instanceof Error?error.message:'unknown'})); }, 60 * 60 * 1000);
    const gc = setInterval(() => { void runGc({ retentionDays: Number(process.env.TRASH_RETENTION_DAYS || 30) }).catch(error => logger.error('gc_job_failed',{error:error instanceof Error?error.message:'unknown'})); }, 24 * 60 * 60 * 1000);
    const reconcile = setInterval(async () => { try { const rows = await pool.query('SELECT b.id,count(fv.id)::int actual FROM blobs b LEFT JOIN file_versions fv ON fv.blob_id=b.id GROUP BY b.id HAVING b.ref_count<>count(fv.id)'); for (const row of rows.rows) await pool.query('UPDATE blobs SET ref_count=$1 WHERE id=$2', [row.actual, row.id]); } catch(error) { logger.error('reconcile_job_failed',{error:error instanceof Error?error.message:'unknown'}); } }, 24 * 60 * 60 * 1000);
    lifecycle.unref(); gc.unref(); reconcile.unref();
  }
  if(process.env.DIRECT_UPLOAD!=='false')try{await configureBucketCors();logger.info('bucket_cors_configured');}catch(error){logger.warn('bucket_cors_setup_unavailable',{error:error instanceof Error?error.message:'provider rejected CORS setup'});}
  if ((process.env.WORKER_MODE || 'embedded') === 'embedded') void startWorker();
}

process.once('SIGTERM', () => { void stopWorker(); });
process.once('SIGINT', () => { void stopWorker(); });

start().catch((error: any) => {
  logger.error('api_initialization_failed',{error_name:error?.name||'Error'});
});
