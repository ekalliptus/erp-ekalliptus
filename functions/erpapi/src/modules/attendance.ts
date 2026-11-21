import {
  approveAttendanceSchema,
  clockInSchema,
  clockOutSchema,
  createOfficeSchema,
  leaveRequestSchema,
} from '@ekalliptus/contracts';
import { attendances, employees, office_locations } from '@ekalliptus/db';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, jsonSafe } from '../db.js';
import { emitErpEvent, writeAuditLog } from '../middleware/audit.js';
import { requirePermission } from '../middleware/rbac.js';
import type { AppEnv } from '../types.js';
import type { ErpModulePlugin } from './plugin.js';

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function jakartaDateParts(now = new Date()): { dateStr: string; minutesOfDay: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const minutesOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  return { dateStr, minutesOfDay };
}

function parseHhMm(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

const router = new Hono<AppEnv>();

router.get('/offices', requirePermission('attendance', 'view'), async (c) => {
  const rows = await getDb().select().from(office_locations).orderBy(office_locations.name);
  return c.json({ offices: jsonSafe(rows) });
});

router.post('/offices', requirePermission('attendance', 'create'), async (c) => {
  const auth = c.get('auth');
  if (auth.roleCode !== 'owner' && auth.roleCode !== 'hr') {
    return c.json({ error: 'Forbidden: only owner or hr can configure office locations.' }, 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = createOfficeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const [office] = await getDb().insert(office_locations).values(parsed.data).returning();
  await writeAuditLog(getDb(), {
    actorId: auth.employee.id,
    platform: auth.platform,
    module: 'attendance',
    action: 'create_office_location',
    entityId: office.id,
    afterData: office,
  });
  return c.json({ office: jsonSafe(office) }, 201);
});

router.get('/records', requirePermission('attendance', 'view'), async (c) => {
  const auth = c.get('auth');
  const canViewAll =
    auth.roleCode === 'owner' || auth.roleCode === 'hr' || auth.roleCode === 'finance';
  const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 300);

  const rows = await getDb()
    .select({
      id: attendances.id,
      employee_id: attendances.employee_id,
      employee_name: employees.full_name,
      employee_code: employees.employee_code,
      office_id: attendances.office_id,
      office_name: office_locations.name,
      attendance_date: attendances.attendance_date,
      clock_in_at: attendances.clock_in_at,
      clock_out_at: attendances.clock_out_at,
      clock_in_lat: attendances.clock_in_lat,
      clock_in_lng: attendances.clock_in_lng,
      clock_in_selfie_key: attendances.clock_in_selfie_key,
      clock_out_selfie_key: attendances.clock_out_selfie_key,
      status: attendances.status,
      late_minutes: attendances.late_minutes,
      overtime_minutes: attendances.overtime_minutes,
      note: attendances.note,
      approval_status: attendances.approval_status,
      approved_by: attendances.approved_by,
    })
    .from(attendances)
    .innerJoin(employees, eq(employees.id, attendances.employee_id))
    .leftJoin(office_locations, eq(office_locations.id, attendances.office_id))
    .where(canViewAll ? undefined : eq(attendances.employee_id, auth.employee.id))
    .orderBy(desc(attendances.attendance_date))
    .limit(limit);

  return c.json({ records: jsonSafe(rows) });
});

router.post('/clock-in', requirePermission('attendance', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = clockInSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const data = parsed.data;
  const db = getDb();

  if (!data.selfie_object_key && !data.qr_token) {
    return c.json(
      { error: 'Either selfie_object_key or office qr_token is required for clock-in.' },
      400,
    );
  }

  const [office] = await db
    .select()
    .from(office_locations)
    .where(eq(office_locations.id, data.office_id))
    .limit(1);
  if (!office) return c.json({ error: 'Office location not found.' }, 404);

  const distance = haversineMeters(
    data.latitude,
    data.longitude,
    office.latitude,
    office.longitude,
  );
  if (distance > office.radius_meters) {
    return c.json(
      {
        error: `Outside geofence radius (${Math.round(distance)}m > ${office.radius_meters}m allowed for ${office.name}).`,
        distance_meters: Math.round(distance),
        radius_meters: office.radius_meters,
      },
      400,
    );
  }

  const now = new Date();
  const { dateStr, minutesOfDay } = jakartaDateParts(now);
  const startMinutes = parseHhMm(office.work_start_time);
  const lateMinutes = Math.max(0, minutesOfDay - startMinutes);
  const status = lateMinutes > 0 ? 'late' : 'present';

  const existing = await db
    .select()
    .from(attendances)
    .where(
      and(
        eq(attendances.employee_id, auth.employee.id),
        eq(attendances.attendance_date, dateStr),
      ),
    )
    .limit(1);

  if (existing.length > 0 && existing[0].clock_in_at) {
    return c.json({ error: `Already clocked in today (${dateStr}).` }, 409);
  }

  const record = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(attendances)
      .values({
        employee_id: auth.employee.id,
        office_id: office.id,
        attendance_date: dateStr,
        clock_in_at: now,
        clock_in_lat: data.latitude,
        clock_in_lng: data.longitude,
        clock_in_selfie_key: data.selfie_object_key ?? null,
        status,
        late_minutes: lateMinutes,
        overtime_minutes: 0,
        note: data.note ?? null,
        approval_status: 'approved',
      })
      .returning();

    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'attendance',
      action: 'clock_in',
      entityId: inserted.id,
      afterData: { ...inserted, distance_meters: Math.round(distance) },
    });

    await emitErpEvent(tx, 'erp:attendance', 'clock_in', {
      attendance_id: inserted.id,
      employee_id: auth.employee.id,
      employee_name: auth.employee.full_name,
      status,
      late_minutes: lateMinutes,
    });

    return inserted;
  });

  return c.json(
    { record: jsonSafe(record), distance_meters: Math.round(distance) },
    201,
  );
});

