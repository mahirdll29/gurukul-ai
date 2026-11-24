import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { auth } from '../core/permissions.js';

const r = Router();
const attempts = new Map<string, { count: number; resetAt: number }>();

function loginLimit(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  let state = attempts.get(key);
  if (!state || state.resetAt <= now) {
    state = { count: 0, resetAt: now + 15 * 60 * 1000 };
    attempts.set(key, state);
  }
  if (state.count >= 10) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } });
  state.count++;
  next();
}

function issueToken(userId: string) {
  if (!process.env.JWT_SECRET) throw new Error('Authentication is not configured.');
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '24h' });
}

async function membershipsFor(userId: string) {
  const result = await pool.query('SELECT o.id AS "orgId",o.code,o.name,m.role FROM memberships m JOIN orgs o ON o.id=m.org_id WHERE m.user_id=$1', [userId]);
  return result.rows;
}

r.post('/register', loginLimit, async (req, res, next) => {
  try {
    const { name, email, password, portal = 'student' } = req.body || {};
    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 100 ||
        typeof email !== 'string' || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        typeof password !== 'string' || password.length < 8 || password.length > 72 || !['student', 'professor'].includes(portal)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Enter your name, a valid email, and a password between 8 and 72 characters.' } });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await pool.query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [normalizedEmail]);
    if (existing.rowCount) return res.status(409).json({ error: { code: 'CONFLICT', message: 'An account with this email already exists.' } });
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query('INSERT INTO users(email,name,password_hash,account_role) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id,email,name,account_role', [normalizedEmail, name.trim(), passwordHash, portal]);
    if (!result.rowCount) return res.status(409).json({ error: { code: 'CONFLICT', message: 'An account with this email already exists.' } });
    const user = result.rows[0];
    res.status(201).json({ token: issueToken(user.id), user: { id: user.id, email: user.email, name: user.name, accountRole: user.account_role, memberships: await membershipsFor(user.id) } });
  } catch (error) { next(error); }
});

r.post('/login', loginLimit, async (req, res, next) => {
  try {
    const { email, password, portal = 'student' } = req.body || {};
    if (portal !== 'student' && portal !== 'professor') {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Choose a valid sign-in portal.' } });
    }
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } });
    }
    const result = await pool.query('SELECT id,email,name,password_hash,account_role FROM users WHERE lower(email)=lower($1)', [email]);
    if (!result.rowCount || !(await bcrypt.compare(password, result.rows[0].password_hash))) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } });
    }
    const user = result.rows[0];
    if (user.account_role !== portal) {
      return res.status(403).json({ error: { code: 'PORTAL_ACCESS', message: `This is a ${user.account_role} account. Choose the matching sign-in portal.` } });
    }
    const memberships = await membershipsFor(user.id);
    res.json({ token: issueToken(user.id), user: { id: user.id, email: user.email, name: user.name, accountRole: user.account_role, memberships }, portal });
  } catch (error) { next(error); }
});

r.get('/me', auth, async (req, res) => {
  const { memberships, ...user } = req.user!;
  res.json({ user, memberships });
});

export default r;
