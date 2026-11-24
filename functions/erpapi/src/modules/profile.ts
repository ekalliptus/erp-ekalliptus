import { hasPermission, updateMyProfileSchema } from '@ekalliptus/contracts';
import {
  attendances,
  audit_logs,
  device_tokens,
  employees,
  finance_accounts,
  finance_obligations,
  finance_transactions,
  inventory_items,
  inventory_stocks,
  notifications,
  office_locations,
  payroll_items,
  payroll_runs,
  purchase_orders,
  roles,
  stock_movements,
  warehouses,
} from '@ekalliptus/db';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, jsonSafe } from '../db.js';
import { writeAuditLog } from '../middleware/audit.js';
import {
  getEnrolledModels,
  getStoredSampleCount,
  parseStoredDescriptors,
} from '../services/face.js';
import { createPresignedDownloadUrl } from '../services/storage.js';
import type { AppEnv, AuthContext } from '../types.js';
import type { ErpModulePlugin } from './plugin.js';

const router = new Hono<AppEnv>();

function jakartaDateStr(date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}

async function safeAvatarDownloadUrl(objectKey: string | null): Promise<string | null> {
  if (!objectKey) return null;
  try {
    return await createPresignedDownloadUrl({ key: objectKey, expiresIn: 3600 });
  } catch {
    return null;
  }
}

