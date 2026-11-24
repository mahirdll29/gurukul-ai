import { createHash } from 'node:crypto';
export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
export const normalizeText = (s: string) => s.normalize('NFC').replace(/\s+/gu, ' ').trim();
