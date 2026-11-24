import { Router } from 'express';
import { pool } from '../db/pool.js';
import { auth, canRead } from '../core/permissions.js';
import { hybridRetrieve } from '../core/retrieval.js';
import { generateText } from '../core/llm.js';
import { calculateStorageCost } from '../core/storage-cost.js';
import { logClassroomUsageSafely } from '../core/analytics.js';

const r = Router();
r.use(auth);

// ─── GET /stats ────────────────────────────────────────────────────────────────
r.get('/stats', async (req, res, next) => {
  try {
    const q = await pool.query(
      `WITH visible AS (
         SELECT f.id FROM files f
         WHERE f.deleted_at IS NULL
           AND (
             (f.owner_type = 'user' AND f.owner_id = $1)
             OR (
               f.owner_type = 'org'
               AND f.owner_id IN (SELECT org_id FROM memberships WHERE user_id = $1)
               AND (
                 f.created_by = $1
                 OR f.visibility = 'classroom'
                 OR EXISTS (SELECT 1 FROM memberships faculty WHERE faculty.user_id = $1 AND faculty.org_id = f.owner_id AND faculty.role = 'faculty')
                 OR EXISTS (SELECT 1 FROM file_shares fs WHERE fs.file_id = f.id AND fs.user_id = $1)
               )
             )
           )
       ),
       vers AS (SELECT fv.* FROM file_versions fv JOIN visible v ON v.id = fv.file_id),
       bl AS (SELECT DISTINCT blob_id, size_bytes FROM vers),
       unit_stats AS (
         SELECT count(*) total, count(DISTINCT u.text_hash) distinct_count
         FROM units u JOIN vers v ON v.id = u.version_id
       )
       SELECT
         coalesce((SELECT sum(size_bytes) FROM vers), 0)::bigint logical_bytes,
         coalesce((SELECT sum(size_bytes) FROM bl), 0)::bigint stored_bytes,
         coalesce((SELECT total FROM unit_stats), 0)::bigint units_total,
         coalesce((SELECT distinct_count FROM unit_stats), 0)::bigint units_distinct,
         (SELECT count(*) FROM visible)::int files,
         (SELECT count(*) FROM vers)::int versions,
         (SELECT count(*) FROM near_duplicate_links WHERE user_id = $1 AND status = 'flagged')::int near_duplicates`,
      [req.user!.id]
    );
    const x = q.rows[0];
    const coldQuery=await pool.query(`WITH refs AS (
      SELECT DISTINCT b.id,b.size_bytes,f.id file_id,f.archived_at,f.deleted_at FROM blobs b
      JOIN file_versions fv ON fv.blob_id=b.id JOIN files f ON f.id=fv.file_id
      WHERE ((f.owner_type='user' AND f.owner_id=$1) OR (f.owner_type='org' AND f.owner_id IN(SELECT org_id FROM memberships WHERE user_id=$1) AND (f.created_by=$1 OR f.visibility='classroom' OR EXISTS(SELECT 1 FROM memberships fac WHERE fac.user_id=$1 AND fac.org_id=f.owner_id AND fac.role='faculty') OR EXISTS(SELECT 1 FROM file_shares fs WHERE fs.file_id=f.id AND fs.user_id=$1))))
    ) SELECT coalesce(sum(size_bytes),0)::bigint bytes FROM (SELECT id,size_bytes FROM refs GROUP BY id,size_bytes HAVING bool_and((archived_at IS NOT NULL OR deleted_at IS NOT NULL) AND coalesce(deleted_at,archived_at)<now()-($2::text||' days')::interval)) cold`,[req.user!.id,Number(process.env.COLD_AFTER_DAYS||30)]);
    const uploadMetrics=await pool.query('SELECT direct_bytes,dedup_before_transfer_count,dedup_before_transfer_bytes FROM upload_metrics WHERE id=true');
    const cost=calculateStorageCost({logicalBytes:Number(x.logical_bytes),physicalBytes:Number(x.stored_bytes),coldEligibleBytes:Number(coldQuery.rows[0]?.bytes||0),hotUsdPerGbMonth:Number(process.env.STORAGE_HOT_USD_PER_GB_MONTH||0.023),coldUsdPerGbMonth:Number(process.env.STORAGE_COLD_USD_PER_GB_MONTH||0.004)});
    res.json({
      logicalBytes: Number(x.logical_bytes),
      storedBytes: Number(x.stored_bytes),
      exactDedupSavedBytes: Number(x.logical_bytes) - Number(x.stored_bytes),
      unitsTotal: Number(x.units_total),
      unitsDistinct: Number(x.units_distinct),
      repeatedContent: x.units_total ? 1 - Number(x.units_distinct) / Number(x.units_total) : 0,
      files: x.files,
      versions: x.versions,
      nearDuplicates: x.near_duplicates,
      storageCost: cost,
      uploadBandwidth: uploadMetrics.rows[0] ? {directBytes:Number(uploadMetrics.rows[0].direct_bytes),dedupedUploads:Number(uploadMetrics.rows[0].dedup_before_transfer_count),bytesSaved:Number(uploadMetrics.rows[0].dedup_before_transfer_bytes)} : {directBytes:0,dedupedUploads:0,bytesSaved:0},
    });
  } catch (e) { next(e); }
});

