import {
  createPortfolioProjectSchema,
  portfolioCategorySchema,
  updatePortfolioProjectSchema,
} from '@ekalliptus/contracts';
import { portfolio_projects } from '@ekalliptus/db';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { getDb, jsonSafe } from '../db.js';
import { writeAuditLog } from '../middleware/audit.js';
import { requirePermission } from '../middleware/rbac.js';
import { checkRateLimit, clientIp } from '../services/rate-limit.js';
import {
  isSafeHttpsUrl,
  isSafePortfolioObjectKey,
  slugifyPortfolioTitle,
} from '../services/security-policy.js';
import { createPresignedDownloadUrl } from '../services/storage.js';
import type { AppEnv } from '../types.js';
import type { ErpModulePlugin } from './plugin.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_WEB_ORIGIN = 'https://ekalliptus.com';

type PortfolioRow = typeof portfolio_projects.$inferSelect;

function resolveOrigin(c: Context<AppEnv>): string {
  try {
    return new URL(c.req.url).origin;
  } catch {
    return '';
  }
}

async function safePresignDownload(key: string | null | undefined): Promise<string | null> {
  if (!key || !isSafePortfolioObjectKey(key)) return null;
  try {
    return await createPresignedDownloadUrl({ key, expiresIn: 3600 });
  } catch {
    return null;
  }
}

function validatePortfolioMediaKeys(
  coverKey: string | null | undefined,
  galleryKeys: string[] | undefined,
): string | null {
  if (coverKey !== undefined && coverKey !== null && !isSafePortfolioObjectKey(coverKey)) {
    return 'Cover object key portofolio tidak valid.';
  }
  if (galleryKeys) {
    for (const key of galleryKeys) {
      if (!isSafePortfolioObjectKey(key)) {
        return 'Salah satu gallery object key portofolio tidak valid.';
      }
    }
  }
  return null;
}

async function formatAdminPortfolioRow(row: PortfolioRow) {
  const coverKeyUrl = await safePresignDownload(row.cover_image_key);
  const coverExtUrl = row.cover_image_url && isSafeHttpsUrl(row.cover_image_url) ? row.cover_image_url : null;

  const galleryKeyUrls = (
    await Promise.all((row.gallery_image_keys ?? []).map((key) => safePresignDownload(key)))
  ).filter((url): url is string => Boolean(url));
  const galleryExtUrls = (row.gallery_image_urls ?? []).filter((url) => isSafeHttpsUrl(url));

  return {
    ...(jsonSafe(row) as Record<string, unknown>),
    cover_preview_url: coverKeyUrl ?? coverExtUrl,
    gallery_preview_urls: [...galleryKeyUrls, ...galleryExtUrls],
    public_url: `${PUBLIC_WEB_ORIGIN}/id/portfolio/${row.slug}`,
  };
}

function formatPublicPortfolioItem(c: Context<AppEnv>, row: PortfolioRow) {
  const origin = resolveOrigin(c);
  const buildMediaUrl = (slot: 'cover' | number) =>
    origin ? `${origin}/api/public/portfolio/media/${row.id}/${slot}` : `/api/public/portfolio/media/${row.id}/${slot}`;

  const coverExtUrl = row.cover_image_url && isSafeHttpsUrl(row.cover_image_url) ? row.cover_image_url : null;
  const coverUrl =
    row.cover_image_key && isSafePortfolioObjectKey(row.cover_image_key)
      ? buildMediaUrl('cover')
      : coverExtUrl;

  const galleryKeyUrls = (row.gallery_image_keys ?? [])
    .map((key, index) => (isSafePortfolioObjectKey(key) ? buildMediaUrl(index) : null))
    .filter((url): url is string => Boolean(url));
  const galleryExtUrls = (row.gallery_image_urls ?? []).filter((url) => isSafeHttpsUrl(url));

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    summary: row.summary,
    category: row.category,
    offer_type: row.offer_type,
    availability_status: row.availability_status,
    price_type: row.price_type,
    price_amount: row.price_amount !== null ? row.price_amount.toString() : null,
    original_price_amount:
      row.original_price_amount !== null ? row.original_price_amount.toString() : null,
    currency: row.currency,
    client_name: row.client_name,
    delivery_estimate: row.delivery_estimate,
    demo_url: row.demo_url && isSafeHttpsUrl(row.demo_url) ? row.demo_url : null,
    cover_image_url: coverUrl,
    gallery_image_urls: [...galleryKeyUrls, ...galleryExtUrls],
    tech_stack: row.tech_stack ?? [],
    highlights: row.highlights ?? [],
    whatsapp_prefill: row.whatsapp_prefill,
    is_featured: row.is_featured,
    sort_order: row.sort_order,
    published_at: row.published_at ? row.published_at.toISOString() : null,
    updated_at: row.updated_at.toISOString(),
  };
}

