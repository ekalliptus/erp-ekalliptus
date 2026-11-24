import crypto from 'node:crypto';
import { hasPermission, presignDownloadSchema, presignUploadSchema } from '@ekalliptus/contracts';
import { payroll_items } from '@ekalliptus/db';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { writeAuditLog } from '../middleware/audit.js';
import { getDb } from '../db.js';
import {
  authorizeStorageDownload,
  isAllowedPortfolioImageMime,
  isSafeObjectKey,
} from '../services/security-policy.js';
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
  if (category === 'release' && auth.roleCode !== 'owner') {
    return c.json(
      { error: 'Forbidden: hanya Owner yang dapat mengunggah file rilis aplikasi.' },
      403,
    );
  }
  if (category === 'portfolio') {
    const canPortfolioUpload =
      hasPermission(auth.permissions, 'portfolio', 'create') ||
      hasPermission(auth.permissions, 'portfolio', 'update');
    if (!canPortfolioUpload) {
      return c.json(
        { error: 'Forbidden: Anda tidak memiliki izin mengunggah media portofolio.' },
        403,
      );
    }
    if (!isAllowedPortfolioImageMime(content_type)) {
      return c.json(
        { error: 'Format gambar portofolio hanya mendukung WEBP, PNG, JPG, atau AVIF.' },
        400,
      );
    }
  }
  const safeName = sanitizeFilename(filename);
  const objectKey =
    category === 'release'
      ? `releases/android/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`
      : `${category}/${auth.employee.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;

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

  // Cek kepemilikan/izin serta keamanan key path: cegah traversal & pastikan
  // karyawan non-pengelola hanya bisa mengakses slip gaji miliknya sendiri.
  const auth = c.get('auth');
  const key = parsed.data.object_key;
  if (!isSafeObjectKey(key)) {
    return c.json({ error: 'Invalid object key.' }, 400);
  }
  const [top] = key.split('/');
  const decision = await authorizeStorageDownload({
    key,
    roleCode: auth.roleCode,
    employeeId: auth.employee.id,
    employeeCode: auth.employee.employee_code,
    permissions: auth.permissions,
    ownsSlipObject: async () => {
      const [, runId] = key.split('/');
      if (!runId) return false;
      const [owned] = await getDb()
        .select({ id: payroll_items.id })
        .from(payroll_items)
        .where(
          and(
            eq(payroll_items.employee_id, auth.employee.id),
            eq(payroll_items.payroll_run_id, runId),
          ),
        )
        .limit(1);
      return Boolean(owned);
    },
  });
  if (!decision.allowed) {
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