r.get('/ops/metrics',async(req,res,next)=>{try{
  if(req.user!.accountRole!=='professor')return res.status(403).json({error:{code:'FORBIDDEN',message:'Professor access required'}});
  const [counts,summary,recent,recovered]=await Promise.all([
    pool.query("SELECT status,count(*)::int count FROM ingestion_jobs GROUP BY status"),
    pool.query(`SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY duration_ms) FILTER(WHERE status='succeeded') p50,
      percentile_cont(0.95) WITHIN GROUP(ORDER BY duration_ms) FILTER(WHERE status='succeeded') p95,
      count(*) FILTER(WHERE status IN('succeeded','dead','failed'))::int total,
      count(*) FILTER(WHERE status IN('dead','failed'))::int failed,
      coalesce(sum(lease_recoveries),0)::int recovered
      FROM ingestion_jobs WHERE finished_at>now()-interval '24 hours'`),
    pool.query(`SELECT j.id,j.status,j.attempts,j.max_attempts,j.duration_ms,j.last_error,j.created_at,
       CASE WHEN (f.owner_type='user' AND f.owner_id=$1) OR (f.owner_type='org' AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=$1 AND m.org_id=f.owner_id AND (m.role='faculty' OR f.created_by=$1 OR f.visibility='classroom' OR EXISTS(SELECT 1 FROM file_shares fs WHERE fs.file_id=f.id AND fs.user_id=$1)))) THEN f.name ELSE NULL END file_name
       FROM ingestion_jobs j JOIN file_versions v ON v.id=j.version_id JOIN files f ON f.id=v.file_id ORDER BY j.created_at DESC LIMIT 20`,[req.user!.id]),
    pool.query("SELECT coalesce(sum(lease_recoveries),0)::int n FROM ingestion_jobs WHERE started_at>now()-interval '24 hours'")
  ]);
  const m=summary.rows[0],total=Number(m.total||0);res.json({queue:Object.fromEntries(counts.rows.map(x=>[x.status,Number(x.count)])),oldestQueuedAgeSeconds:Number((await pool.query("SELECT coalesce(extract(epoch from(now()-min(created_at))),0)::int age FROM ingestion_jobs WHERE status='queued'")).rows[0].age),durationMs:{p50:m.p50===null?null:Number(m.p50),p95:m.p95===null?null:Number(m.p95)},failureRate:total?Number(m.failed)/total:0,recoveredAfterLeaseExpiry:Number(recovered.rows[0]?.n||0),recentJobs:recent.rows.map(x=>({...x,last_error:x.last_error?String(x.last_error).slice(0,240):null}))});
}catch(e){next(e);}});

