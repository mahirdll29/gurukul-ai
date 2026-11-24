import { Router } from 'express';
import { pool } from '../db/pool.js';
import { auth, canRead } from '../core/permissions.js';
import { embedText } from '../core/embed.js';
import { generateText } from '../core/llm.js';

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
    });
  } catch (e) { next(e); }
});

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
    const topK = Number(process.env.RETRIEVAL_TOP_K || 8);
    const minScore = Number(process.env.RETRIEVAL_MIN_SCORE || 0.35);

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

    // Semantic search (with optional name filter)
    const vec = await embedText(`Represent this question for retrieving relevant document passages: ${qText}`);
    const q = await pool.query(
      `SELECT u.id unit_id, u.locator, u.text,
              f.id file_id, f.name file_name, fv.id version_id,
              1 - (u.embedding <=> $1::vector) AS score
       FROM units u
       JOIN file_versions fv ON fv.id = u.version_id
       JOIN files f ON f.id = fv.file_id
       WHERE u.embedding IS NOT NULL
         AND fv.status = 'ready' AND fv.retracted_at IS NULL
         AND f.current_version_id = fv.id
         AND f.deleted_at IS NULL AND f.archived_at IS NULL AND f.searchable = true
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
         AND ($4::text IS NULL OR f.name ILIKE $4)
       ORDER BY u.embedding <=> $1::vector
       LIMIT $5`,
      [`[${vec.join(',')}]`, req.user!.id, fileIds, nameFilter ? `%${nameFilter}%` : null, topK * 2]
    );

    const results = q.rows
      .filter(x => Number(x.score) >= minScore)
      .slice(0, topK)
      .map(x => ({ ...x, snippet: x.text.slice(0, 320) }));

    res.json({ results });
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
