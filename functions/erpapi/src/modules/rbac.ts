import crypto from 'node:crypto';
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  updateRolePermissionsSchema,
} from '@ekalliptus/contracts';
import {
  attendances,
  audit_logs,
  device_tokens,
  employees,
  finance_obligations,
  finance_transactions,
  notifications,
  payroll_items,
  payroll_runs,
  permissions,
  purchase_orders,
  role_permissions,
  roles,
  stock_movements,
} from '@ekalliptus/db';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, jsonSafe } from '../db.js';
import { writeAuditLog } from '../middleware/audit.js';
import { requirePermission } from '../middleware/rbac.js';
import type { AppEnv } from '../types.js';
import type { ErpModulePlugin } from './plugin.js';

function generateActivationCode(): { code: string; hash: string } {
  const code =
    'EK-' +
    crypto
      .randomBytes(16)
      .toString('base64url')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 10)
      .toUpperCase();
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  return { code, hash };
}

function mapEmployeeUniqueError(err: unknown): string | null {
  const pgErr = err as {
    code?: string;
    constraint?: string;
    detail?: string;
    message?: string;
    cause?: {
      code?: string;
      constraint?: string;
      detail?: string;
      message?: string;
    };
  };
  const code = pgErr?.code ?? pgErr?.cause?.code;
  if (code !== '23505') return null;

  const text = [
    pgErr?.constraint,
    pgErr?.cause?.constraint,
    pgErr?.detail,
    pgErr?.cause?.detail,
    pgErr?.message,
    pgErr?.cause?.message,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (text.includes('employee_code')) {
    return 'Kode karyawan sudah digunakan karyawan lain.';
  }
  if (text.includes('email')) {
    return 'Email kerja sudah terdaftar pada karyawan lain.';
  }
  if (text.includes('username')) {
    return 'Username sudah dipakai karyawan lain.';
  }
  return 'Data karyawan duplikat dengan karyawan yang sudah ada.';
}

async function countActiveOwners(db: ReturnType<typeof getDb>): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(employees)
    .innerJoin(roles, eq(roles.id, employees.role_id))
    .where(and(eq(roles.code, 'owner'), eq(employees.is_active, true)));
  return row?.count ?? 0;
}

const router = new Hono<AppEnv>();

router.get('/roles', requirePermission('rbac', 'view'), async (c) => {
  const db = getDb();
  const roleList = await db.select().from(roles).orderBy(roles.code);
  const rpRows = await db
    .select({
      role_id: role_permissions.role_id,
      permission_id: permissions.id,
      module: permissions.module,
      action: permissions.action,
    })
    .from(role_permissions)
    .innerJoin(permissions, eq(permissions.id, role_permissions.permission_id));

  const permsByRole = new Map<string, Array<{ id: string; module: string; action: string }>>();
  for (const row of rpRows) {
    const arr = permsByRole.get(row.role_id) ?? [];
    arr.push({ id: row.permission_id, module: row.module, action: row.action });
    permsByRole.set(row.role_id, arr);
  }

  return c.json({
    roles: roleList.map((r) => ({
      ...r,
      permissions: permsByRole.get(r.id) ?? [],
    })),
  });
});

router.get('/permissions', requirePermission('rbac', 'view'), async (c) => {
  const rows = await getDb()
    .select()
    .from(permissions)
    .orderBy(permissions.module, permissions.action);
  return c.json({ permissions: rows });
});

