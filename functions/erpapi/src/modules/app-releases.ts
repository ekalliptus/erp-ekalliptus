import {
  appPlatformSchema,
  createAppReleaseSchema,
  isNewerRelease,
} from '@ekalliptus/contracts';
import { app_releases } from '@ekalliptus/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { getDb, jsonSafe } from '../db.js';
import { writeAuditLog } from '../middleware/audit.js';
import { requirePermission } from '../middleware/rbac.js';
import {
  dispatchPendingNotifications,
  notifyAppReleaseInTx,
} from '../services/notify.js';
import { createPresignedDownloadUrl } from '../services/storage.js';
import type { AppEnv } from '../types.js';
import type { ErpModulePlugin } from './plugin.js';

const DEFAULT_UPDATE_URL = 'https://my.ekalliptus.com';

const router = new Hono<AppEnv>();

function parsePlatform(raw: string | undefined): 'android' | 'web' {
  const parsed = appPlatformSchema.safeParse((raw ?? 'android').trim().toLowerCase());
  return parsed.success ? parsed.data : 'android';
}

function parseBuild(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function resolvePublicDownloadUrl(
  c: Context<AppEnv>,
  release: typeof app_releases.$inferSelect,
): string | null {
  if (release.platform === 'android' && release.file_object_key) {
    try {
      const origin = new URL(c.req.url).origin;
      return `${origin}/api/app/download/android?build=${release.build_number}`;
    } catch {
      return `/api/app/download/android?build=${release.build_number}`;
    }
  }
  return release.download_url ?? null;
}

function formatReleasePayload(
  c: Context<AppEnv>,
  release: typeof app_releases.$inferSelect,
) {
  return {
    ...(jsonSafe(release) as Record<string, unknown>),
    download_url: resolvePublicDownloadUrl(c, release),
    has_apk: Boolean(release.file_object_key),
  };
}

router.get('/version', async (c) => {
  const platform = parsePlatform(c.req.query('platform'));
  const currentVersion = (c.req.query('current_version') ?? '0.0.0').trim() || '0.0.0';
  const currentBuild = parseBuild(c.req.query('current_build'));

  const releases = await getDb()
    .select()
    .from(app_releases)
    .where(and(eq(app_releases.platform, platform), eq(app_releases.is_published, true)))
    .orderBy(desc(app_releases.build_number))
    .limit(25);

  const latest = releases[0] ?? null;
  const hasUpdate = latest
    ? isNewerRelease(currentVersion, currentBuild, latest.version, latest.build_number)
    : false;
  const pendingReleases = releases.filter((r) =>
    isNewerRelease(currentVersion, currentBuild, r.version, r.build_number),
  );

  return c.json({
    platform,
    current_version: currentVersion,
    current_build: currentBuild,
    has_update: hasUpdate,
    latest: latest ? formatReleasePayload(c, latest) : null,
    pending_releases: pendingReleases.map((r) => formatReleasePayload(c, r)),
    releases: releases.map((r) => formatReleasePayload(c, r)),
  });
});

router.get('/changelog', async (c) => {
  const platform = parsePlatform(c.req.query('platform'));
  const releases = await getDb()
    .select()
    .from(app_releases)
    .where(and(eq(app_releases.platform, platform), eq(app_releases.is_published, true)))
    .orderBy(desc(app_releases.build_number))
    .limit(30);

  return c.json({
    platform,
    releases: releases.map((r) => formatReleasePayload(c, r)),
  });
});

router.get('/download/android', async (c) => {
  const requestedBuild = parseBuild(c.req.query('build'));
  const db = getDb();

  const conditions = [
    eq(app_releases.platform, 'android'),
    eq(app_releases.is_published, true),
    ...(requestedBuild > 0 ? [eq(app_releases.build_number, requestedBuild)] : []),
  ];

  const [release] = await db
    .select()
    .from(app_releases)
    .where(and(...conditions))
    .orderBy(desc(app_releases.build_number))
    .limit(1);

  if (!release) {
    return c.json({ error: 'Rilis Android tidak ditemukan.' }, 404);
  }

  const formatJson = c.req.query('format') === 'json';

  if (release.file_object_key) {
    const filename = `MyEkalliptus-v${release.version}.apk`;
    const signedUrl = await createPresignedDownloadUrl({
      key: release.file_object_key,
      expiresIn: 900,
      filename,
      contentType: 'application/vnd.android.package-archive',
    });
    if (formatJson) {
      return c.json({
        download_url: signedUrl,
        filename,
        version: release.version,
        build_number: release.build_number,
        file_size_bytes: release.file_size_bytes != null ? release.file_size_bytes.toString() : null,
      });
    }
    return c.redirect(signedUrl, 302);
  }

  const extUrl = release.download_url?.trim();
  const isHttp = Boolean(extUrl && (extUrl.startsWith('https://') || extUrl.startsWith('http://')));
  const pointsToSelf = Boolean(extUrl && extUrl.includes('/api/app/download/android'));
  if (isHttp && extUrl && !pointsToSelf) {
    if (formatJson) {
      return c.json({
        download_url: extUrl,
        filename: `MyEkalliptus-v${release.version}.apk`,
        version: release.version,
        build_number: release.build_number,
        file_size_bytes: release.file_size_bytes != null ? release.file_size_bytes.toString() : null,
      });
    }
    return c.redirect(extUrl, 302);
  }

  return c.json({ error: 'File APK belum tersedia untuk rilis ini.' }, 404);
});

router.post('/releases', requirePermission('rbac', 'update'), async (c) => {
  const auth = c.get('auth');
  if (auth.roleCode !== 'owner') {
    return c.json(
      { error: 'Forbidden: hanya Owner yang dapat mempublikasikan rilis aplikasi.' },
      403,
    );
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createAppReleaseSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const db = getDb();
  let created: typeof app_releases.$inferSelect;
  let recipients = 0;
  try {
    const txResult = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(app_releases)
        .values({
          platform: parsed.data.platform,
          version: parsed.data.version,
          build_number: parsed.data.build_number,
          title: parsed.data.title,
          changelog: parsed.data.changelog,
          download_url: parsed.data.download_url ?? DEFAULT_UPDATE_URL,
          file_object_key: parsed.data.file_object_key ?? null,
          file_size_bytes: parsed.data.file_size_bytes ?? null,
          is_mandatory: parsed.data.is_mandatory ?? false,
          is_published: true,
          created_by: auth.employee.id,
        })
        .returning();

      await writeAuditLog(tx, {
        actorId: auth.employee.id,
        platform: auth.platform,
        module: 'rbac',
        action: 'publish_app_release',
        entityId: row.id,
        afterData: row,
      });

      const notifiedCount = await notifyAppReleaseInTx(tx, row, auth.employee.id);
      return { row, notifiedCount };
    });
    created = txResult.row;
    recipients = txResult.notifiedCount;
  } catch (err) {
    const pgErr = err as { code?: string; cause?: { code?: string } };
    if (pgErr?.code === '23505' || pgErr?.cause?.code === '23505') {
      return c.json({ error: 'Nomor build untuk platform tersebut sudah terdaftar.' }, 409);
    }
    throw err;
  }

  const push = await dispatchPendingNotifications();
  return c.json(
    {
      release: formatReleasePayload(c, created),
      notification: { recipients, push },
    },
    201,
  );
});

