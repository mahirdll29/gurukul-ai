import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { logger } from '../core/logger.js';

type Db = PoolClient | typeof pool;
export type IngestionJob = { id: string; version_id: string; attempts: number; max_attempts: number; locked_by: string };
const leaseSeconds = () => Math.max(15, Number(process.env.JOB_LEASE_SECONDS || 60));

export function retryDelayMs(attempts: number, random = Math.random) {
  const base = Math.min(5000 * 2 ** Math.max(0, attempts), 300_000);
  return Math.round(base + random() * base * 0.2);
}

export async function enqueueIngestion(versionId: string, client: Db = pool) {
  const result = await client.query(
    "INSERT INTO ingestion_jobs(version_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id",
    [versionId]
  );
  if (result.rowCount) logger.info('ingestion_job_transition', { job_id: result.rows[0].id, version_id: versionId, status: 'queued' });
  return result.rows[0]?.id as string | undefined;
}

export async function claimJob(workerId: string): Promise<IngestionJob | null> {
  const q = await pool.query(
    `WITH candidate AS (
       SELECT id,status previous_status FROM ingestion_jobs
       WHERE (status='queued' AND run_after<=now()) OR (status='running' AND locked_until<now())
       ORDER BY run_after,created_at FOR UPDATE SKIP LOCKED LIMIT 1
     )
     UPDATE ingestion_jobs j SET status='running',locked_by=$1,
       locked_until=now()+($2::text||' seconds')::interval,started_at=now(),attempts=j.attempts+1,
       lease_recoveries=j.lease_recoveries+CASE WHEN j.status='running' THEN 1 ELSE 0 END
     FROM candidate c WHERE j.id=c.id RETURNING j.*,c.previous_status`, [workerId, leaseSeconds()]
  );
  if (!q.rowCount) return null;
  const job = q.rows[0] as IngestionJob;
  logger.info('ingestion_job_transition', { job_id: job.id, version_id: job.version_id, status: 'running', attempts: job.attempts, worker_id: workerId });
  if ((job as any).previous_status === 'running') logger.info('ingestion_lease_recovered', { job_id: job.id, version_id: job.version_id, worker_id: workerId });
  return job;
}

export async function heartbeat(jobId: string, workerId: string) {
  const q = await pool.query(
    "UPDATE ingestion_jobs SET locked_until=now()+($3::text||' seconds')::interval WHERE id=$1 AND status='running' AND locked_by=$2 RETURNING id",
    [jobId, workerId, leaseSeconds()]
  );
  return !!q.rowCount;
}

export async function completeJob(jobId: string, workerId: string, durationMs: number) {
  const q = await pool.query(
    "UPDATE ingestion_jobs SET status='succeeded',locked_by=NULL,locked_until=NULL,finished_at=now(),duration_ms=$3,last_error=NULL WHERE id=$1 AND status='running' AND locked_by=$2 RETURNING version_id",
    [jobId, workerId, durationMs]
  );
  if (q.rowCount) logger.info('ingestion_job_transition', { job_id: jobId, version_id: q.rows[0].version_id, status: 'succeeded', duration_ms: durationMs, worker_id: workerId });
  return !!q.rowCount;
}

export async function failJob(job: IngestionJob, workerId: string, error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  const dead = Number(job.attempts) >= Number(job.max_attempts);
  const delay = retryDelayMs(Number(job.attempts));
  const result = await pool.query(
    `UPDATE ingestion_jobs SET status=$3,locked_by=NULL,locked_until=NULL,
       run_after=CASE WHEN $3='queued' THEN now()+($4::text||' milliseconds')::interval ELSE run_after END,
       finished_at=CASE WHEN $3='dead' THEN now() ELSE NULL END,last_error=$5
     WHERE id=$1 AND status='running' AND locked_by=$2 RETURNING version_id`,
    [job.id, workerId, dead ? 'dead' : 'queued', delay, message]
  );
  if (!result.rowCount) return false;
  if (dead) await pool.query("UPDATE file_versions SET status='failed',error=$2 WHERE id=$1", [job.version_id, message]);
  logger.info('ingestion_job_transition', { job_id: job.id, version_id: job.version_id, status: dead ? 'dead' : 'queued', attempts: job.attempts, retry_delay_ms: dead ? null : delay, worker_id: workerId, error: message });
  return true;
}

export async function getExpiredRunningCount() {
  const q = await pool.query("SELECT count(*)::int n FROM ingestion_jobs WHERE status='running' AND locked_until<now()");
  return Number(q.rows[0]?.n || 0);
}