router.put('/roles/:id/permissions', requirePermission('rbac', 'update'), async (c) => {
  const auth = c.get('auth');
  if (auth.roleCode !== 'owner') {
    return c.json({ error: 'Forbidden: only owner can update role permissions.' }, 403);
  }
  const roleId = c.req.param('id');
  if (!roleId) return c.json({ error: 'Missing role id.' }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = updateRolePermissionsSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const db = getDb();
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role) return c.json({ error: 'Role not found.' }, 404);

  if (role.code === 'owner') {
    const guardPerms = await db
      .select({ id: permissions.id, module: permissions.module, action: permissions.action })
      .from(permissions)
      .where(eq(permissions.module, 'rbac'));
    const requiredIds = guardPerms
      .filter((p) => p.action === 'view' || p.action === 'update')
      .map((p) => p.id);
    const nextSet = new Set(parsed.data.permission_ids);
    const missing = requiredIds.some((reqId) => !nextSet.has(reqId));
    if (missing) {
      return c.json(
        {
          error: 'Role Owner wajib mempertahankan izin rbac:view dan rbac:update agar tidak terkunci.',
        },
        400,
      );
    }
  }

  const beforePerms = await db
    .select()
    .from(role_permissions)
    .where(eq(role_permissions.role_id, roleId));

  await db.transaction(async (tx) => {
    await tx.delete(role_permissions).where(eq(role_permissions.role_id, roleId));
    for (const permId of parsed.data.permission_ids) {
      await tx
        .insert(role_permissions)
        .values({ role_id: roleId, permission_id: permId })
        .onConflictDoNothing();
    }
    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'rbac',
      action: 'update_role_permissions',
      entityId: roleId,
      beforeData: beforePerms,
      afterData: { permission_ids: parsed.data.permission_ids },
    });
  });

  return c.json({ ok: true, role_id: roleId, count: parsed.data.permission_ids.length });
});

router.get('/employees', requirePermission('rbac', 'view'), async (c) => {
  const rows = await getDb()
    .select({
      id: employees.id,
      auth_user_id: employees.auth_user_id,
      role_id: employees.role_id,
      role_code: roles.code,
      role_name: roles.name,
      employee_code: employees.employee_code,
      full_name: employees.full_name,
      email: employees.email,
      username: employees.username,
      phone: employees.phone,
      base_salary: employees.base_salary,
      is_active: employees.is_active,
      has_claim_code: sql<boolean>`${employees.claim_code_hash} IS NOT NULL`,
      avatar_object_key: employees.avatar_object_key,
      face_enrolled: sql<boolean>`${employees.face_enrolled_at} IS NOT NULL`,
      face_enrolled_at: employees.face_enrolled_at,
      created_at: employees.created_at,
    })
    .from(employees)
    .innerJoin(roles, eq(roles.id, employees.role_id))
    .orderBy(employees.employee_code);

  return c.json({ employees: jsonSafe(rows) });
});

router.post('/employees', requirePermission('rbac', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createEmployeeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const db = getDb();

  const [targetRole] = await db
    .select()
    .from(roles)
    .where(eq(roles.id, parsed.data.role_id))
    .limit(1);
  if (!targetRole) {
    return c.json({ error: 'Role yang dipilih tidak ditemukan.' }, 400);
  }
  if (targetRole.code === 'owner' && auth.roleCode !== 'owner') {
    return c.json(
      { error: 'Forbidden: hanya Owner yang dapat membuat karyawan dengan role Owner.' },
      403,
    );
  }

  const issued = parsed.data.issue_claim_code === true ? generateActivationCode() : null;

  let created: typeof employees.$inferSelect;
  try {
    const [row] = await db
      .insert(employees)
      .values({
        employee_code: parsed.data.employee_code,
        full_name: parsed.data.full_name,
        email: parsed.data.email,
        username: parsed.data.username ?? null,
        phone: parsed.data.phone ?? null,
        role_id: parsed.data.role_id,
        base_salary: parsed.data.base_salary,
        claim_code_hash: issued?.hash ?? null,
      })
      .returning();
    created = row;
  } catch (err) {
    const conflictMsg = mapEmployeeUniqueError(err);
    if (conflictMsg) return c.json({ error: conflictMsg }, 409);
    throw err;
  }

  await writeAuditLog(db, {
    actorId: auth.employee.id,
    platform: auth.platform,
    module: 'rbac',
    action: 'create_employee',
    entityId: created.id,
    afterData: {
      id: created.id,
      employee_code: created.employee_code,
      full_name: created.full_name,
      email: created.email,
      username: created.username,
      role_id: created.role_id,
      base_salary: created.base_salary,
      is_active: created.is_active,
      claim_code_issued: Boolean(issued),
    },
  });

  return c.json(
    {
      employee: jsonSafe(created),
      ...(issued ? { claim_code: issued.code } : {}),
    },
    201,
  );
});

