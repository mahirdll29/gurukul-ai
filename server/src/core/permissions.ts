import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';

export type Membership = { orgId: string; code: string; name: string; role: 'student' | 'faculty' };
export type AuthUser = { id: string; email: string; name: string; accountRole: 'student' | 'professor'; memberships: Membership[] };
export type OwnedFile = { id: string; owner_type: 'user' | 'org'; owner_id: string; [key: string]: unknown };
export type Access = 'none' | 'read' | 'write';
declare global { namespace Express { interface Request { user?: AuthUser } } }

export async function auth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token || !process.env.JWT_SECRET) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET) as jwt.JwtPayload;
    if (typeof claims.sub !== 'string') throw new Error('Invalid subject');
    const [u, m] = await Promise.all([
      pool.query('SELECT id,email,name,account_role FROM users WHERE id=$1', [claims.sub]),
      pool.query('SELECT o.id AS "orgId",o.code,o.name,m.role FROM memberships m JOIN orgs o ON o.id=m.org_id WHERE m.user_id=$1', [claims.sub]),
    ]);
    if (!u.rowCount) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    req.user = { id: u.rows[0].id, email: u.rows[0].email, name: u.rows[0].name, accountRole: u.rows[0].account_role, memberships: m.rows };
    next();
  } catch {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  }
}

export function getAccess(user: AuthUser, file: OwnedFile): Access {
  if (file.owner_type === 'user') return file.owner_id === user.id ? 'write' : 'none';
  const membership = user.memberships.find(m => m.orgId === file.owner_id);
  return membership ? membership.role === 'faculty' ? 'write' : 'read' : 'none';
}

async function accessibleFile(userId: string, fileId: string, includeDeleted = false) {
  const r = await pool.query(`SELECT f.* FROM files f WHERE f.id=$1 AND ($3 OR f.deleted_at IS NULL) AND ((f.owner_type='user' AND f.owner_id=$2) OR (f.owner_type='org' AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=$2 AND m.org_id=f.owner_id AND (m.role='faculty' OR f.created_by=$2 OR f.visibility='classroom' OR EXISTS(SELECT 1 FROM file_shares fs WHERE fs.file_id=f.id AND fs.user_id=$2)))))`, [fileId, userId, includeDeleted]);
  return r.rows[0] as OwnedFile | undefined;
}

export async function canRead(userId: string, fileId: string) {
  return accessibleFile(userId, fileId);
}

export async function canWrite(userId: string, fileId: string) {
  const r = await pool.query(`SELECT f.* FROM files f WHERE f.id=$1 AND f.deleted_at IS NULL AND ((f.owner_type='user' AND f.owner_id=$2) OR (f.owner_type='org' AND f.created_by=$2 AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=$2 AND m.org_id=f.owner_id)) OR (f.owner_type='org' AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=$2 AND m.org_id=f.owner_id AND m.role='faculty')))`, [fileId, userId]);
  return r.rows[0] as OwnedFile | undefined;
}