const adminRouter = new Hono<AppEnv>();

adminRouter.get('/', requirePermission('portfolio', 'view'), async (c) => {
  const statusParam = (c.req.query('status') ?? 'all').trim().toLowerCase();
  const categoryParam = (c.req.query('category') ?? 'all').trim().toLowerCase();
  const qParam = (c.req.query('q') ?? '').trim();

  const conditions = [];
  if (statusParam === 'published') {
    conditions.push(eq(portfolio_projects.is_published, true));
  } else if (statusParam === 'draft') {
    conditions.push(eq(portfolio_projects.is_published, false));
  }

  if (categoryParam && categoryParam !== 'all') {
    const parsedCat = portfolioCategorySchema.safeParse(categoryParam);
    if (parsedCat.success) {
      conditions.push(eq(portfolio_projects.category, parsedCat.data));
    }
  }

  if (qParam) {
    const pattern = `%${qParam}%`;
    conditions.push(
      or(
        ilike(portfolio_projects.title, pattern),
        ilike(portfolio_projects.slug, pattern),
        ilike(portfolio_projects.tagline, pattern),
      )!,
    );
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(portfolio_projects)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(
      desc(portfolio_projects.is_featured),
      asc(portfolio_projects.sort_order),
      desc(portfolio_projects.updated_at),
    )
    .limit(100);

  const items = await Promise.all(rows.map((row) => formatAdminPortfolioRow(row)));
  return c.json({ items });
});

adminRouter.post('/', requirePermission('portfolio', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createPortfolioProjectSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const mediaErr = validatePortfolioMediaKeys(
    parsed.data.cover_image_key,
    parsed.data.gallery_image_keys,
  );
  if (mediaErr) return c.json({ error: mediaErr }, 400);

  const slug = parsed.data.slug || slugifyPortfolioTitle(parsed.data.title);
  if (slug.length < 2) {
    return c.json(
      { error: 'Judul atau slug harus menghasilkan minimal 2 karakter alfanumerik.' },
      400,
    );
  }

  const auth = c.get('auth');
  const db = getDb();
  let created: PortfolioRow;
  try {
    created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(portfolio_projects)
        .values({
          slug,
          title: parsed.data.title,
          tagline: parsed.data.tagline,
          summary: parsed.data.summary,
          category: parsed.data.category,
          offer_type: parsed.data.offer_type,
          availability_status: parsed.data.availability_status,
          price_type: parsed.data.price_type,
          price_amount: parsed.data.price_amount ?? null,
          original_price_amount: parsed.data.original_price_amount ?? null,
          client_name: parsed.data.client_name ?? null,
          delivery_estimate: parsed.data.delivery_estimate ?? null,
          demo_url: parsed.data.demo_url ?? null,
          cover_image_key: parsed.data.cover_image_key ?? null,
          cover_image_url: parsed.data.cover_image_url ?? null,
          gallery_image_keys: parsed.data.gallery_image_keys,
          gallery_image_urls: parsed.data.gallery_image_urls,
          tech_stack: parsed.data.tech_stack,
          highlights: parsed.data.highlights,
          whatsapp_prefill: parsed.data.whatsapp_prefill ?? null,
          is_featured: parsed.data.is_featured,
          is_published: parsed.data.is_published,
          sort_order: parsed.data.sort_order,
          published_at: parsed.data.is_published ? new Date() : null,
          created_by: auth.employee.id,
          updated_by: auth.employee.id,
        })
        .returning();

      await writeAuditLog(tx, {
        actorId: auth.employee.id,
        platform: auth.platform,
        module: 'portfolio',
        action: 'create_portfolio_project',
        entityId: row.id,
        afterData: row,
      });
      return row;
    });
  } catch (err) {
    const pgErr = err as { code?: string; cause?: { code?: string } };
    if (pgErr?.code === '23505' || pgErr?.cause?.code === '23505') {
      return c.json({ error: 'Slug portofolio sudah digunakan oleh project lain.' }, 409);
    }
    throw err;
  }

  return c.json({ item: await formatAdminPortfolioRow(created) }, 201);
});