router.patch('/employees/:id', requirePermission('rbac', 'update'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing employee id.' }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = updateEmployeeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const db = getDb();
  const [before] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
  if (!before) return c.json({ error: 'Employee not found.' }, 404);

  const [beforeRole] = await db
    .select()
    .from(roles)
    .where(eq(roles.id, before.role_id))
    .limit(1);

  if (beforeRole?.code === 'owner' && auth.roleCode !== 'owner') {
    return c.json(
      { error: 'Forbidden: hanya Owner yang dapat mengubah data akun Owner.' },
      403,
    );
  }

  let nextRole: typeof roles.$inferSelect | undefined;
  if (parsed.data.role_id !== undefined) {
    const [r] = await db
      .select()
      .from(roles)
      .where(eq(roles.id, parsed.data.role_id))
      .limit(1);
    if (!r) {
      return c.json({ error: 'Role yang dipilih tidak ditemukan.' }, 400);
    }
    if (r.code === 'owner' && auth.roleCode !== 'owner') {
      return c.json(
        { error: 'Forbidden: hanya Owner yang dapat menetapkan role Owner.' },
        403,
      );
    }
    nextRole = r;
  }

  if (id === auth.employee.id && parsed.data.is_active === false) {
    return c.json({ error: 'Anda tidak dapat menonaktifkan akun sendiri.' }, 400);
  }

  if (id === auth.employee.id && nextRole && nextRole.code !== 'owner' && beforeRole?.code === 'owner') {
    return c.json({ error: 'Anda tidak dapat menurunkan role Owner milik sendiri.' }, 400);
  }

  const demotingOwner = Boolean(
    beforeRole?.code === 'owner' && nextRole && nextRole.code !== 'owner',
  );
  const deactivatingOwner = Boolean(
    beforeRole?.code === 'owner' && parsed.data.is_active === false,
  );
  if ((demotingOwner || deactivatingOwner) && before.is_active) {
    const activeOwners = await countActiveOwners(db);
    if (activeOwners <= 1) {
      return c.json({ error: 'Minimal harus ada satu akun Owner yang aktif.' }, 400);
    }
  }

  const updates: Partial<typeof employees.$inferInsert> = {};
  if (parsed.data.employee_code !== undefined) updates.employee_code = parsed.data.employee_code;
  if (parsed.data.email !== undefined) updates.email = parsed.data.email;
  if (parsed.data.full_name !== undefined) updates.full_name = parsed.data.full_name;
  if (parsed.data.username !== undefined) updates.username = parsed.data.username;
  if (parsed.data.phone !== undefined) updates.phone = parsed.data.phone;
  if (parsed.data.role_id !== undefined) updates.role_id = parsed.data.role_id;
  if (parsed.data.base_salary !== undefined) updates.base_salary = parsed.data.base_salary;
  if (parsed.data.is_active !== undefined) updates.is_active = parsed.data.is_active;
  if (parsed.data.avatar_object_key !== undefined) {
    updates.avatar_object_key = parsed.data.avatar_object_key;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'Minimal satu data karyawan harus dikirim untuk diperbarui.' }, 400);
  }

  let updated: typeof employees.$inferSelect;
  try {
    const [row] = await db
      .update(employees)
      .set(updates)
      .where(eq(employees.id, id))
      .returning();
    updated = row;
  } catch (err) {
    const conflictMsg = mapEmployeeUniqueError(err);
    if (conflictMsg) return c.json({ error: conflictMsg }, 409);
    throw err;
  }

  await writeAuditLog(db, {
    actorId: auth.employee.id,
    platform: auth.platform,
    module: 'rbac',
    action: 'update_employee',
    entityId: id,
    beforeData: before,
    afterData: updated,
  });

  return c.json({ employee: jsonSafe(updated) });
});

router.post('/employees/:id/claim-code', requirePermission('rbac', 'update'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing employee id.' }, 400);
  const auth = c.get('auth');
  const db = getDb();

  const [target] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
  if (!target) return c.json({ error: 'Employee not found.' }, 404);

  const [targetRole] = await db
    .select()
    .from(roles)
    .where(eq(roles.id, target.role_id))
    .limit(1);
  if (targetRole?.code === 'owner' && auth.roleCode !== 'owner') {
    return c.json(
      { error: 'Forbidden: hanya Owner yang dapat membuat kode aktivasi untuk akun Owner.' },
      403,
    );
  }
  if (target.auth_user_id != null) {
    return c.json(
      {
        error:
          'Karyawan ini sudah tertaut ke akun login. Putus tautan akun terlebih dahulu bila perlu aktivasi ulang.',
      },
      409,
    );
  }

  const { code, hash } = generateActivationCode();
  const [row] = await db
    .update(employees)
    .set({ claim_code_hash: hash })
    .where(eq(employees.id, id))
    .returning({ id: employees.id, email: employees.email, full_name: employees.full_name });

  await writeAuditLog(db, {
    actorId: auth.employee.id,
    platform: auth.platform,
    module: 'rbac',
    action: 'generate_claim_code',
    entityId: id,
    afterData: { email: row.email },
  });

  // Plaintext hanya dikembalikan sekali di sini; DB menyimpan hash saja.
  return c.json({ code, email: row.email, full_name: row.full_name });
});