// ─── GET /trash ────────────────────────────────────────────────────────────────
r.get('/trash', async (req, res, next) => {
  try {
    const q = await pool.query(
      `SELECT f.*, coalesce(max(fv.created_at), f.created_at) last_version_at,
              $2::int - floor(extract(epoch from (now() - f.deleted_at)) / 86400)::int AS "daysLeft"
       FROM files f
       LEFT JOIN file_versions fv ON fv.file_id = f.id
       WHERE f.deleted_at IS NOT NULL
         AND (
           (f.owner_type = 'user' AND f.owner_id = $1)
           OR (
             f.owner_type = 'org'
             AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = $1 AND m.org_id = f.owner_id AND m.role = 'faculty')
           )
         )
       GROUP BY f.id
       ORDER BY f.deleted_at DESC`,
      [req.user!.id, Number(process.env.TRASH_RETENTION_DAYS || 30)]
    );
    res.json({ files: q.rows, retentionDays: Number(process.env.TRASH_RETENTION_DAYS || 30) });
  } catch (e) { next(e); }
});

// ─── GET /search ───────────────────────────────────────────────────────────────
// Supports:
//   ?q=<text>        → semantic vector search across units
//   ?name=<string>   → filename filter (ilike)
//   ?fileIds=id1,id2 → restrict to specific files
// Both can be combined.
r.get('/search', async (req, res, next) => {
  try {
    const qText = String(req.query.q || '').trim();
    const nameFilter = String(req.query.name || '').trim();
    const fileIds = req.query.fileIds ? String(req.query.fileIds).split(',').filter(Boolean) : null;
    const validUuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
    if(qText.length>500||nameFilter.length>200||Boolean(fileIds&&(fileIds.length>100||fileIds.some(id=>!validUuid.test(id)))))return res.status(400).json({error:{code:'BAD_REQUEST',message:'Search query, filename filter, or file ids are invalid or too long'}});
    const topK = Number(process.env.RETRIEVAL_TOP_K || 8);

    if (!qText && !nameFilter) return res.json({ results: [] });

    // Name-only search: return matching files (no semantic)
    if (!qText && nameFilter) {
      const q = await pool.query(
        `SELECT f.id file_id, f.name file_name, f.format, fv.status,
                NULL::text locator, NULL::text snippet, 0::float score
         FROM files f
         LEFT JOIN file_versions fv ON fv.id = f.current_version_id
         WHERE f.deleted_at IS NULL AND f.archived_at IS NULL
           AND f.name ILIKE $1
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
           )
           AND ($3::uuid[] IS NULL OR f.id = ANY($3))
         ORDER BY f.name
         LIMIT 20`,
        [`%${nameFilter}%`, req.user!.id, fileIds]
      );
      return res.json({ results: q.rows });
    }

    const mode=String(req.query.mode||'hybrid');if(!['hybrid','semantic','keyword'].includes(mode))return res.status(400).json({error:{code:'BAD_REQUEST',message:'mode must be hybrid, semantic, or keyword'}});
    const retrieved=await hybridRetrieve({userId:req.user!.id,query:qText,fileIds,name:nameFilter||null,limit:topK,mode:mode as 'hybrid'|'semantic'|'keyword'});
    logClassroomUsageSafely(req.user!.id,'search',qText,retrieved.results.map(x=>x.unit_id));
    res.json({results:retrieved.results.map(x=>({...x,snippet:x.text.slice(0,320)})),degraded:retrieved.degraded,mode});
  } catch (e) { next(e); }
});

// ─── POST /near-duplicates/:id/dismiss ────────────────────────────────────────
r.post('/near-duplicates/:id/dismiss', async (req, res, next) => {
  try {
    const q = await pool.query(
      "UPDATE near_duplicate_links SET status='dismissed' WHERE id=$1 AND user_id=$2 RETURNING id",
      [req.params.id, req.user!.id]
    );
    res.json({ ok: !!q.rowCount });
  } catch (e) { next(e); }
});

export default r;
