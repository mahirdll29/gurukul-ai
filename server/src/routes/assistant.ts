import { Router } from 'express';
import { pool, transaction } from '../db/pool.js';
import { auth, canRead } from '../core/permissions.js';
import { generateText, generateJson } from '../core/llm.js';
import { hybridRetrieve } from '../core/retrieval.js';
import { logClassroomUsageSafely } from '../core/analytics.js';
import { sha256 } from '../core/hash.js';
import { putObject } from '../core/storage.js';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PptxGenJS: { new(): any } = _require('pptxgenjs');

const r = Router();
r.use(auth);

// ─── GET /library ──────────────────────────────────────────────────────────────
// Returns all files accessible to the current user, with readiness info.
r.get('/library', async (req, res, next) => {
  try {
    const q = await pool.query(
      `SELECT f.id, f.name, f.format, f.owner_type, f.owner_id,
              o.code course_code, o.name course_name,
              fv.status, fv.unit_count, f.searchable, fv.retracted_at,
              (SELECT count(*)::int FROM units u WHERE u.version_id = fv.id AND u.embedding IS NOT NULL) searchable_units
       FROM files f
       LEFT JOIN LATERAL (
         SELECT v.* FROM file_versions v WHERE v.file_id = f.id
         ORDER BY (v.id = f.current_version_id) DESC, v.version_no DESC LIMIT 1
       ) fv ON TRUE
       LEFT JOIN orgs o ON o.id = f.owner_id AND f.owner_type = 'org'
       WHERE f.deleted_at IS NULL AND f.archived_at IS NULL
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
       ORDER BY f.created_at DESC`,
      [req.user!.id]
    );
    res.json({
      files: q.rows.map(x => ({
        ...x,
        available: Boolean(x.searchable && x.status === 'ready' && !x.retracted_at && x.searchable_units > 0),
        readiness: !x.status ? 'processing'
          : x.status !== 'ready' ? x.status
          : !x.searchable_units ? 'No searchable text'
          : 'ready',
      })),
    });
  } catch (e) { next(e); }
});