async function buildRoleWorkspace(auth: AuthContext) {
  const db = getDb();
  const todayStr = jakartaDateStr(new Date());
  const since30Date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  if (auth.roleCode === 'owner') {
    const [
      [cashSum],
      [empStats],
      [officeCount],
      [whCount],
      [pendingFin],
      [pendingLeaves],
      [draftPayrolls],
      [approvedPayrolls],
      [lowStock],
      [audit24h],
      offices,
      roleDist,
    ] = await Promise.all([
      db
        .select({
          total: sql<string>`coalesce(sum(${finance_accounts.balance}), 0)::text`,
        })
        .from(finance_accounts)
        .where(eq(finance_accounts.is_active, true)),
      db
        .select({
          active_count: sql<number>`count(*) filter (where ${employees.is_active} = true)::int`,
          unclaimed_count: sql<number>`count(*) filter (where ${employees.is_active} = true and ${employees.auth_user_id} is null)::int`,
        })
        .from(employees),
      db.select({ count: sql<number>`count(*)::int` }).from(office_locations),
      db.select({ count: sql<number>`count(*)::int` }).from(warehouses),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(finance_transactions)
        .where(eq(finance_transactions.status, 'pending')),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(attendances)
        .where(eq(attendances.approval_status, 'pending')),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(payroll_runs)
        .where(eq(payroll_runs.status, 'draft')),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(payroll_runs)
        .where(eq(payroll_runs.status, 'approved')),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(inventory_stocks)
        .innerJoin(inventory_items, eq(inventory_items.id, inventory_stocks.item_id))
        .where(lte(inventory_stocks.qty, inventory_items.min_stock)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(audit_logs)
        .where(sql`${audit_logs.created_at} >= now() - interval '24 hours'`),
      db.select().from(office_locations).orderBy(asc(office_locations.name)),
      db
        .select({
          role_code: roles.code,
          role_name: roles.name,
          employee_count: sql<number>`count(${employees.id})::int`,
        })
        .from(roles)
        .leftJoin(
          employees,
          and(eq(employees.role_id, roles.id), eq(employees.is_active, true)),
        )
        .groupBy(roles.id, roles.code, roles.name)
        .orderBy(asc(roles.code)),
    ]);

    return {
      kind: 'owner',
      executive_metrics: {
        total_cash_balance: cashSum?.total ?? '0',
        active_employees_count: empStats?.active_count ?? 0,
        unclaimed_employees_count: empStats?.unclaimed_count ?? 0,
        office_locations_count: officeCount?.count ?? 0,
        warehouses_count: whCount?.count ?? 0,
        pending_finance_tx: pendingFin?.count ?? 0,
        pending_attendance_approvals: pendingLeaves?.count ?? 0,
        draft_payroll_runs: draftPayrolls?.count ?? 0,
        approved_unpaid_payroll_runs: approvedPayrolls?.count ?? 0,
        low_stock_alerts: lowStock?.count ?? 0,
        audit_events_24h: audit24h?.count ?? 0,
      },
      offices,
      role_distribution: roleDist,
    };
  }

  if (auth.roleCode === 'finance' && hasPermission(auth.permissions, 'finance', 'view')) {
    const [accountsPreview, [pendingTx], [obligationsSum], [cashflow30], [approvedPay]] =
      await Promise.all([
        db
          .select({
            id: finance_accounts.id,
            name: finance_accounts.name,
            type: finance_accounts.type,
            balance: finance_accounts.balance,
          })
          .from(finance_accounts)
          .where(eq(finance_accounts.is_active, true))
          .orderBy(asc(finance_accounts.name)),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(finance_transactions)
          .where(eq(finance_transactions.status, 'pending')),
        db
          .select({
            open_receivable: sql<string>`coalesce(sum(case when ${finance_obligations.kind} = 'receivable' and ${finance_obligations.status} in ('open', 'partial') then ${finance_obligations.amount} - ${finance_obligations.paid_amount} else 0 end), 0)::text`,
            open_payable: sql<string>`coalesce(sum(case when ${finance_obligations.kind} = 'payable' and ${finance_obligations.status} in ('open', 'partial') then ${finance_obligations.amount} - ${finance_obligations.paid_amount} else 0 end), 0)::text`,
          })
          .from(finance_obligations),
        db
          .select({
            month_income: sql<string>`coalesce(sum(case when ${finance_transactions.type} = 'income' and ${finance_transactions.status} = 'posted' then ${finance_transactions.amount} else 0 end), 0)::text`,
            month_expense: sql<string>`coalesce(sum(case when ${finance_transactions.type} = 'expense' and ${finance_transactions.status} = 'posted' then ${finance_transactions.amount} else 0 end), 0)::text`,
          })
          .from(finance_transactions)
          .where(gte(finance_transactions.transacted_at, since30Date)),
        hasPermission(auth.permissions, 'payroll', 'view')
          ? db
              .select({ count: sql<number>`count(*)::int` })
              .from(payroll_runs)
              .where(eq(payroll_runs.status, 'approved'))
          : Promise.resolve([{ count: 0 }]),
      ]);

    const totalCashBalance = accountsPreview
      .reduce((acc, row) => acc + row.balance, 0n)
      .toString();

    return {
      kind: 'finance',
      finance_metrics: {
        total_cash_balance: totalCashBalance,
        active_accounts_count: accountsPreview.length,
        pending_transactions_count: pendingTx?.count ?? 0,
        open_receivable_total: obligationsSum?.open_receivable ?? '0',
        open_payable_total: obligationsSum?.open_payable ?? '0',
        month_income: cashflow30?.month_income ?? '0',
        month_expense: cashflow30?.month_expense ?? '0',
        approved_payroll_to_pay: approvedPay?.count ?? 0,
      },
      accounts_preview: accountsPreview,
    };
  }

  if (auth.roleCode === 'warehouse' && hasPermission(auth.permissions, 'inventory', 'view')) {
    const [warehousesList, [itemsCount], [lowStockCount], lowStockPreview, [openPos], [myMoves]] =
      await Promise.all([
        db.select().from(warehouses).orderBy(asc(warehouses.name)),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(inventory_items)
          .where(eq(inventory_items.is_active, true)),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(inventory_stocks)
          .innerJoin(inventory_items, eq(inventory_items.id, inventory_stocks.item_id))
          .where(lte(inventory_stocks.qty, inventory_items.min_stock)),
        db
          .select({
            item_id: inventory_items.id,
            sku: inventory_items.sku,
            name: inventory_items.name,
            unit: inventory_items.unit,
            warehouse_name: warehouses.name,
            qty: inventory_stocks.qty,
            min_stock: inventory_items.min_stock,
          })
          .from(inventory_stocks)
          .innerJoin(inventory_items, eq(inventory_items.id, inventory_stocks.item_id))
          .innerJoin(warehouses, eq(warehouses.id, inventory_stocks.warehouse_id))
          .where(lte(inventory_stocks.qty, inventory_items.min_stock))
          .orderBy(asc(inventory_stocks.qty))
          .limit(5),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(purchase_orders)
          .where(inArray(purchase_orders.status, ['draft', 'ordered'])),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(stock_movements)
          .where(
            and(
              eq(stock_movements.created_by, auth.employee.id),
              gte(stock_movements.created_at, since30Date),
            ),
          ),
      ]);

    return {
      kind: 'warehouse',
      warehouse_metrics: {
        warehouses_count: warehousesList.length,
        active_items_count: itemsCount?.count ?? 0,
        low_stock_alerts: lowStockCount?.count ?? 0,
        open_purchase_orders: openPos?.count ?? 0,
        my_movements_30d: myMoves?.count ?? 0,
      },
      low_stock_preview: lowStockPreview,
      warehouses_list: warehousesList,
    };
  }

  if (auth.roleCode === 'hr' && hasPermission(auth.permissions, 'attendance', 'view')) {
    const canRbac = hasPermission(auth.permissions, 'rbac', 'view');
    const canPayroll = hasPermission(auth.permissions, 'payroll', 'view');

    const [
      [empStats],
      [presentToday],
      [pendingLeavesCount],
      [draftPayrolls],
      [officeCount],
      pendingLeavesPreview,
      unclaimedPreview,
    ] = await Promise.all([
      canRbac
        ? db
            .select({
              active_count: sql<number>`count(*) filter (where ${employees.is_active} = true)::int`,
              unclaimed_count: sql<number>`count(*) filter (where ${employees.is_active} = true and ${employees.auth_user_id} is null)::int`,
            })
            .from(employees)
        : Promise.resolve([{ active_count: 0, unclaimed_count: 0 }]),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(attendances)
        .where(
          and(
            eq(attendances.attendance_date, todayStr),
            inArray(attendances.status, ['present', 'late']),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(attendances)
        .where(eq(attendances.approval_status, 'pending')),
      canPayroll
        ? db
            .select({ count: sql<number>`count(*)::int` })
            .from(payroll_runs)
            .where(eq(payroll_runs.status, 'draft'))
        : Promise.resolve([{ count: 0 }]),
      db.select({ count: sql<number>`count(*)::int` }).from(office_locations),
      db
        .select({
          id: attendances.id,
          employee_id: attendances.employee_id,
          employee_name: employees.full_name,
          employee_code: employees.employee_code,
          attendance_date: attendances.attendance_date,
          status: attendances.status,
          note: attendances.note,
        })
        .from(attendances)
        .innerJoin(employees, eq(employees.id, attendances.employee_id))
        .where(eq(attendances.approval_status, 'pending'))
        .orderBy(desc(attendances.attendance_date))
        .limit(5),
      canRbac
        ? db
            .select({
              id: employees.id,
              employee_code: employees.employee_code,
              full_name: employees.full_name,
              email: employees.email,
              role_name: roles.name,
            })
            .from(employees)
            .innerJoin(roles, eq(roles.id, employees.role_id))
            .where(and(eq(employees.is_active, true), isNull(employees.auth_user_id)))
            .orderBy(asc(employees.employee_code))
            .limit(5)
        : Promise.resolve([]),
    ]);

    return {
      kind: 'hr',
      hr_metrics: {
        active_employees_count: empStats?.active_count ?? 0,
        unclaimed_employees_count: empStats?.unclaimed_count ?? 0,
        present_today_count: presentToday?.count ?? 0,
        pending_attendance_approvals: pendingLeavesCount?.count ?? 0,
        draft_payroll_runs: draftPayrolls?.count ?? 0,
        offices_count: officeCount?.count ?? 0,
      },
      pending_leaves_preview: pendingLeavesPreview,
      unclaimed_employees_preview: unclaimedPreview,
    };
  }

  const canViewAttendance = hasPermission(auth.permissions, 'attendance', 'view');
  const canViewInventory = hasPermission(auth.permissions, 'inventory', 'view');

  const [offices, [catalogCount]] = await Promise.all([
    canViewAttendance
      ? db
          .select({
            id: office_locations.id,
            name: office_locations.name,
            radius_meters: office_locations.radius_meters,
            work_start_time: office_locations.work_start_time,
            work_end_time: office_locations.work_end_time,
          })
          .from(office_locations)
          .orderBy(asc(office_locations.name))
      : Promise.resolve([]),
    canViewInventory
      ? db
          .select({ count: sql<number>`count(*)::int` })
          .from(inventory_items)
          .where(eq(inventory_items.is_active, true))
      : Promise.resolve([{ count: 0 }]),
  ]);

  return {
    kind: 'staff',
    staff_metrics: {
      offices_count: offices.length,
      active_catalog_items: catalogCount?.count ?? 0,
    },
    offices,
  };
}

router.get('/profile-summary', async (c) => {
  const auth = c.get('auth');
  const db = getDb();

  const todayStr = jakartaDateStr(new Date());
  const since30Str = jakartaDateStr(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

  const [
    avatarUrl,
    [faceRow],
    tokenRows,
    [unreadRow],
    recentAudits,
    attRows,
    payrollRows,
    roleWorkspace,
  ] = await Promise.all([
    safeAvatarDownloadUrl(auth.employee.avatar_object_key),
    db
      .select({
        face_descriptors: employees.face_descriptors,
        face_reference_selfie_key: employees.face_reference_selfie_key,
        face_enrolled_at: employees.face_enrolled_at,
      })
      .from(employees)
      .where(eq(employees.id, auth.employee.id))
      .limit(1),
    db
      .select({ platform: device_tokens.platform })
      .from(device_tokens)
      .where(eq(device_tokens.auth_user_id, auth.authUserId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipient_auth_user_id, auth.authUserId),
          isNull(notifications.read_at),
        ),
      ),
    db
      .select({
        id: audit_logs.id,
        module: audit_logs.module,
        action: audit_logs.action,
        platform: audit_logs.platform,
        entity_id: audit_logs.entity_id,
        created_at: audit_logs.created_at,
      })
      .from(audit_logs)
      .where(eq(audit_logs.actor_id, auth.employee.id))
      .orderBy(desc(audit_logs.created_at))
      .limit(6),
    db
      .select({
        id: attendances.id,
        attendance_date: attendances.attendance_date,
        clock_in_at: attendances.clock_in_at,
        clock_out_at: attendances.clock_out_at,
        status: attendances.status,
        approval_status: attendances.approval_status,
        late_minutes: attendances.late_minutes,
        overtime_minutes: attendances.overtime_minutes,
        clock_in_method: attendances.clock_in_method,
        office_name: office_locations.name,
      })
      .from(attendances)
      .leftJoin(office_locations, eq(office_locations.id, attendances.office_id))
      .where(
        and(
          eq(attendances.employee_id, auth.employee.id),
          gte(attendances.attendance_date, since30Str),
        ),
      )
      .orderBy(desc(attendances.attendance_date)),
    hasPermission(auth.permissions, 'payroll', 'view')
      ? db
          .select({
            item_id: payroll_items.id,
            payroll_run_id: payroll_items.payroll_run_id,
            period_start: payroll_runs.period_start,
            period_end: payroll_runs.period_end,
            run_status: payroll_runs.status,
            base_salary: payroll_items.base_salary,
            allowances: payroll_items.allowances,
            overtime_pay: payroll_items.overtime_pay,
            deductions: payroll_items.deductions,
            net_salary: payroll_items.net_salary,
            slip_pdf_object_key: payroll_items.slip_pdf_object_key,
            paid_at: payroll_runs.paid_at,
          })
          .from(payroll_items)
          .innerJoin(payroll_runs, eq(payroll_runs.id, payroll_items.payroll_run_id))
          .where(eq(payroll_items.employee_id, auth.employee.id))
          .orderBy(desc(payroll_runs.period_end))
          .limit(3)
      : Promise.resolve([]),
    buildRoleWorkspace(auth),
  ]);

  let webDevices = 0;
  let flutterDevices = 0;
  for (const t of tokenRows) {
    if (t.platform === 'flutter') flutterDevices++;
    else if (t.platform === 'web') webDevices++;
  }

  let presentDays = 0;
  let lateDays = 0;
  let leaveDays = 0;
  let sickDays = 0;
  let totalLateMinutes = 0;
  let totalOvertimeMinutes = 0;
  let todayAttendance: (typeof attRows)[number] | null = null;

  for (const row of attRows) {
    if (row.attendance_date === todayStr) {
      todayAttendance = row;
    }
    if (row.status === 'present' || row.status === 'late') {
      presentDays++;
    }
    if (row.status === 'late') lateDays++;
    if (row.status === 'leave') leaveDays++;
    if (row.status === 'sick') sickDays++;
    totalLateMinutes += Number(row.late_minutes ?? 0);
    totalOvertimeMinutes += Number(row.overtime_minutes ?? 0);
  }

  const storedFace = parseStoredDescriptors(faceRow?.face_descriptors);
  const enrolledFaceModels = getEnrolledModels(storedFace);
  const faceSampleCount = getStoredSampleCount(storedFace);
  const faceReferenceUrl = await safeAvatarDownloadUrl(faceRow?.face_reference_selfie_key ?? null);

  return c.json(
    jsonSafe({
      employee: {
        ...auth.employee,
        avatar_url: avatarUrl,
      },
      face_enrollment: {
        enrolled: enrolledFaceModels.length > 0 || Boolean(faceRow?.face_enrolled_at),
        enrolled_at: faceRow?.face_enrolled_at ?? null,
        models: enrolledFaceModels,
        has_reference_photo: Boolean(faceRow?.face_reference_selfie_key),
        reference_photo_url: faceReferenceUrl,
        sample_count: faceSampleCount,
        poses: storedFace.meta?.poses ?? [],
        is_multi_pose: faceSampleCount >= 3,
      },
      role: {
        code: auth.roleCode,
        name: auth.roleName,
        description: auth.roleDescription,
      },
      permissions: Array.from(auth.permissions).sort(),
      platform: auth.platform,
      security: {
        registered_devices_count: tokenRows.length,
        device_platforms: {
          web: webDevices,
          flutter: flutterDevices,
        },
        unread_notifications: unreadRow?.count ?? 0,
        recent_audit_actions: recentAudits,
      },
      personal_attendance: {
        days_window: 30,
        present_days: presentDays,
        late_days: lateDays,
        leave_days: leaveDays,
        sick_days: sickDays,
        total_late_minutes: totalLateMinutes,
        total_overtime_minutes: totalOvertimeMinutes,
        today: todayAttendance,
        recent_records: attRows.slice(0, 5),
      },
      personal_payroll: payrollRows.map((p) => ({
        item_id: p.item_id,
        payroll_run_id: p.payroll_run_id,
        period_start: p.period_start,
        period_end: p.period_end,
        run_status: p.run_status,
        base_salary: p.base_salary,
        allowances: p.allowances,
        overtime_pay: p.overtime_pay,
        deductions: p.deductions,
        net_salary: p.net_salary,
        has_pdf: Boolean(p.slip_pdf_object_key),
        paid_at: p.paid_at,
      })),
      role_workspace: roleWorkspace,
    }),
  );
});

router.patch('/profile', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateMyProfileSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const auth = c.get('auth');
  const db = getDb();
  const data = parsed.data;

  if (typeof data.avatar_object_key === 'string' && data.avatar_object_key.length > 0) {
    if (!data.avatar_object_key.startsWith(`avatar/${auth.employee.id}/`)) {
      return c.json(
        { error: 'Forbidden: object_key avatar bukan milik akun Anda.' },
        403,
      );
    }
  }

  const updateSet: {
    full_name?: string;
    username?: string | null;
    phone?: string | null;
    avatar_object_key?: string | null;
  } = {};

  if (data.full_name !== undefined) {
    updateSet.full_name = data.full_name;
  }
  if (data.username !== undefined) {
    updateSet.username = data.username ?? null;
  }
  if (data.phone !== undefined) {
    updateSet.phone = data.phone && data.phone.trim().length > 0 ? data.phone.trim() : null;
  }
  if (data.avatar_object_key !== undefined) {
    updateSet.avatar_object_key = data.avatar_object_key ?? null;
  }

  try {
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(employees)
        .set(updateSet)
        .where(eq(employees.id, auth.employee.id))
        .returning();

      await writeAuditLog(tx, {
        actorId: auth.employee.id,
        platform: auth.platform,
        module: 'rbac',
        action: 'update_own_profile',
        entityId: auth.employee.id,
        beforeData: {
          full_name: auth.employee.full_name,
          username: auth.employee.username,
          phone: auth.employee.phone,
          avatar_object_key: auth.employee.avatar_object_key,
        },
        afterData: {
          full_name: row.full_name,
          username: row.username,
          phone: row.phone,
          avatar_object_key: row.avatar_object_key,
        },
      });

      return row;
    });

    const avatarUrl = await safeAvatarDownloadUrl(updated.avatar_object_key);
    return c.json({
      employee: jsonSafe(updated),
      avatar_url: avatarUrl,
    });
  } catch (err) {
    const pgErr = err as { code?: string; cause?: { code?: string } };
    if (pgErr?.code === '23505' || pgErr?.cause?.code === '23505') {
      return c.json({ error: 'Username sudah dipakai karyawan lain.' }, 409);
    }
    throw err;
  }
});

export const profilePlugin: ErpModulePlugin = {
  id: 'profile',
  basePath: '/me',
  router,
};
