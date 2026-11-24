import 'dotenv/config';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { processVersion } from './jobs/ingest.js';
import { claimJob, completeJob, failJob, getExpiredRunningCount, heartbeat, type IngestionJob } from './jobs/queue.js';
import { logger } from './core/logger.js';
import { pool } from './db/pool.js';

const workerId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
const pollMs = Math.max(100, Number(process.env.WORKER_POLL_MS || 1500));
const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY || 2));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const active = new Set<Promise<void>>();
let stopped = false;
let loop: Promise<void> | undefined;

async function runJob(job: IngestionJob) {
  const started = Date.now();
  let lostLease = false;
  const heartbeatTimer = setInterval(() => {
    void heartbeat(job.id, workerId).then(ok => { if (!ok) lostLease = true; }).catch(() => { lostLease = true; });
  }, Math.max(1000, Number(process.env.JOB_LEASE_SECONDS || 60) * 1000 / 3));
  try {
    await processVersion(job.version_id, undefined, () => !lostLease);
    if (lostLease) return;
    await completeJob(job.id, workerId, Date.now() - started);
  } catch (error) {
    if (!lostLease) await failJob(job, workerId, error);
  } finally {
    clearInterval(heartbeatTimer);
  }
}

export async function startWorker() {
  if (loop) return loop;
  stopped = false;
  const recovered = await getExpiredRunningCount();
  logger.info('worker_started', { worker_id: workerId, recovered_expired_jobs: recovered, concurrency, poll_ms: pollMs });
  loop = (async () => {
    while (!stopped || active.size) {
      while (!stopped && active.size < concurrency) {
        let job: IngestionJob | null;
        try { job = await claimJob(workerId); }
        catch (error) { logger.error('worker_claim_failed', { worker_id: workerId, error: error instanceof Error ? error.message : String(error) }); break; }
        if (!job) break;
        let task!: Promise<void>;
        task = runJob(job).catch(error => logger.error('worker_job_unhandled', { job_id: job!.id, error: String(error) })).finally(() => active.delete(task));
        active.add(task);
      }
      if (active.size) await Promise.race([...active, wait(stopped ? 100 : pollMs)]);
      else if (!stopped) await wait(pollMs);
    }
    logger.info('worker_stopped', { worker_id: workerId });
    loop = undefined;
  })();
  return loop;
}

export async function stopWorker(timeoutMs = 30_000) {
  stopped = true;
  const current = loop;
  if (!current) return;
  await Promise.race([current, wait(timeoutMs)]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const shutdown = async (signal: string) => {
    logger.info('worker_shutdown_requested', { worker_id: workerId, signal });
    await stopWorker(Number(process.env.WORKER_SHUTDOWN_TIMEOUT_MS || 30_000));
    await pool.end();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  void startWorker().catch(error => { logger.error('worker_start_failed', { error: String(error) }); process.exitCode = 1; });
}
