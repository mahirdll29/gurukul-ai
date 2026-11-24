import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { pool, transaction } from '../db/pool.js';
import { auth } from '../core/permissions.js';

const r = Router();
r.use(auth);

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

export default r;