adminRouter.patch('/:id', requirePermission('portfolio', 'update'), async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) return c.json({ error: 'ID portofolio tidak valid.' }, 400);

  const body = await c.req.json().catch(() => null);
  const parsed = updatePortfolioProjectSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const mediaErr = validatePortfolioMediaKeys(
    parsed.data.cover_image_key,
    parsed.data.gallery_image_keys,
  );
  if (mediaErr) return c.json({ error: mediaErr }, 400);

  const db = getDb();
  const [target] = await db
    .select()
    .from(portfolio_projects)
    .where(eq(portfolio_projects.id, id))
    .limit(1);
  if (!target) return c.json({ error: 'Project portofolio tidak ditemukan.' }, 404);

  const nextPriceType = parsed.data.price_type ?? target.price_type;
  const nextPriceAmount =
    parsed.data.price_amount !== undefined ? parsed.data.price_amount : target.price_amount;
  if (nextPriceType !== 'negotiable' && (nextPriceAmount === null || nextPriceAmount <= 0n)) {
    return c.json({ error: 'Harga project wajib lebih dari 0 untuk tipe harga ini.' }, 400);
  }

  const nextPublished = parsed.data.is_published ?? target.is_published;
  const publishedAt = nextPublished ? target.published_at ?? new Date() : null;

  const auth = c.get('auth');
  let updated: PortfolioRow;
  try {
    updated = await db.transaction(async (tx) => {
      const patchValues: Partial<typeof portfolio_projects.$inferInsert> = {
        updated_by: auth.employee.id,
        updated_at: new Date(),
        published_at: publishedAt,
      };
      if (parsed.data.title !== undefined) patchValues.title = parsed.data.title;
      if (parsed.data.slug !== undefined) patchValues.slug = parsed.data.slug;
      if (parsed.data.tagline !== undefined) patchValues.tagline = parsed.data.tagline;
      if (parsed.data.summary !== undefined) patchValues.summary = parsed.data.summary;
      if (parsed.data.category !== undefined) patchValues.category = parsed.data.category;
      if (parsed.data.offer_type !== undefined) patchValues.offer_type = parsed.data.offer_type;
      if (parsed.data.availability_status !== undefined) {
        patchValues.availability_status = parsed.data.availability_status;
      }
      if (parsed.data.price_type !== undefined) patchValues.price_type = parsed.data.price_type;
      if (parsed.data.price_amount !== undefined) {
        patchValues.price_amount = parsed.data.price_amount;
      }
      if (parsed.data.original_price_amount !== undefined) {
        patchValues.original_price_amount = parsed.data.original_price_amount;
      }
      if (parsed.data.client_name !== undefined) patchValues.client_name = parsed.data.client_name;
      if (parsed.data.delivery_estimate !== undefined) {
        patchValues.delivery_estimate = parsed.data.delivery_estimate;
      }
      if (parsed.data.demo_url !== undefined) patchValues.demo_url = parsed.data.demo_url;
      if (parsed.data.cover_image_key !== undefined) {
        patchValues.cover_image_key = parsed.data.cover_image_key;
      }
      if (parsed.data.cover_image_url !== undefined) {
        patchValues.cover_image_url = parsed.data.cover_image_url;
      }
      if (parsed.data.gallery_image_keys !== undefined) {
        patchValues.gallery_image_keys = parsed.data.gallery_image_keys;
      }
      if (parsed.data.gallery_image_urls !== undefined) {
        patchValues.gallery_image_urls = parsed.data.gallery_image_urls;
      }
      if (parsed.data.tech_stack !== undefined) patchValues.tech_stack = parsed.data.tech_stack;
      if (parsed.data.highlights !== undefined) patchValues.highlights = parsed.data.highlights;
      if (parsed.data.whatsapp_prefill !== undefined) {
        patchValues.whatsapp_prefill = parsed.data.whatsapp_prefill;
      }
      if (parsed.data.is_featured !== undefined) patchValues.is_featured = parsed.data.is_featured;
      if (parsed.data.is_published !== undefined) patchValues.is_published = parsed.data.is_published;
      if (parsed.data.sort_order !== undefined) patchValues.sort_order = parsed.data.sort_order;

      const [row] = await tx
        .update(portfolio_projects)
        .set(patchValues)
        .where(eq(portfolio_projects.id, id))
        .returning();

      await writeAuditLog(tx, {
        actorId: auth.employee.id,
        platform: auth.platform,
        module: 'portfolio',
        action: 'update_portfolio_project',
        entityId: id,
        beforeData: target,
        afterData: row,
      });
      return row;
    });
  } catch (err) {
    const pgErr = err as { code?: string; cause?: { code?: string } };
    if (pgErr?.code === '23505' || pgErr?.cause?.code === '23505') {
      return c.json({ error: 'Slug portofolio sudah digunakan oleh project lain.' }, 409);
    }
    throw err;
  }

  return c.json({ item: await formatAdminPortfolioRow(updated) });
});