router.post('/releases/:id/notify', requirePermission('rbac', 'update'), async (c) => {
  const auth = c.get('auth');
  if (auth.roleCode !== 'owner') {
    return c.json(
      { error: 'Forbidden: hanya Owner yang dapat mengirim notifikasi pembaruan.' },
      403,
    );
  }
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing release id.' }, 400);

  const db = getDb();
  const [target] = await db.select().from(app_releases).where(eq(app_releases.id, id)).limit(1);
  if (!target) return c.json({ error: 'Rilis aplikasi tidak ditemukan.' }, 404);
  if (!target.is_published) {
    return c.json({ error: 'Rilis belum dipublikasikan.' }, 400);
  }

  const recipients = await db.transaction(async (tx) => {
    const count = await notifyAppReleaseInTx(tx, target, auth.employee.id);
    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'rbac',
      action: 'notify_app_release',
      entityId: target.id,
      afterData: {
        platform: target.platform,
        version: target.version,
        build_number: target.build_number,
        recipients: count,
      },
    });
    return count;
  });

  const push = await dispatchPendingNotifications();
  return c.json({ ok: true, release_id: target.id, recipients, push });
});

router.delete('/releases/:id', requirePermission('rbac', 'delete'), async (c) => {
  const auth = c.get('auth');
  if (auth.roleCode !== 'owner') {
    return c.json({ error: 'Forbidden: hanya Owner yang dapat menghapus rilis aplikasi.' }, 403);
  }
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing release id.' }, 400);

  const db = getDb();
  const [target] = await db.select().from(app_releases).where(eq(app_releases.id, id)).limit(1);
  if (!target) return c.json({ error: 'Rilis aplikasi tidak ditemukan.' }, 404);

  if (target.is_published) {
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(app_releases)
      .where(and(eq(app_releases.platform, target.platform), eq(app_releases.is_published, true)));
    if ((countRow?.count ?? 0) <= 1) {
      return c.json(
        { error: 'Minimal harus ada satu rilis aktif pada platform tersebut.' },
        400,
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(app_releases).where(eq(app_releases.id, id));
    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'rbac',
      action: 'delete_app_release',
      entityId: id,
      beforeData: target,
      afterData: null,
    });
  });

  return c.json({ ok: true, id });
});

export const appReleasesPlugin: ErpModulePlugin = {
  id: 'app-releases',
  basePath: '/app',
  router,
};
