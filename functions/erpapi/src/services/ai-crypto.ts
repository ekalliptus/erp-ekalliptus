import crypto from 'node:crypto';

const CIPHER_PREFIX = 'v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function resolveSecretKey(secretOverride?: string): Buffer {
  const raw =
    secretOverride ||
    process.env.AI_ENCRYPTION_KEY ||
    process.env.ERP_REALTIME_SECRET ||
    process.env.NEON_REALTIME_SECRET ||
    process.env.DATABASE_URL;
  if (!raw || raw.trim().length === 0) {
    throw new Error('AI encryption secret is not configured in environment.');
  }
  return crypto.createHash('sha256').update(`ekalliptus-ai-key-v1:${raw}`).digest();
}

export function encryptApiKey(plain: string, secretOverride?: string): string {
  const trimmed = plain.trim();
  if (!trimmed) {
    throw new Error('Cannot encrypt empty API key.');
  }
  const key = resolveSecretKey(secretOverride);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${CIPHER_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptApiKey(ciphertext: string | null | undefined, secretOverride?: string): string | null {
  if (!ciphertext || !ciphertext.startsWith(CIPHER_PREFIX)) return null;
  const parts = ciphertext.slice(CIPHER_PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  const [ivHex, tagHex, dataHex] = parts;
  if (!ivHex || !tagHex || !dataHex) return null;
  try {
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || data.length === 0) {
      return null;
    }
    const key = resolveSecretKey(secretOverride);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    const text = decrypted.toString('utf8').trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export function maskApiKey(plain: string | null | undefined): string {
  if (!plain) return '';
  const trimmed = plain.trim();
  if (!trimmed) return '';
  if (trimmed.length >= 10) {
    return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
  }
  if (trimmed.length > 4) {
    return `••••${trimmed.slice(-4)}`;
  }
  return '••••';
}
