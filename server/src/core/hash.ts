import { createHash } from 'node:crypto';
export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
export const normalizeText = (s: string) => s.normalize('NFC').replace(/\s+/gu, ' ').trim();
export function validateMagicBytes(format: string, bytes: Buffer) {
  return format === 'pdf' ? bytes.subarray(0, 4).toString('utf8').startsWith('%PDF')
    : (format === 'docx' || format === 'pptx') && bytes.subarray(0, 2).equals(Buffer.from('PK'));
}
