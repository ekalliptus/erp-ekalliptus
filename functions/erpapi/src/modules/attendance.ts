import {
  approveAttendanceSchema,
  clockInSchema,
  clockOutSchema,
  createOfficeSchema,
  faceEnrollSchema,
  faceVerifySchema,
  leaveRequestSchema,
  updateOfficeSchema,
} from '@ekalliptus/contracts';
import { attendances, employees, office_locations } from '@ekalliptus/db';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, jsonSafe } from '../db.js';
import { emitErpEvent, writeAuditLog } from '../middleware/audit.js';
import { requirePermission } from '../middleware/rbac.js';
import {
  compareFaceDescriptors,
  getEnrolledModels,
  getModelTemplates,
  getStoredSampleCount,
  MOBILE_FACE_COSINE_THRESHOLD,
  parseStoredDescriptors,
  validateAndPrepareVector,
  WEB_FACE_DISTANCE_THRESHOLD,
  type FaceModel,
  type StoredFaceDescriptors,
} from '../services/face.js';
import { notifyUsersInTx, resolveModuleApprovers } from '../services/notify.js';
import { clientIp } from '../services/rate-limit.js';
import { createPresignedDownloadUrl, downloadObjectBytes } from '../services/storage.js';
import type { AppEnv } from '../types.js';
import type { ErpModulePlugin } from './plugin.js';

function resolveAttendanceIp(reqIp: string, localIp?: string | null): string | null {
  if (reqIp !== 'unknown') return reqIp;
  const trimmed = localIp?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

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

router.patch('/offices/:id', requirePermission('attendance', 'update'), async (c) => {
  const auth = c.get('auth');
  if (auth.roleCode !== 'owner') {
    return c.json({ error: 'Forbidden: hanya role Owner yang dapat mengubah lokasi kantor.' }, 403);
  }
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing office id.' }, 400);

  const body = await c.req.json().catch(() => null);
  const parsed = updateOfficeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  if (Object.keys(parsed.data).length === 0) {
    return c.json({ error: 'Tidak ada perubahan data kantor.' }, 400);
  }

  const db = getDb();
  const [before] = await db.select().from(office_locations).where(eq(office_locations.id, id)).limit(1);
  if (!before) return c.json({ error: 'Office location not found.' }, 404);

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(office_locations)
      .set(parsed.data)
      .where(eq(office_locations.id, id))
      .returning();

    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'attendance',
      action: 'update_office_location',
      entityId: row.id,
      beforeData: before,
      afterData: row,
    });

    await emitErpEvent(tx, 'erp:attendance', 'office_updated', {
      office_id: row.id,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      radius_meters: row.radius_meters,
    });

    return row;
  });

  return c.json({ office: jsonSafe(updated) });
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
      clock_out_lat: attendances.clock_out_lat,
      clock_out_lng: attendances.clock_out_lng,
      clock_in_selfie_key: attendances.clock_in_selfie_key,
      clock_out_selfie_key: attendances.clock_out_selfie_key,
      clock_in_method: attendances.clock_in_method,
      clock_out_method: attendances.clock_out_method,
      clock_in_ip: attendances.clock_in_ip,
      clock_out_ip: attendances.clock_out_ip,
      clock_in_device: attendances.clock_in_device,
      clock_out_device: attendances.clock_out_device,
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

type FaceVerificationGuardResult =
  | { ok: true; similarityPercent: number }
  | { ok: false; status: 400 | 403; body: Record<string, unknown> };