router.post('/employees/:id/unlink-auth', requirePermission('rbac', 'update'), async (c) => {
  const auth = c.get('auth');
  if (auth.roleCode !== 'owner') {
    return c.json(
      { error: 'Forbidden: hanya Owner yang dapat memutus tautan akun login.' },
      403,
    );
  }
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing employee id.' }, 400);
  if (id === auth.employee.id) {
    return c.json({ error: 'Anda tidak dapat memutus tautan akun sendiri.' }, 400);
  }

  const body = (await c.req.json().catch(() => null)) as { issue_claim_code?: boolean } | null;
  const issueClaimCode = body?.issue_claim_code !== false;

  const db = getDb();
  const [before] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
  if (!before) return c.json({ error: 'Employee not found.' }, 404);
  if (!before.auth_user_id) {
    return c.json({ error: 'Karyawan ini belum tertaut ke akun login.' }, 400);
  }

  const issued = issueClaimCode ? generateActivationCode() : null;

  const updated = await db.transaction(async (tx) => {
    const authUserId = before.auth_user_id!;
    // Hapus token push & notifikasi user lama sebelum mengosongkan auth_user_id
    // agar FK ke employees(auth_user_id) tidak gagal.
    await tx.delete(device_tokens).where(eq(device_tokens.auth_user_id, authUserId));
    await tx.delete(notifications).where(eq(notifications.recipient_auth_user_id, authUserId));

    const [row] = await tx
      .update(employees)
      .set({
        auth_user_id: null,
        claim_code_hash: issued?.hash ?? null,
      })
      .where(eq(employees.id, id))
      .returning();

    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'rbac',
      action: 'unlink_employee_auth',
      entityId: id,
      beforeData: { auth_user_id: before.auth_user_id },
      afterData: { auth_user_id: null, claim_code_issued: Boolean(issued) },
    });

    return row;
  });

  return c.json({
    ok: true,
    employee: jsonSafe(updated),
    ...(issued ? { claim_code: issued.code } : {}),
  });
});

router.delete('/employees/:id/face', requirePermission('rbac', 'update'), async (c) => {
  const auth = c.get('auth');
  if (auth.roleCode !== 'owner' && auth.roleCode !== 'hr') {
    return c.json({ error: 'Forbidden: hanya Owner atau HR yang dapat mereset data wajah.' }, 403);
  }
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing employee id.' }, 400);

  const db = getDb();
  const [before] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
  if (!before) return c.json({ error: 'Employee not found.' }, 404);

  const [beforeRole] = await db
    .select()
    .from(roles)
    .where(eq(roles.id, before.role_id))
    .limit(1);
  if (beforeRole?.code === 'owner' && auth.roleCode !== 'owner') {
    return c.json(
      { error: 'Forbidden: hanya Owner yang dapat mereset data wajah akun Owner.' },
      403,
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(employees)
      .set({
        face_descriptors: null,
        face_reference_selfie_key: null,
        face_enrolled_at: null,
      })
      .where(eq(employees.id, id));

    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'rbac',
      action: 'reset_employee_face',
      entityId: id,
      beforeData: {
        face_enrolled_at: before.face_enrolled_at,
        has_reference_photo: Boolean(before.face_reference_selfie_key),
      },
      afterData: { face_enrolled: false },
    });
  });

  return c.json({ ok: true, id });
});

