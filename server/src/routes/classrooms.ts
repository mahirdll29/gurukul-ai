import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { pool, transaction } from '../db/pool.js';
import { auth } from '../core/permissions.js';
import { saveGenerated } from '../core/generated-files.js';
import {filterKAnonymousTopics,tokenizeTopics} from '../core/analytics.js';

const r = Router();
r.use(auth);
const validUuid=(value:string)=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);

// ─── GET /classrooms ───────────────────────────────────────────────────────────
// Returns all classrooms the current user is a member of.
// Professors see the join_code; students do not.
r.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
         o.id, o.code, o.name, o.description, o.created_at,
         m.role,
         CASE WHEN m.role = 'faculty' THEN o.join_code ELSE NULL END AS join_code,
         (SELECT count(*)::int FROM memberships students WHERE students.org_id = o.id AND students.role = 'student') student_count,
         (SELECT u.name FROM memberships fm JOIN users u ON u.id = fm.user_id WHERE fm.org_id = o.id AND fm.role = 'faculty' LIMIT 1) teacher_name
       FROM memberships m
       JOIN orgs o ON o.id = m.org_id
       WHERE m.user_id = $1
       ORDER BY o.name`,
      [req.user!.id]
    );
    res.json({ classrooms: result.rows });
  } catch (error) { next(error); }
});

r.get('/:id/analytics',async(req,res,next)=>{try{
  if(!validUuid(req.params.id))return res.status(400).json({error:{code:'BAD_REQUEST',message:'Invalid classroom id'}});
  if(req.user!.accountRole!=='professor')return res.status(403).json({error:{code:'FORBIDDEN',message:'Professor access required'}});
  const membership=await pool.query("SELECT 1 FROM memberships WHERE user_id=$1 AND org_id=$2 AND role='faculty'",[req.user!.id,req.params.id]);if(!membership.rowCount)return res.status(403).json({error:{code:'FORBIDDEN',message:'Faculty access to this classroom is required'}});
  const minUsers=Math.max(2,Number(process.env.ANALYTICS_MIN_USERS||3));
  const [active,cited,units,activity,rawTopics]=await Promise.all([
    pool.query("SELECT count(DISTINCT e.user_id)::int n FROM usage_events e JOIN memberships m ON m.org_id=e.org_id AND m.user_id=e.user_id AND m.role='student' WHERE e.org_id=$1 AND e.created_at>now()-interval '30 days'",[req.params.id]),
    pool.query(`SELECT f.id file_id,f.name file_name,count(*)::int citations FROM usage_events e CROSS JOIN LATERAL unnest(e.cited_unit_ids) unit_id JOIN units u ON u.id=unit_id JOIN file_versions v ON v.id=u.version_id JOIN files f ON f.id=v.file_id WHERE e.org_id=$1 AND e.kind='assistant' AND e.created_at>now()-interval '30 days' GROUP BY f.id,f.name ORDER BY citations DESC LIMIT 10`,[req.params.id]),
    pool.query(`SELECT f.id file_id,f.name file_name,u.id unit_id,u.locator,count(*)::int citations FROM usage_events e CROSS JOIN LATERAL unnest(e.cited_unit_ids) unit_id JOIN units u ON u.id=unit_id JOIN file_versions v ON v.id=u.version_id JOIN files f ON f.id=v.file_id WHERE e.org_id=$1 AND e.kind='assistant' AND e.created_at>now()-interval '30 days' GROUP BY f.id,f.name,u.id,u.locator ORDER BY citations DESC LIMIT 10`,[req.params.id]),
    pool.query("SELECT date_trunc('day',created_at)::date AS day,count(*)::int count FROM usage_events WHERE org_id=$1 AND created_at>now()-interval '30 days' GROUP BY 1 ORDER BY 1",[req.params.id]),
    pool.query("SELECT e.user_id,e.query_text FROM usage_events e JOIN memberships m ON m.org_id=e.org_id AND m.user_id=e.user_id AND m.role='student' WHERE e.org_id=$1 AND e.created_at>now()-interval '30 days'",[req.params.id])
  ]);
  const terms=new Map<string,string[]>();for(const row of rawTopics.rows){if(!terms.has(row.user_id))terms.set(row.user_id,[]);terms.get(row.user_id)!.push(...tokenizeTopics(row.query_text));}
  const withheld=Number(active.rows[0].n)<minUsers;res.json({mostCitedFiles:cited.rows,mostCitedUnits:units.rows,activity:activity.rows,topics:withheld?[]:filterKAnonymousTopics(terms,minUsers),topicsWithheld:withheld,message:withheld?`Topic data is withheld because fewer than ${minUsers} students are active.`:'Topics include terms asked by enough distinct students.'});
}catch(e){next(e);}});

// ─── POST /classrooms ──────────────────────────────────────────────────────────
// Create a new classroom (professor only).
r.post('/', async (req, res, next) => {
  try {
    const { name, code, description = '' } = req.body || {};
    const className = typeof name === 'string' ? name.trim() : '';
    const classCode = typeof code === 'string' && code.trim()
      ? code.trim().toUpperCase()
      : `CLS-${randomBytes(3).toString('hex').toUpperCase()}`;
    const details = typeof description === 'string' ? description.trim() : '';

    if (req.user!.accountRole !== 'professor') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only professor accounts can create classrooms.' } });
    }
    if (!className || className.length > 120) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Enter a class name (up to 120 characters).' } });
    }
    if (!/^[A-Z0-9-]{2,24}$/.test(classCode)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Class code must be 2–24 uppercase letters, numbers, or hyphens.' } });
    }
    if (details.length > 1000) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Description must be 1000 characters or fewer.' } });
    }

    const joinCode = randomBytes(5).toString('hex').toUpperCase();
    const classroom = await transaction(async client => {
      const created = await client.query(
        'INSERT INTO orgs(code,name,description,join_code) VALUES($1,$2,$3,$4) RETURNING id,code,name,description,join_code,created_at',
        [classCode, className, details, joinCode]
      );
      await client.query("INSERT INTO memberships(user_id,org_id,role) VALUES($1,$2,'faculty')", [req.user!.id, created.rows[0].id]);
      return created.rows[0];
    });
    res.status(201).json({
      classroom: {
        ...classroom,
        join_code: classroom.join_code,
        role: 'faculty',
        student_count: 0,
        teacher_name: req.user!.name,
      },
    });
  } catch (error: any) {
    if (error?.code === '23505') {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'That class code is already in use. Choose a different one.' } });
    }
    next(error);
  }
});

// ─── POST /classrooms/join ─────────────────────────────────────────────────────
// Join a classroom using a 10-character join code (students only).
r.post('/join', async (req, res, next) => {
  try {
    const code = typeof req.body?.joinCode === 'string' ? req.body.joinCode.trim().toUpperCase() : '';

    if (req.user!.accountRole !== 'student') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only student accounts can join a classroom with a join code.' } });
    }
    if (!/^[A-F0-9]{10}$/.test(code)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Enter the 10-character classroom join code shared by your professor.' } });
    }

    const result = await pool.query(
      `INSERT INTO memberships(user_id, org_id, role)
         SELECT $1, id, 'student' FROM orgs WHERE join_code = $2
       ON CONFLICT (user_id, org_id) DO UPDATE
         SET role = CASE WHEN memberships.role = 'faculty' THEN 'faculty' ELSE 'student' END
       RETURNING org_id`,
      [req.user!.id, code]
    );
    if (!result.rowCount) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No classroom matches that join code. Check the code and try again.' } });
    }
    const classroom = await pool.query(
      `SELECT o.id, o.code, o.name, o.description,
              (SELECT u.name FROM memberships fm JOIN users u ON u.id = fm.user_id WHERE fm.org_id = o.id AND fm.role = 'faculty' LIMIT 1) teacher_name
       FROM orgs o WHERE o.id = $1`,
      [result.rows[0].org_id]
    );
    res.json({ classroom: classroom.rows[0] });
  } catch (error) { next(error); }
});

// ─── GET /classrooms/:id/members ───────────────────────────────────────────────
// Returns the list of students in a classroom (for selective sharing UI).
// Any classroom member can call this endpoint.
r.get('/:id/members', async (req, res, next) => {
  try {
    const membership = await pool.query(
      'SELECT role FROM memberships WHERE user_id = $1 AND org_id = $2',
      [req.user!.id, req.params.id]
    );
    if (!membership.rowCount) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Classroom not found or you are not a member.' } });
    }

    // Return all students (excluding the caller themselves)
    const result = await pool.query(
      `SELECT u.id, u.name, m.role
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1
         AND m.role = 'student'
         AND u.id <> $2
       ORDER BY u.name`,
      [req.params.id, req.user!.id]
    );
    res.json({ members: result.rows, myRole: membership.rows[0].role });
  } catch (error) { next(error); }
});

// ─── GET /classrooms/:id ───────────────────────────────────────────────────────
// Get details of a single classroom (any member).
r.get('/:id', async (req, res, next) => {
  try {
    const membership = await pool.query(
      'SELECT role FROM memberships WHERE user_id = $1 AND org_id = $2',
      [req.user!.id, req.params.id]
    );
    if (!membership.rowCount) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Classroom not found.' } });
    }
    const q = await pool.query(
      `SELECT o.id, o.code, o.name, o.description, o.created_at,
              CASE WHEN $2 = 'faculty' THEN o.join_code ELSE NULL END AS join_code,
              (SELECT count(*)::int FROM memberships s WHERE s.org_id = o.id AND s.role = 'student') student_count,
              (SELECT u.name FROM memberships fm JOIN users u ON u.id = fm.user_id WHERE fm.org_id = o.id AND fm.role = 'faculty' LIMIT 1) teacher_name
       FROM orgs o WHERE o.id = $1`,
      [req.params.id, membership.rows[0].role]
    );
    res.json({ classroom: { ...q.rows[0], role: membership.rows[0].role } });
  } catch (error) { next(error); }
});

r.post('/:id/quizzes', async (req, res, next) => {
  try {
    const user = req.user!;
    const classroomId = req.params.id;
    if (user.accountRole !== 'professor' || !user.memberships.some(m => m.orgId === classroomId && m.role === 'faculty')) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only professors teaching this classroom can publish quizzes.' } });
    }
    const { title, questions } = req.body || {};
    if (typeof title !== 'string' || !title.trim() || title.length > 160 ||
        !Array.isArray(questions) || !questions.length || questions.length > 50) {
      return res.status(400).json({error: {code: 'BAD_REQUEST', message: 'Enter a quiz title and 1 to 50 questions.'}});
    }
    const clean = [];
    for (const q of questions) {
      if (!q || typeof q.question !== 'string' || !q.question.trim() || q.question.length > 2000 ||
          !Array.isArray(q.options) || q.options.length !== 4 ||
          !q.options.every((o: unknown) => typeof o === 'string' && o.trim() && o.length <= 500) ||
          new Set(q.options.map((o: string) => o.trim().toLowerCase())).size !== 4 ||
          !Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= 4) {
        return res.status(400).json({error: {code: 'BAD_REQUEST', message: 'Each question needs four distinct choices and a correct answer.'}});
      }
      clean.push({ question: q.question.trim(), options: q.options.map((o: string) => o.trim()), correctIndex: q.correctIndex });
    }
    const quiz = { title: title.trim(), questions: clean };
    const fileId = await saveGenerated(user.id, quiz.title, 'quiz', Buffer.from(JSON.stringify(quiz)), [], classroomId);
    res.status(201).json({ fileId });
  } catch (err) { next(err); }
});

export default r;