async function verifyAttendanceFaceScan(params: {
  db: ReturnType<typeof getDb>;
  auth: AppEnv['Variables']['auth'];
  action: 'clock_in_face_mismatch' | 'clock_out_face_mismatch';
  selfieObjectKey?: string | null;
  faceModel?: FaceModel | null;
  faceDescriptor?: number[] | null;
}): Promise<FaceVerificationGuardResult> {
  if (!params.selfieObjectKey || !params.faceModel || !params.faceDescriptor) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Verifikasi scan wajah kamera langsung wajib dilakukan untuk absensi.' },
    };
  }
  const probe = validateAndPrepareVector(params.faceModel, params.faceDescriptor);
  if (!probe) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Data descriptor wajah tidak valid.' },
    };
  }
  const [empRow] = await params.db
    .select({
      face_descriptors: employees.face_descriptors,
    })
    .from(employees)
    .where(eq(employees.id, params.auth.employee.id))
    .limit(1);

  const stored = parseStoredDescriptors(empRow?.face_descriptors);
  const templates = getModelTemplates(stored, params.faceModel);
  if (templates.length === 0) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Wajah Anda belum terdaftar. Daftarkan wajah terlebih dahulu sebelum absensi.' },
    };
  }

  const comparison = compareFaceDescriptors(params.faceModel, templates, probe);
  if (!comparison.matched) {
    await writeAuditLog(params.db, {
      actorId: params.auth.employee.id,
      platform: params.auth.platform,
      module: 'attendance',
      action: params.action,
      entityId: params.auth.employee.id,
      afterData: {
        face_model: params.faceModel,
        similarity_percent: comparison.similarityPercent,
        distance: Number(comparison.distance.toFixed(4)),
        selfie_object_key: params.selfieObjectKey,
      },
    });
    return {
      ok: false,
      status: 403,
      body: {
        error: `Wajah tidak cocok dengan data karyawan terdaftar (kemiripan ${comparison.similarityPercent}%). Absensi ditolak.`,
        similarity_percent: comparison.similarityPercent,
        face_mismatch: true,
      },
    };
  }

  return { ok: true, similarityPercent: comparison.similarityPercent };
}

router.get('/face-status', requirePermission('attendance', 'view'), async (c) => {
  const auth = c.get('auth');
  const [empRow] = await getDb()
    .select({
      face_descriptors: employees.face_descriptors,
      face_reference_selfie_key: employees.face_reference_selfie_key,
      face_enrolled_at: employees.face_enrolled_at,
    })
    .from(employees)
    .where(eq(employees.id, auth.employee.id))
    .limit(1);

  const stored = parseStoredDescriptors(empRow?.face_descriptors);
  const models = getEnrolledModels(stored);
  const hasReferencePhoto = Boolean(empRow?.face_reference_selfie_key);
  const sampleCount = getStoredSampleCount(stored);
  const poses = stored.meta?.poses ?? [];
  const enrolled = models.length > 0 || Boolean(empRow?.face_enrolled_at);

  let referencePhotoUrl: string | null = null;
  if (empRow?.face_reference_selfie_key) {
    try {
      referencePhotoUrl = await createPresignedDownloadUrl({
        key: empRow.face_reference_selfie_key,
        expiresIn: 3600,
      });
    } catch {
      referencePhotoUrl = null;
    }
  }

  const mobileTemplates = getModelTemplates(stored, 'mobile_facenet_192d');
  const includeMobile =
    auth.platform === 'flutter' &&
    c.req.query('include_mobile_descriptor') === '1' &&
    Boolean(stored.mobile_facenet_192d);

  return c.json({
    enrolled,
    enrolled_at: empRow?.face_enrolled_at ? empRow.face_enrolled_at.toISOString() : null,
    models,
    has_reference_photo: hasReferencePhoto,
    reference_photo_url: referencePhotoUrl,
    sample_count: sampleCount,
    poses,
    is_multi_pose: sampleCount >= 3,
    ...(includeMobile
      ? {
          mobile_descriptor: stored.mobile_facenet_192d,
          mobile_descriptors: mobileTemplates,
        }
      : {}),
  });
});

router.get('/face-reference-image', requirePermission('attendance', 'view'), async (c) => {
  const auth = c.get('auth');
  const [empRow] = await getDb()
    .select({ face_reference_selfie_key: employees.face_reference_selfie_key })
    .from(employees)
    .where(eq(employees.id, auth.employee.id))
    .limit(1);

  if (!empRow?.face_reference_selfie_key) {
    return c.json({ error: 'Foto referensi wajah belum tersedia.' }, 404);
  }
  const bytes = await downloadObjectBytes(empRow.face_reference_selfie_key);
  const contentType = empRow.face_reference_selfie_key.toLowerCase().endsWith('.png')
    ? 'image/png'
    : 'image/jpeg';
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=300',
    },
  });
});

