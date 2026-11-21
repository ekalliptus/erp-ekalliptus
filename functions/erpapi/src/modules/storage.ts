import crypto from 'node:crypto';
import { hasPermission, presignDownloadSchema, presignUploadSchema } from '@ekalliptus/contracts';
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

  // Cek kepemilikan/izin: objek karyawan hanya untuk pemiliknya, slip gaji
  // dan invoice butuh izin modul terkait.
  const auth = c.get('auth');
  const key = parsed.data.object_key;
  const [top, second] = key.split('/');
  let allowed = false;
  if ((top === 'receipt' || top === 'selfie' || top === 'avatar') && second === auth.employee.id) {
    allowed = true;
  } else if (top === 'slips') {
    allowed = hasPermission(auth.permissions, 'payroll', 'view');
  } else if (top === 'invoices') {
    allowed = hasPermission(auth.permissions, 'finance', 'view');
  } else if (top === 'product') {
    allowed = hasPermission(auth.permissions, 'inventory', 'view');
  }
  if (!allowed) {
    return c.json({ error: 'Forbidden: Anda tidak berhak mengunduh objek ini.' }, 403);
  }

  const downloadUrl = await createPresignedDownloadUrl({
    key,
    expiresIn: 3600,
  });

  await writeAuditLog(getDb(), {
    actorId: auth.employee.id,
    platform: auth.platform,
    module: 'storage',
    action: 'presign_download',
    entityId: key,
    afterData: { category: top },
  });

  return c.json({
    object_key: key,
    download_url: downloadUrl,
    expires_in: 3600,
  });
});

export const storagePlugin: ErpModulePlugin = {
  id: 'storage',
  basePath: '/storage',
  router,
};