adminRouter.delete('/:id', requirePermission('portfolio', 'delete'), async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) return c.json({ error: 'ID portofolio tidak valid.' }, 400);

  const db = getDb();
  const [target] = await db
    .select()
    .from(portfolio_projects)
    .where(eq(portfolio_projects.id, id))
    .limit(1);
  if (!target) return c.json({ error: 'Project portofolio tidak ditemukan.' }, 404);

  const auth = c.get('auth');
  await db.transaction(async (tx) => {
    await tx.delete(portfolio_projects).where(eq(portfolio_projects.id, id));
    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'portfolio',
      action: 'delete_portfolio_project',
      entityId: id,
      beforeData: target,
      afterData: null,
    });
  });

  return c.json({ ok: true, id });
});

const publicRouter = new Hono<AppEnv>();

publicRouter.use('*', async (c, next) => {
  if (!checkRateLimit('pub-portfolio:' + clientIp(c), 120, 60_000)) {
    return c.json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar.' }, 429);
  }
  await next();
});

publicRouter.get('/', async (c) => {
  const categoryParam = (c.req.query('category') ?? 'all').trim().toLowerCase();
  const featuredParam = (c.req.query('featured') ?? '').trim().toLowerCase();
  const limitRaw = Number.parseInt(c.req.query('limit') ?? '50', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 50;

  const conditions = [eq(portfolio_projects.is_published, true)];
  if (categoryParam && categoryParam !== 'all') {
    const parsedCat = portfolioCategorySchema.safeParse(categoryParam);
    if (!parsedCat.success) {
      c.header('Cache-Control', 'public, max-age=30, s-maxage=60');
      return c.json({ items: [] });
    }
    conditions.push(eq(portfolio_projects.category, parsedCat.data));
  }
  if (featuredParam === 'true') {
    conditions.push(eq(portfolio_projects.is_featured, true));
  }

  const rows = await getDb()
    .select()
    .from(portfolio_projects)
    .where(and(...conditions))
    .orderBy(
      desc(portfolio_projects.is_featured),
      asc(portfolio_projects.sort_order),
      desc(sql`coalesce(${portfolio_projects.published_at}, ${portfolio_projects.created_at})`),
    )
    .limit(limit);

  c.header('Cache-Control', 'public, max-age=30, s-maxage=60');
  return c.json({
    items: rows.map((row) => formatPublicPortfolioItem(c, row)),
  });
});

// Registered BEFORE /:slug so /media/:projectId/:slot never collides with a project slug.
publicRouter.get('/media/:projectId/:slot', async (c) => {
  const projectId = c.req.param('projectId');
  const slot = c.req.param('slot');
  if (!UUID_RE.test(projectId)) {
    return c.json({ error: 'Media portofolio tidak ditemukan.' }, 404);
  }

  const [row] = await getDb()
    .select({
      id: portfolio_projects.id,
      is_published: portfolio_projects.is_published,
      cover_image_key: portfolio_projects.cover_image_key,
      gallery_image_keys: portfolio_projects.gallery_image_keys,
    })
    .from(portfolio_projects)
    .where(and(eq(portfolio_projects.id, projectId), eq(portfolio_projects.is_published, true)))
    .limit(1);

  if (!row) {
    return c.json({ error: 'Media portofolio tidak ditemukan.' }, 404);
  }

  let targetKey: string | null = null;
  if (slot === 'cover') {
    targetKey = row.cover_image_key;
  } else if (/^[0-7]$/.test(slot)) {
    const idx = Number.parseInt(slot, 10);
    targetKey = row.gallery_image_keys?.[idx] ?? null;
  }

  if (!targetKey || !isSafePortfolioObjectKey(targetKey)) {
    return c.json({ error: 'Media portofolio tidak tersedia.' }, 404);
  }

  const signedUrl = await createPresignedDownloadUrl({
    key: targetKey,
    expiresIn: 900,
  });
  c.header('Cache-Control', 'public, max-age=300, s-maxage=300');
  return c.redirect(signedUrl, 302);
});

publicRouter.get('/:slug', async (c) => {
  const slug = (c.req.param('slug') ?? '').trim().toLowerCase();
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return c.json({ error: 'Project portofolio tidak ditemukan.' }, 404);
  }

  const [row] = await getDb()
    .select()
    .from(portfolio_projects)
    .where(and(eq(portfolio_projects.slug, slug), eq(portfolio_projects.is_published, true)))
    .limit(1);

  if (!row) {
    return c.json({ error: 'Project portofolio tidak ditemukan.' }, 404);
  }

  c.header('Cache-Control', 'public, max-age=30, s-maxage=60');
  return c.json({ item: formatPublicPortfolioItem(c, row) });
});

export const portfolioPlugin: ErpModulePlugin = {
  id: 'portfolio',
  basePath: '/portfolio',
  router: adminRouter,
};

export const publicPortfolioPlugin: ErpModulePlugin = {
  id: 'public-portfolio',
  basePath: '/public/portfolio',
  router: publicRouter,
};