router.post('/face-enroll', requirePermission('attendance', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = faceEnrollSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const data = parsed.data;
  const prepared = validateAndPrepareVector(data.face_model, data.face_descriptor);
  if (!prepared) {
    return c.json({ error: 'Panjang atau format descriptor wajah tidak valid.' }, 400);
  }

  const validSamples: number[][] = [];
  if (Array.isArray(data.face_samples)) {
    for (const rawSample of data.face_samples) {
      const clean = validateAndPrepareVector(data.face_model, rawSample);
      if (clean) validSamples.push(clean);
    }
  }

  const db = getDb();
  const [empRow] = await db
    .select({
      face_descriptors: employees.face_descriptors,
      face_reference_selfie_key: employees.face_reference_selfie_key,
      face_enrolled_at: employees.face_enrolled_at,
    })
    .from(employees)
    .where(eq(employees.id, auth.employee.id))
    .limit(1);

  if (!empRow) return c.json({ error: 'Karyawan tidak ditemukan.' }, 404);

  const stored = parseStoredDescriptors(empRow.face_descriptors);
  const enrolledModels = getEnrolledModels(stored);
  const replace = data.replace === true;

  if (!replace) {
    if (stored[data.face_model]) {
      return c.json(
        {
          error:
            'Wajah Anda sudah terdaftar. Perbarui data wajah melalui halaman Profil atau hubungi Owner/HR.',
        },
        409,
      );
    }
    if (
      enrolledModels.length > 0 &&
      (!data.derived_from_reference || !empRow.face_reference_selfie_key)
    ) {
      return c.json(
        {
          error:
            'Wajah Anda sudah terdaftar pada perangkat lain. Sinkronkan dari foto referensi atau perbarui melalui halaman Profil.',
        },
        409,
      );
    }
  }

  const now = new Date();
  const isBridging = !replace && enrolledModels.length > 0;
  const samplesKey =
    data.face_model === 'web_faceapi_128d'
      ? 'web_faceapi_128d_samples'
      : 'mobile_facenet_192d_samples';
  const poses =
    data.enrollment_poses && data.enrollment_poses.length > 0
      ? data.enrollment_poses
      : stored.meta?.poses ?? [];
  const sampleCount =
    validSamples.length > 0
      ? validSamples.length
      : isBridging
        ? getStoredSampleCount(stored)
        : 1;

  const nextStored: StoredFaceDescriptors = replace
    ? {
        [data.face_model]: prepared,
        ...(validSamples.length > 0 ? { [samplesKey]: validSamples } : {}),
        meta: {
          poses: data.enrollment_poses ?? [],
          sample_count: validSamples.length || 1,
          updated_at: now.toISOString(),
          platform: auth.platform,
        },
      }
    : {
        ...stored,
        [data.face_model]: prepared,
        ...(validSamples.length > 0 ? { [samplesKey]: validSamples } : {}),
        meta: {
          ...(stored.meta ?? {}),
          ...(poses.length > 0 ? { poses } : {}),
          sample_count: sampleCount,
          updated_at: now.toISOString(),
          platform: stored.meta?.platform ?? auth.platform,
        },
      };

  const enrolledAt = replace ? now : empRow.face_enrolled_at ?? now;
  const referenceKey =
    isBridging && empRow.face_reference_selfie_key
      ? empRow.face_reference_selfie_key
      : data.selfie_object_key;
  const auditAction = replace
    ? 'update_own_face'
    : isBridging
      ? 'bridge_face_descriptor'
      : 'enroll_face';

  await db.transaction(async (tx) => {
    await tx
      .update(employees)
      .set({
        face_descriptors: nextStored,
        face_reference_selfie_key: referenceKey,
        face_enrolled_at: enrolledAt,
      })
      .where(eq(employees.id, auth.employee.id));

    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'attendance',
      action: auditAction,
      entityId: auth.employee.id,
      afterData: {
        face_model: data.face_model,
        reference_selfie_key: referenceKey,
        models: getEnrolledModels(nextStored),
        sample_count: getStoredSampleCount(nextStored),
        poses: nextStored.meta?.poses ?? [],
      },
    });
  });

  const finalSampleCount = getStoredSampleCount(nextStored);
  return c.json(
    {
      enrolled: true,
      enrolled_at: enrolledAt.toISOString(),
      models: getEnrolledModels(nextStored),
      sample_count: finalSampleCount,
      poses: nextStored.meta?.poses ?? [],
      is_multi_pose: finalSampleCount >= 3,
    },
    replace ? 200 : 201,
  );
});

router.delete('/face-enroll', async (c) => {
  const auth = c.get('auth');
  const db = getDb();

  await db.transaction(async (tx) => {
    await tx
      .update(employees)
      .set({
        face_descriptors: null,
        face_reference_selfie_key: null,
        face_enrolled_at: null,
      })
      .where(eq(employees.id, auth.employee.id));

    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'attendance',
      action: 'delete_own_face',
      entityId: auth.employee.id,
      afterData: { enrolled: false },
    });
  });

  return c.json({ ok: true, enrolled: false });
});