router.post('/clock-out', requirePermission('attendance', 'create'), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = clockOutSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const data = parsed.data;
  const db = getDb();
  const now = new Date();
  const { dateStr, minutesOfDay } = jakartaDateParts(now);

  const [today] = await db
    .select()
    .from(attendances)
    .where(
      and(
        eq(attendances.employee_id, auth.employee.id),
        eq(attendances.attendance_date, dateStr),
      ),
    )
    .limit(1);

  if (!today || !today.clock_in_at) {
    return c.json({ error: `No clock-in record found for today (${dateStr}).` }, 404);
  }
  if (today.clock_out_at) {
    return c.json({ error: `Already clocked out today (${dateStr}).` }, 409);
  }

  let endMinutes = 17 * 60;
  if (today.office_id) {
    const [office] = await db
      .select()
      .from(office_locations)
      .where(eq(office_locations.id, today.office_id))
      .limit(1);
    if (office) endMinutes = parseHhMm(office.work_end_time);
  }
  const overtimeMinutes = Math.max(0, minutesOfDay - endMinutes);

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(attendances)
      .set({
        clock_out_at: now,
        clock_out_selfie_key: data.selfie_object_key ?? null,
        overtime_minutes: overtimeMinutes,
        note: data.note ?? today.note,
      })
      .where(eq(attendances.id, today.id))
      .returning();

    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'attendance',
      action: 'clock_out',
      entityId: row.id,
      beforeData: today,
      afterData: row,
    });

    await emitErpEvent(tx, 'erp:attendance', 'clock_out', {
      attendance_id: row.id,
      employee_id: auth.employee.id,
      employee_name: auth.employee.full_name,
      overtime_minutes: overtimeMinutes,
    });

    return row;
  });

  return c.json({ record: jsonSafe(updated) });
});

router.post('/leave', requirePermission('attendance', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = leaveRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const data = parsed.data;
  const db = getDb();

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(attendances)
      .values({
        employee_id: auth.employee.id,
        attendance_date: data.attendance_date,
        status: data.status,
        note: data.note,
        approval_status: 'pending',
      })
      .returning();

    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'attendance',
      action: 'request_leave',
      entityId: row.id,
      afterData: row,
    });

    await emitErpEvent(tx, 'erp:attendance', 'leave_requested', {
      attendance_id: row.id,
      employee_id: auth.employee.id,
      employee_name: auth.employee.full_name,
      attendance_date: data.attendance_date,
      status: data.status,
    });

    return row;
  });

  return c.json({ record: jsonSafe(created) }, 201);
});

router.post('/:id/approve', requirePermission('attendance', 'approve'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing attendance id.' }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = approveAttendanceSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const db = getDb();

  const [before] = await db.select().from(attendances).where(eq(attendances.id, id)).limit(1);
  if (!before) return c.json({ error: 'Attendance record not found.' }, 404);

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(attendances)
      .set({
        approval_status: parsed.data.decision,
        approved_by: auth.employee.id,
        note: parsed.data.note ?? before.note,
      })
      .where(eq(attendances.id, id))
      .returning();

    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'attendance',
      action: 'approve_attendance',
      entityId: id,
      beforeData: before,
      afterData: row,
    });

    await emitErpEvent(tx, 'erp:attendance', 'attendance_approval_updated', {
      attendance_id: row.id,
      employee_id: row.employee_id,
      approval_status: row.approval_status,
    });

    return row;
  });

  return c.json({ record: jsonSafe(updated) });
});

export const attendancePlugin: ErpModulePlugin = {
  id: 'attendance',
  basePath: '/attendance',
  router,
};