// ─── POST /ask ─────────────────────────────────────────────────────────────────
// Core AI assistant: retrieve relevant passages from selected files, then
// call Gemini to answer the user question with citations.
r.post('/ask', async (req, res, next) => {
  try {
    const { question, fileIds, history = [] } = req.body || {};

    // Validate inputs
    if (typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'A question is required.' } });
    }
    if(question.length>4000)return res.status(400).json({error:{code:'BAD_REQUEST',message:'Question must be 4000 characters or fewer.'}});
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Choose at least one file so the assistant has material to study.' } });
    }
    if(fileIds.length>100||fileIds.some((id:any)=>typeof id!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)))return res.status(400).json({error:{code:'BAD_REQUEST',message:'Choose up to 100 valid file ids.'}});

    const userId = req.user!.id;
    const retrieval = await hybridRetrieve({userId,query:question.trim(),fileIds,limit:Number(process.env.RETRIEVAL_TOP_K||8),mode:'hybrid'});
    const relevantUnits = retrieval.results.map(hit=>({...hit,score:hit.score}));
    logClassroomUsageSafely(userId,'assistant',question.trim(),relevantUnits.map(x=>x.unit_id));

    // Load every indexed unit from the selected files. For documents that fit
    // in the context budget this lets broad questions use the complete file;
    // longer selections still start with semantically relevant passages.
    const allUnitsResult = await pool.query(
        `SELECT u.id unit_id, u.locator, u.text, f.id file_id, f.name file_name, f.format, fv.id version_id, u.idx, 0 AS score
         FROM units u
         JOIN file_versions fv ON fv.id = u.version_id
         JOIN files f ON f.id = fv.file_id
         WHERE fv.status = 'ready' AND f.current_version_id = fv.id
           AND f.deleted_at IS NULL AND f.archived_at IS NULL AND f.searchable = true
           AND f.id = ANY($1::uuid[])
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
         ORDER BY f.id, u.idx`,
        [fileIds, userId]
      );
    const allUnits = allUnitsResult.rows;

    // Page-number questions must not depend on vector similarity: route them
    // directly to the exact extracted PDF page(s).
    const pageMatch = question.match(/\b(?:page|pg\.?|p\.)\s*(\d+)\b/i);
    const requestedPage = pageMatch ? Number(pageMatch[1]) : null;
    const requestedPageUnits = requestedPage === null ? [] : allUnits.filter(
      unit => unit.format === 'pdf' && unit.locator === `Page ${requestedPage}`
    );
    if (requestedPage !== null && allUnits.some(unit => unit.format === 'pdf') && requestedPageUnits.length === 0) {
      return res.status(422).json({
        error: {
          code: 'PAGE_TEXT_UNAVAILABLE',
          message: `Page ${requestedPage} has no extractable text in the selected PDF. Scanned or image-only pages need OCR before the assistant can read them.`,
        },
      });
    }

    if (allUnits.length === 0) {
      return res.status(422).json({
        error: {
          code: 'NO_CONTENT',
          message: 'The selected files have no indexed text yet. Wait for processing to complete, then try again.',
        },
      });
    }

    // Step 3: Build context string for Gemini (cap at MAX_CONTEXT_CHARS)
    const maxChars = Number(process.env.MAX_CONTEXT_CHARS || 120000);
    const allChars = allUnits.reduce((total, unit) => total + unit.text.length + unit.locator.length + unit.file_name.length + 24, 0);
    if (!requestedPageUnits.length && relevantUnits.length===0) return res.json({answer:"I couldn't find relevant information in the selected files.",sources:[],degraded:retrieval.degraded});
    const contextUnits = requestedPageUnits.length
      ? requestedPageUnits
      : relevantUnits;
    let contextStr = '';
    const usedUnits: typeof contextUnits = [];
    for (const unit of contextUnits) {
      const snippet = `[SOURCE: ${unit.file_name} | ${unit.locator}]\n${unit.text}\n\n`;
      if (contextStr.length + snippet.length > maxChars) continue;
      contextStr += snippet;
      usedUnits.push(unit);
    }

    // Step 4: Build conversation history for Gemini
    // history is array of {role:'user'|'model', content: string}
    const geminiHistory = Array.isArray(history)
      ? history
          .filter((h: any) => h && typeof h.content === 'string' && h.content.trim())
          .map((h: any) => ({
            role: (h.role === 'model' ? 'model' : 'user') as 'user' | 'model',
            parts: [{ text: h.content.trim() }],
          }))
      : [];

    // Step 5: Call Gemini to answer the question
    const systemPrompt = `You are Gurukul-AI, an intelligent study assistant built into a classroom platform.
You help students and professors understand course materials.

IMPORTANT RULES:
1. Answer ONLY using the provided SOURCE EXCERPTS below. Do not use outside knowledge.
2. Be thorough, clear, and educational in your explanations.
3. At the end of your answer, cite the specific sources you used in this format: [Source: filename | locator]
4. If the excerpts do not contain enough information to answer the question, say so clearly.
5. For complex topics, structure your answer with clear sections.

SOURCE EXCERPTS FROM CLASS MATERIALS:
${contextStr}

Answer the student's question based strictly on these excerpts.`;

    const answer = await generateText(systemPrompt, question.trim(), geminiHistory);

    // Step 6: Build sources list (deduplicated by file+locator)
    const seen = new Set<string>();
    const sources = usedUnits
      .map(u => ({
        fileId: u.file_id,
        fileName: u.file_name,
        locator: u.locator,
        snippet: u.text.slice(0, 200),
        score: Number(u.score).toFixed(3),
      }))
      .filter(s => {
        const key = `${s.fileId}::${s.locator}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    res.json({ answer, sources, degraded:retrieval.degraded });
  } catch (e) { next(e); }
});

// ─── Helper: get source units for generation tasks ─────────────────────────────
async function getSources(userId: string, ids: string[], limit: number) {
  if (!ids?.length) throw Error('Choose one or more files');
  const q = await pool.query(
    `SELECT f.id file_id, f.name, fv.id version_id, fv.blob_id, u.locator, u.text
     FROM files f
     JOIN file_versions fv ON fv.id = f.current_version_id
     JOIN units u ON u.version_id = fv.id
     WHERE f.id = ANY($1)
       AND f.deleted_at IS NULL AND f.archived_at IS NULL
       AND f.searchable = true AND fv.status = 'ready' AND fv.retracted_at IS NULL
       AND (
         (f.owner_type = 'user' AND f.owner_id = $2)
         OR (
           f.owner_type = 'org'
           AND f.owner_id IN (SELECT org_id FROM memberships WHERE user_id = $2)
           AND (
             f.created_by = $2
             OR f.visibility = 'classroom'
             OR EXISTS (SELECT 1 FROM memberships faculty WHERE faculty.user_id = $2 AND faculty.org_id = f.owner_id AND faculty.role = 'faculty')
             OR EXISTS (SELECT 1 FROM file_shares fs WHERE fs.file_id = f.id AND fs.user_id = $2)
           )
         )
       )
     ORDER BY f.id, u.idx`,
    [ids, userId]
  );
  if (q.rows.length === 0) throw Error('No accessible, current source text is available');
  const rows = q.rows;
    const max = Number(process.env.MAX_CONTEXT_CHARS || 120000);
  const sample: typeof rows = [];
  let total = 0;
  const step = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(max / 1200))));
  for (let i = 0; i < rows.length; i += step) {
    if (total + rows[i].text.length > max) continue;
    sample.push(rows[i]);
    total += rows[i].text.length;
  }
  return sample;
}

// ─── Helper: save AI-generated file to storage + DB ───────────────────────────
async function saveGenerated(userId: string, name: string, format: 'quiz' | 'pptx', bytes: Buffer, sources: any[]) {
  const hash = sha256(bytes), key = `user/${userId}/${hash}`;
  let blob = (await pool.query("SELECT * FROM blobs WHERE scope_type='user' AND scope_id=$1 AND sha256=$2", [userId, hash])).rows[0];
  if (!blob) {
    await putObject(key, bytes, format === 'pptx'
      ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      : 'application/json');
    blob = (await pool.query("INSERT INTO blobs(scope_type,scope_id,sha256,size_bytes,storage_key) VALUES('user',$1,$2,$3,$4) RETURNING *", [userId, hash, bytes.length, key])).rows[0];
  }
  const fileId = await transaction(async c => {
    const f = (await c.query("INSERT INTO files(owner_type,owner_id,name,format,kind,searchable,created_by) VALUES('user',$1,$2,$3,'generated',false,$1) RETURNING id", [userId, name, format])).rows[0].id;
    const v = (await c.query("INSERT INTO file_versions(file_id,version_no,blob_id,original_name,size_bytes,sha256,status,uploaded_by) VALUES($1,1,$2,$3,$4,$5,'ready',$6) RETURNING id", [f, blob.id, name, bytes.length, hash, userId])).rows[0].id;
    await c.query('UPDATE files SET current_version_id=$1 WHERE id=$2', [v, f]);
    await c.query('UPDATE blobs SET ref_count=ref_count+1 WHERE id=$1', [blob.id]);
    for (const s of [...new Map(sources.map(x => [x.version_id, x])).values()]) {
      await c.query("INSERT INTO lineage_edges(from_version_id,to_version_id,kind) VALUES($1,$2,'derived') ON CONFLICT DO NOTHING", [s.version_id, v]);
    }
    return f;
  });
  return fileId;
}

// ─── POST /quiz ────────────────────────────────────────────────────────────────
r.post('/quiz', async (req, res, next) => {
  try {
    const { fileIds, numQuestions = 10, difficulty = 'medium' } = req.body || {};
    const units = await getSources(req.user!.id, fileIds, Number(process.env.MAX_CONTEXT_CHARS || 120000));
    const excerpts = units.map(x => `[${x.name}, ${x.locator}] ${x.text}`).join('\n');
    let quiz: any;
    for (let attempt = 0; attempt < 2; attempt++) {
      quiz = await generateJson(
        'Create an educational quiz only from the supplied source excerpts. Return JSON with title and questions. Every question must have four distinct options, one integer correctIndex from 0 to 3, a nonempty explanation and a locator.',
        JSON.stringify({ numQuestions, difficulty, excerpts })
      );
      if (
        Array.isArray(quiz.questions) &&
        quiz.questions.length === numQuestions &&
        quiz.questions.every((x: any) =>
          x.question && Array.isArray(x.options) && x.options.length === 4 &&
          new Set(x.options).size === 4 && Number.isInteger(x.correctIndex) &&
          x.correctIndex >= 0 && x.correctIndex <= 3 && x.explanation && x.locator
        )
      ) break;
      quiz = null;
    }
    if (!quiz) return res.status(422).json({ error: { code: 'INVALID_GENERATION', message: 'Quiz output did not pass validation after two attempts' } });
    const fileId = await saveGenerated(req.user!.id, `${quiz.title || 'Study quiz'}.quiz.json`, 'quiz', Buffer.from(JSON.stringify(quiz)), units);
    res.status(201).json({ fileId, quiz });
  } catch (e) { next(e); }
});

// ─── POST /presentation ────────────────────────────────────────────────────────
r.post('/presentation', async (req, res, next) => {
  try {
    const { fileIds, topic, slideCount = 8 } = req.body || {};
    const count = Math.min(15, Math.max(5, Number(slideCount)));
    const units = await getSources(req.user!.id, fileIds, Number(process.env.MAX_CONTEXT_CHARS || 120000));
    const deck: any = await generateJson(
      'Create presentation content only from provided excerpts. Return JSON: {title,slides:[{title,bullets:[3 to 5 strings each no more than 20 words],notes?}]}.',
      JSON.stringify({ topic, slideCount: count, excerpts: units.map(x => `[${x.name}, ${x.locator}] ${x.text}`).join('\n') })
    );
    if (!Array.isArray(deck.slides) || deck.slides.length !== count ||
        deck.slides.some((s: any) => !s.title || !Array.isArray(s.bullets) || s.bullets.length < 3 || s.bullets.length > 5 || s.bullets.some((b: string) => b.split(/\s+/).length > 20))) {
      return res.status(422).json({ error: { code: 'INVALID_GENERATION', message: 'Presentation output did not pass validation' } });
    }
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos' };
    let slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addText(deck.title || topic || 'Study presentation', { x: .8, y: 2.2, w: 11.7, h: 1.2, fontSize: 34, bold: true, color: '123D37' });
    slide.addText('Prepared from your course files', { x: .8, y: 3.5, w: 10, h: .5, fontSize: 16, color: '64748B' });
    for (const s of deck.slides) {
      slide = pptx.addSlide();
      slide.background = { color: 'FFFFFF' };
      slide.addText(s.title, { x: .6, y: .4, w: 12.1, h: .6, fontSize: 26, bold: true, color: '123D37' });
      slide.addText(s.bullets.map((b: string) => ({ text: b, options: { bullet: { indent: 18 }, breakLine: true } })), { x: .9, y: 1.5, w: 11, h: 4.8, fontSize: 19, breakLine: false, color: '253238', paraSpaceAfter: 18 });
      if (s.notes) slide.addNotes(s.notes);
    }
    slide = pptx.addSlide();
    slide.addText('Sources', { x: .6, y: .4, w: 12, h: .6, fontSize: 26, bold: true, color: '123D37' });
    slide.addText([...new Set(units.map(x => x.name))].join('\n'), { x: .9, y: 1.4, w: 11, h: 5, fontSize: 18, bullet: { indent: 18 }, breakLine: true });
    const arr = await pptx.write({ outputType: 'nodebuffer' } as any) as Buffer;
    const fileId = await saveGenerated(req.user!.id, `${deck.title || 'Study presentation'}.pptx`, 'pptx', Buffer.from(arr), units);
    res.status(201).json({ fileId, title: deck.title });
  } catch (e) { next(e); }
});

// ─── GET /files/:id/quiz ───────────────────────────────────────────────────────
r.get('/files/:id/quiz', async (req, res, next) => {
  try {
    const f = await canRead(req.user!.id, req.params.id);
    if (!f || f.format !== 'quiz') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Quiz not found' } });
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { s3 } = await import('../core/storage.js');
    const q = await pool.query('SELECT b.storage_key FROM file_versions fv JOIN blobs b ON b.id=fv.blob_id WHERE fv.id=$1', [f.current_version_id]);
    const o = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: q.rows[0].storage_key }));
    res.json({ quiz: JSON.parse(Buffer.from(await o.Body!.transformToByteArray()).toString()) });
  } catch (e) { next(e); }
});

export default r;