router.post('/face-verify', requirePermission('attendance', 'view'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = faceVerifySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const probe = validateAndPrepareVector(parsed.data.face_model, parsed.data.face_descriptor);
  if (!probe) {
    return c.json({ error: 'Data descriptor wajah tidak valid.' }, 400);
  }

  const [empRow] = await getDb()
    .select({ face_descriptors: employees.face_descriptors })
    .from(employees)
    .where(eq(employees.id, auth.employee.id))
    .limit(1);

  const stored = parseStoredDescriptors(empRow?.face_descriptors);
  const templates = getModelTemplates(stored, parsed.data.face_model);
  const enrolledModels = getEnrolledModels(stored);
  const defaultThreshold =
    parsed.data.face_model === 'web_faceapi_128d'
      ? WEB_FACE_DISTANCE_THRESHOLD
      : MOBILE_FACE_COSINE_THRESHOLD;

  if (templates.length === 0) {
    return c.json({
      enrolled: enrolledModels.length > 0,
      model_enrolled: false,
      matched: false,
      similarity_percent: 0,
      distance: 99,
      threshold: defaultThreshold,
    });
  }

  const res = compareFaceDescriptors(parsed.data.face_model, templates, probe);
  return c.json({
    enrolled: true,
    model_enrolled: true,
    matched: res.matched,
    similarity_percent: res.similarityPercent,
    distance: Number(res.distance.toFixed(4)),
    threshold: res.threshold,
  });
});