router.delete('/employees/:id', requirePermission('rbac', 'delete'), async (c) => {
  const auth = c.get('auth');
  if (auth.roleCode !== 'owner') {
    return c.json({ error: 'Forbidden: hanya Owner yang dapat menghapus karyawan.' }, 403);
  }
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing employee id.' }, 400);
  if (id === auth.employee.id) {
    return c.json({ error: 'Anda tidak dapat menghapus akun sendiri.' }, 400);
  }

  const db = getDb();
  const [before] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
  if (!before) return c.json({ error: 'Employee not found.' }, 404);

  const [beforeRole] = await db
    .select()
    .from(roles)
    .where(eq(roles.id, before.role_id))
    .limit(1);
  if (beforeRole?.code === 'owner' && before.is_active) {
    const activeOwners = await countActiveOwners(db);
    if (activeOwners <= 1) {
      return c.json({ error: 'Minimal harus ada satu akun Owner yang aktif.' }, 400);
    }
  }

  const [
    attRes,
    payItemRes,
    payRunRes,
    finTxRes,
    finObRes,
    stockMvRes,
    poRes,
    auditRes,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(attendances)
      .where(or(eq(attendances.employee_id, id), eq(attendances.approved_by, id))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(payroll_items)
      .where(eq(payroll_items.employee_id, id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(payroll_runs)
      .where(or(eq(payroll_runs.created_by, id), eq(payroll_runs.approved_by, id))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(finance_transactions)
      .where(or(eq(finance_transactions.created_by, id), eq(finance_transactions.approved_by, id))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(finance_obligations)
      .where(eq(finance_obligations.created_by, id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(stock_movements)
      .where(eq(stock_movements.created_by, id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(purchase_orders)
      .where(eq(purchase_orders.created_by, id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(audit_logs)
      .where(eq(audit_logs.actor_id, id)),
  ]);

  const refCounts = {
    attendances: attRes[0]?.count ?? 0,
    payroll_items: payItemRes[0]?.count ?? 0,
    payroll_runs: payRunRes[0]?.count ?? 0,
    finance_transactions: finTxRes[0]?.count ?? 0,
    finance_obligations: finObRes[0]?.count ?? 0,
    stock_movements: stockMvRes[0]?.count ?? 0,
    purchase_orders: poRes[0]?.count ?? 0,
    audit_logs: auditRes[0]?.count ?? 0,
  };

  const nonZeroRefs = Object.fromEntries(
    Object.entries(refCounts).filter(([, count]) => count > 0),
  );
  const totalRefs = Object.values(refCounts).reduce((sum, n) => sum + n, 0);

  if (totalRefs > 0) {
    return c.json(
      {
        error:
          'Karyawan memiliki riwayat operasional sehingga tidak dapat dihapus permanen. Nonaktifkan akun sebagai gantinya.',
        can_deactivate: true,
        references: nonZeroRefs,
      },
      409,
    );
  }

  await db.transaction(async (tx) => {
    if (before.auth_user_id) {
      await tx.delete(device_tokens).where(eq(device_tokens.auth_user_id, before.auth_user_id));
      await tx
        .delete(notifications)
        .where(eq(notifications.recipient_auth_user_id, before.auth_user_id));
    }
    await tx.delete(notifications).where(eq(notifications.actor_employee_id, id));
    await tx.delete(employees).where(eq(employees.id, id));
    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'rbac',
      action: 'delete_employee',
      entityId: id,
      beforeData: before,
      afterData: null,
    });
  });

  return c.json({ ok: true, mode: 'deleted', employee_id: id });
});

router.get('/audit-logs', requirePermission('audit', 'view'), async (c) => {
  const moduleFilter = c.req.query('module');
  const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 300);

  const rows = await getDb()
    .select({
      id: audit_logs.id,
      actor_id: audit_logs.actor_id,
      actor_name: employees.full_name,
      actor_email: employees.email,
      platform: audit_logs.platform,
      module: audit_logs.module,
      action: audit_logs.action,
      entity_id: audit_logs.entity_id,
      before_data: audit_logs.before_data,
      after_data: audit_logs.after_data,
      created_at: audit_logs.created_at,
    })
    .from(audit_logs)
    .leftJoin(employees, eq(employees.id, audit_logs.actor_id))
    .where(moduleFilter ? eq(audit_logs.module, moduleFilter) : undefined)
    .orderBy(desc(audit_logs.created_at))
    .limit(limit);

  return c.json({ audit_logs: jsonSafe(rows) });
});

export const rbacPlugin: ErpModulePlugin = {
  id: 'rbac',
  basePath: '/rbac',
  router,
};
