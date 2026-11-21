import {
  createEmployeeSchema,
  updateEmployeeSchema,
  updateRolePermissionsSchema,
} from '@ekalliptus/contracts';
import {
  audit_logs,
  employees,
  permissions,
  role_permissions,
  roles,
} from '@ekalliptus/db';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, jsonSafe } from '../db.js';
import { writeAuditLog } from '../middleware/audit.js';
import { requirePermission } from '../middleware/rbac.js';
import type { AppEnv } from '../types.js';
import type { ErpModulePlugin } from './plugin.js';

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
      phone: employees.phone,
      base_salary: employees.base_salary,
      is_active: employees.is_active,
      avatar_object_key: employees.avatar_object_key,
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

  const [created] = await db
    .insert(employees)
    .values({
      employee_code: parsed.data.employee_code,
      full_name: parsed.data.full_name,
      email: parsed.data.email,
      phone: parsed.data.phone ?? null,
      role_id: parsed.data.role_id,
      base_salary: parsed.data.base_salary,
    })
    .returning();

  await writeAuditLog(db, {
    actorId: auth.employee.id,
    platform: auth.platform,
    module: 'rbac',
    action: 'create_employee',
    entityId: created.id,
    afterData: created,
  });

  return c.json({ employee: jsonSafe(created) }, 201);
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

  const [updated] = await db
    .update(employees)
    .set(parsed.data)
    .where(eq(employees.id, id))
    .returning();

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