router.post('/clock-in', requirePermission('attendance', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = clockInSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const data = parsed.data;
  const db = getDb();

  if (!data.selfie_object_key && !data.qr_token && data.biometric_verified !== true) {
    return c.json(
      { error: 'Verifikasi biometrik, scan wajah, atau QR kantor diperlukan untuk clock-in.' },
      400,
    );
  }
  if (data.device_info?.is_mocked_gps === true) {
    return c.json(
      { error: 'Lokasi palsu (Mock GPS) terdeteksi. Nonaktifkan Fake GPS untuk absensi.' },
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
  const rawAccuracy = Number(data.device_info?.gps_accuracy_meters ?? 0);
  const accuracyBuffer = Number.isFinite(rawAccuracy) && rawAccuracy > 0 ? Math.min(rawAccuracy, 50) : 0;
  const effectiveDistance = Math.max(0, distance - accuracyBuffer);
  if (effectiveDistance > office.radius_meters) {
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

  let verifiedFaceSimilarity: number | null = null;
  if (data.biometric_verified !== true && !data.qr_token) {
    const faceGuard = await verifyAttendanceFaceScan({
      db,
      auth,
      action: 'clock_in_face_mismatch',
      selfieObjectKey: data.selfie_object_key,
      faceModel: data.face_model,
      faceDescriptor: data.face_descriptor,
    });
    if (!faceGuard.ok) {
      return c.json(faceGuard.body, faceGuard.status);
    }
    verifiedFaceSimilarity = faceGuard.similarityPercent;
  }

  const clockInMethod =
    data.biometric_verified === true
      ? (data.verification_method === 'face_scan' ? 'face_scan' : 'biometric')
      : data.qr_token
        ? 'qr'
        : 'face_scan';
  const resolvedIp = resolveAttendanceIp(clientIp(c), data.device_info?.local_ip);
  const storedClockInDevice = data.device_info || verifiedFaceSimilarity !== null
    ? {
        ...(data.device_info ?? {}),
        ...(verifiedFaceSimilarity !== null
          ? { face_similarity_percent: verifiedFaceSimilarity }
          : {}),
      }
    : null;

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
        clock_in_method: clockInMethod,
        clock_in_ip: resolvedIp,
        clock_in_device: storedClockInDevice,
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
      afterData: { ...inserted, distance_meters: Math.round(distance), ip: resolvedIp },
    });

    await emitErpEvent(tx, 'erp:attendance', 'clock_in', {
      attendance_id: inserted.id,
      employee_id: auth.employee.id,
      employee_name: auth.employee.full_name,
      status,
      late_minutes: lateMinutes,
    });

    const attendanceViewers = await resolveModuleApprovers(tx, 'attendance');
    await notifyUsersInTx(tx, {
      module: 'attendance',
      eventType: 'clock_in',
      title: 'Absensi masuk tercatat',
      body: `${auth.employee.full_name} clock-in${status === 'late' ? ` terlambat ${lateMinutes} menit` : ''}.`,
      recipients: attendanceViewers,
      excludeAuthUserId: auth.authUserId,
      actorEmployeeId: auth.employee.id,
      entityId: inserted.id,
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
  if (data.device_info?.is_mocked_gps === true) {
    return c.json(
      { error: 'Lokasi palsu (Mock GPS) terdeteksi. Nonaktifkan Fake GPS untuk absensi.' },
      400,
    );
  }
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

  if (data.biometric_verified !== true && !data.qr_token && !data.selfie_object_key) {
    return c.json(
      { error: 'Verifikasi scan wajah, biometrik, atau QR kantor diperlukan untuk absen pulang.' },
      400,
    );
  }

  let verifiedOutSimilarity: number | null = null;
  if (data.biometric_verified !== true && !data.qr_token) {
    const faceGuard = await verifyAttendanceFaceScan({
      db,
      auth,
      action: 'clock_out_face_mismatch',
      selfieObjectKey: data.selfie_object_key,
      faceModel: data.face_model,
      faceDescriptor: data.face_descriptor,
    });
    if (!faceGuard.ok) {
      return c.json(faceGuard.body, faceGuard.status);
    }
    verifiedOutSimilarity = faceGuard.similarityPercent;
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
  const clockOutMethod =
    data.biometric_verified === true
      ? (data.verification_method === 'face_scan' ? 'face_scan' : 'biometric')
      : data.qr_token
        ? 'qr'
        : 'face_scan';
  const resolvedOutIp = resolveAttendanceIp(clientIp(c), data.device_info?.local_ip);
  const storedClockOutDevice = data.device_info || verifiedOutSimilarity !== null
    ? {
        ...(data.device_info ?? {}),
        ...(verifiedOutSimilarity !== null
          ? { face_similarity_percent: verifiedOutSimilarity }
          : {}),
      }
    : null;

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(attendances)
      .set({
        clock_out_at: now,
        clock_out_lat: data.latitude ?? null,
        clock_out_lng: data.longitude ?? null,
        clock_out_selfie_key: data.selfie_object_key ?? null,
        clock_out_method: clockOutMethod,
        clock_out_ip: resolvedOutIp,
        clock_out_device: storedClockOutDevice,
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
      afterData: { ...row, ip: resolvedOutIp },
    });

    await emitErpEvent(tx, 'erp:attendance', 'clock_out', {
      attendance_id: row.id,
      employee_id: auth.employee.id,
      employee_name: auth.employee.full_name,
      overtime_minutes: overtimeMinutes,
    });

    const attendanceViewers = await resolveModuleApprovers(tx, 'attendance');
    await notifyUsersInTx(tx, {
      module: 'attendance',
      eventType: 'clock_out',
      title: 'Absensi pulang tercatat',
      body: `${auth.employee.full_name} clock-out${overtimeMinutes > 0 ? ` (lembur ${overtimeMinutes} menit)` : ''}.`,
      recipients: attendanceViewers,
      excludeAuthUserId: auth.authUserId,
      actorEmployeeId: auth.employee.id,
      entityId: row.id,
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

    const attendanceViewers = await resolveModuleApprovers(tx, 'attendance');
    await notifyUsersInTx(tx, {
      module: 'attendance',
      eventType: 'leave_requested',
      title: 'Pengajuan izin baru',
      body: `${auth.employee.full_name} mengajukan izin untuk ${data.attendance_date}.`,
      recipients: attendanceViewers,
      excludeAuthUserId: auth.authUserId,
      actorEmployeeId: auth.employee.id,
      entityId: row.id,
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

    const [owner] = await tx
      .select({ auth_user_id: employees.auth_user_id })
      .from(employees)
      .where(eq(employees.id, row.employee_id))
      .limit(1);
    if (owner?.auth_user_id) {
      await notifyUsersInTx(tx, {
        module: 'attendance',
        eventType: 'attendance_approval_updated',
        title: row.approval_status === 'approved' ? 'Izin Anda disetujui' : 'Izin Anda ditolak',
        body: `Pengajuan izin ${row.attendance_date} telah di-${row.approval_status === 'approved' ? 'setujui' : 'tolak'} oleh ${auth.employee.full_name}.`,
        recipients: [owner.auth_user_id],
        excludeAuthUserId: auth.authUserId,
        actorEmployeeId: auth.employee.id,
        entityId: row.id,
      });
    }

    return row;
  });

  return c.json({ record: jsonSafe(updated) });
});

export const attendancePlugin: ErpModulePlugin = {
  id: 'attendance',
  basePath: '/attendance',
  router,
};
