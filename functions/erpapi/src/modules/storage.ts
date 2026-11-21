import crypto from 'node:crypto';
import { presignDownloadSchema, presignUploadSchema } from '@ekalliptus/contracts';
import { Hono } from 'hono';
import { writeAuditLog } from '../middleware/audit.js';
import { getDb } from '../db.js';
import { createPresignedDownloadUrl, createPresignedUploadUrl } from '../services/storage.js';
import type { AppEnv } from '../types.js';
import type { ErpModulePlugin } from './plugin.js';

const router = new Hono<AppEnv>();

function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96);
}

router.post('/presign-upload', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = presignUploadSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const { category, filename, content_type } = parsed.data;
  const safeName = sanitizeFilename(filename);
  const objectKey = `${category}/${auth.employee.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;

  const uploadUrl = await createPresignedUploadUrl({
    key: objectKey,
    contentType: content_type,
    expiresIn: 900,
  });

  await writeAuditLog(getDb(), {
    actorId: auth.employee.id,
    platform: auth.platform,
    module: 'storage',
    action: 'presign_upload',
    entityId: objectKey,
    afterData: { category, content_type, object_key: objectKey },
  });

  return c.json({
    object_key: objectKey,
    upload_url: uploadUrl,
    expires_in: 900,
  });
});

router.post('/presign-download', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = presignDownloadSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const downloadUrl = await createPresignedDownloadUrl({
    key: parsed.data.object_key,
    expiresIn: 3600,
  });

  return c.json({
    object_key: parsed.data.object_key,
    download_url: downloadUrl,
    expires_in: 3600,
  });
});

export const storagePlugin: ErpModulePlugin = {
  id: 'storage',
  basePath: '/storage',
  router,
};
