import { hasPermission } from '@ekalliptus/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Crosshair,
  Laptop,
  LogOut,
  MapPin,
  Pencil,
  Plus,
  ScanFace,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../components/DataTable.tsx';
import {
  FaceVerificationModal,
  type VerifiedFaceResult,
} from '../components/FaceVerificationModal.tsx';
import { OfficeMapPicker } from '../components/OfficeMapPicker.tsx';
import { TableSkeleton } from '../components/Skeleton.tsx';
import { SlideOver } from '../components/SlideOver.tsx';
import { EmptyState, ErrorState } from '../components/StateViews.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import {
  erpApi,
  type AttendanceDeviceInfo,
  type AttendanceRecord,
  type MeResponse,
  type OfficeLocation,
} from '../lib/api.ts';
import { formatDateId, formatDateTimeId } from '../lib/format.ts';

type AttendanceTab = 'records' | 'offices';

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistanceId(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function todayJakartaDateStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

function formatJakartaClockDots(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(/:/g, '.');
}

function formatJakartaDateFull(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function LiveAttendanceClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      aria-label="Jam waktu nyata"
      className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 rounded-lg border border-border bg-surface-subtle px-3 py-2"
    >
      <span className="font-mono text-2xl font-bold tracking-tight text-text-primary tabular-nums sm:text-[28px]">
        {formatJakartaClockDots(now)}
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">
        WIB
      </span>
      <span className="text-xs font-medium text-text-secondary">
        {formatJakartaDateFull(now)}
      </span>
    </div>
  );
}

function collectBrowserDeviceInfo(
  gpsAccuracyMeters?: number | null,
  biometricType?: string | null,
  faceSimilarityPercent?: number | null,
): AttendanceDeviceInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const brand = ua.includes('Edg/')
    ? 'Edge'
    : ua.includes('Chrome/') && !ua.includes('Edg/')
      ? 'Chrome'
      : ua.includes('Firefox/')
        ? 'Firefox'
        : ua.includes('Safari/') && !ua.includes('Chrome/')
          ? 'Safari'
          : 'Web Browser';
  const os = ua.includes('Windows')
    ? 'Windows'
    : ua.includes('Android')
      ? 'Android'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'iOS'
        : ua.includes('Mac OS X')
          ? 'macOS'
          : ua.includes('Linux')
            ? 'Linux'
            : 'Web OS';
  const isMobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  return {
    brand,
    model: isMobileUa ? 'Mobile Web' : 'Desktop Web',
    manufacturer: 'Web',
    os_version: os,
    platform: 'web',
    is_physical_device: true,
    gps_accuracy_meters:
      typeof gpsAccuracyMeters === 'number' && Number.isFinite(gpsAccuracyMeters)
        ? Math.round(gpsAccuracyMeters * 10) / 10
        : null,
    is_mocked_gps: false,
    biometric_type: biometricType ?? null,
    face_similarity_percent: faceSimilarityPercent ?? null,
  };
}

function acquireBrowserGps(): Promise<{ latitude: number; longitude: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(
        new Error('Browser ini tidak mendukung Geolocation API. Buka Opsi Manual / QR untuk mengisi koordinat.'),
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED
            ? 'Izin lokasi GPS browser ditolak. Aktifkan izin lokasi atau isi koordinat lewat Opsi Manual / QR.'
            : err.code === err.TIMEOUT
              ? 'Pembacaan GPS browser timeout (12 detik). Pastikan lokasi perangkat aktif atau gunakan Opsi Manual / QR.'
              : `Gagal mengambil GPS browser: ${err.message}`;
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}

export function AttendancePage({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const canView = hasPermission(me.permissions, 'attendance', 'view');
  const canCreate = hasPermission(me.permissions, 'attendance', 'create');
  const canApprove = hasPermission(me.permissions, 'attendance', 'approve');
  const isOwner = me.role === 'owner';
  const isHrOrOwner = me.role === 'owner' || me.role === 'hr';

  const [tab, setTab] = useState<AttendanceTab>('records');
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );

  // Clock-in & unified 1-click telemetry state
  const [officeId, setOfficeId] = useState('');
  const [latInput, setLatInput] = useState('');
  const [lngInput, setLngInput] = useState('');
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [qrToken, setQrToken] = useState('');
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const [showManualOptions, setShowManualOptions] = useState(false);
  const [verifyModalMode, setVerifyModalMode] = useState<
    'closed' | 'clock_in' | 'clock_out' | 'enroll'
  >('closed');
  const [verifyModalError, setVerifyModalError] = useState<string | null>(null);
  const [pendingCoords, setPendingCoords] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number | null;
  } | null>(null);

  // SlideOvers
  const [leaveDrawerOpen, setLeaveDrawerOpen] = useState(false);
  const [officeModalMode, setOfficeModalMode] = useState<'closed' | 'create' | 'edit'>('closed');
  const [editingOfficeId, setEditingOfficeId] = useState<string | null>(null);

  // Leave form
  const [leaveDate, setLeaveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [leaveStatus, setLeaveStatus] = useState<'leave' | 'sick'>('leave');
  const [leaveNote, setLeaveNote] = useState('');

  // Office form
  const [offName, setOffName] = useState('');
  const [offLat, setOffLat] = useState('-6.8694');
  const [offLng, setOffLng] = useState('109.1402');
  const [offRadius, setOffRadius] = useState('250');
  const [offStart, setOffStart] = useState('09:00');
  const [offEnd, setOffEnd] = useState('17:00');

  const officesQuery = useQuery({
    queryKey: ['attendance', 'offices'],
    queryFn: erpApi.attendance.offices,
    enabled: canView,
  });

  const recordsQuery = useQuery({
    queryKey: ['attendance', 'records'],
    queryFn: erpApi.attendance.records,
    enabled: canView,
  });

  const faceStatusQuery = useQuery({
    queryKey: ['attendance', 'face-status'],
    queryFn: erpApi.attendance.faceStatus,
    enabled: canCreate,
  });

  const invalidateAtt = async () => {
    await queryClient.invalidateQueries({ queryKey: ['attendance'] });
    await queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  const clockInMut = useMutation({
    mutationFn: erpApi.attendance.clockIn,
    onSuccess: async (res) => {
      await invalidateAtt();
      setQrToken('');
      setFeedback({
        kind: 'success',
        text: `Clock-in berhasil tercatat (${formatDistanceId(res.distance_meters)} dari titik kantor).`,
      });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const clockOutMut = useMutation({
    mutationFn: erpApi.attendance.clockOut,
    onSuccess: async () => {
      await invalidateAtt();
      setQrToken('');
      setFeedback({ kind: 'success', text: 'Clock-out berhasil dicatat.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const leaveMut = useMutation({
    mutationFn: erpApi.attendance.requestLeave,
    onSuccess: async () => {
      await invalidateAtt();
      setLeaveDrawerOpen(false);
      setLeaveNote('');
      setFeedback({ kind: 'success', text: 'Pengajuan cuti/sakit berhasil dikirim.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const approveMut = useMutation({
    mutationFn: (vars: { id: string; decision: 'approved' | 'rejected' }) =>
      erpApi.attendance.approveAttendance(vars.id, vars.decision),
    onSuccess: async () => {
      await invalidateAtt();
      setFeedback({ kind: 'success', text: 'Status pengajuan absensi diperbarui.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const createOfficeMut = useMutation({
    mutationFn: erpApi.attendance.createOffice,
    onSuccess: async () => {
      await invalidateAtt();
      setOfficeModalMode('closed');
      setEditingOfficeId(null);
      setOffName('');
      setFeedback({ kind: 'success', text: 'Lokasi kantor berhasil ditambahkan.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const updateOfficeMut = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Partial<{
        name: string;
        latitude: number;
        longitude: number;
        radius_meters: number;
        work_start_time: string;
        work_end_time: string;
      }>;
    }) => erpApi.attendance.updateOffice(id, body),
    onSuccess: async () => {
      await invalidateAtt();
      setOfficeModalMode('closed');
      setEditingOfficeId(null);
      setFeedback({ kind: 'success', text: 'Posisi & radius kantor berhasil diperbarui.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  function openCreateOffice() {
    setOfficeModalMode('create');
    setEditingOfficeId(null);
    setOffName('');
    setOffLat('-6.8694');
    setOffLng('109.1402');
    setOffRadius('250');
    setOffStart('09:00');
    setOffEnd('17:00');
  }

  function openEditOffice(office: OfficeLocation) {
    setOfficeModalMode('edit');
    setEditingOfficeId(office.id);
    setOffName(office.name);
    setOffLat(String(office.latitude));
    setOffLng(String(office.longitude));
    setOffRadius(String(office.radius_meters));
    setOffStart(office.work_start_time);
    setOffEnd(office.work_end_time);
  }

  function captureOfficeBrowserGps() {
    if (!navigator.geolocation) {
      setFeedback({ kind: 'error', text: 'Browser tidak mendukung Geolocation API.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOffLat(pos.coords.latitude.toFixed(6));
        setOffLng(pos.coords.longitude.toFixed(6));
      },
      (err) => {
        setFeedback({ kind: 'error', text: `Gagal mengambil GPS browser: ${err.message}` });
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const offices = officesQuery.data?.offices ?? [];
  const records = recordsQuery.data?.records ?? [];
  const selectedOffice = offices.find((o) => o.id === officeId) ?? offices[0] ?? null;

  const todayDateStr = todayJakartaDateStr();
  const todayRecord = useMemo(
    () =>
      records.find(
        (r) => r.employee_id === me.employee.id && r.attendance_date === todayDateStr,
      ) ?? null,
    [records, me.employee.id, todayDateStr],
  );
  const hasClockedIn = Boolean(todayRecord?.clock_in_at);
  const hasClockedOut = Boolean(todayRecord?.clock_out_at);
  const browserPreviewDevice = useMemo(() => collectBrowserDeviceInfo(gpsAccuracy), [gpsAccuracy]);

  const estimatedDistance = useMemo(() => {
    if (!selectedOffice) return null;
    const lat = Number(latInput);
    const lng = Number(lngInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !latInput || !lngInput) return null;
    return Math.round(haversineMeters(lat, lng, selectedOffice.latitude, selectedOffice.longitude));
  }, [selectedOffice, latInput, lngInput]);

  function closeVerifyModal() {
    setVerifyModalMode('closed');
    setVerifyModalError(null);
  }

  function handleStartEnrollFace() {
    if (busyStage || clockInMut.isPending || clockOutMut.isPending) return;
    setFeedback(null);
    setVerifyModalError(null);
    setVerifyModalMode('enroll');
  }

  async function captureBrowserGps() {
    setBusyStage('Membaca GPS perangkat...');
    try {
      const pos = await acquireBrowserGps();
      setLatInput(pos.latitude.toFixed(6));
      setLngInput(pos.longitude.toFixed(6));
      setGpsAccuracy(pos.accuracy);
      setFeedback({
        kind: 'success',
        text: `Koordinat GPS diambil (akurasi ${Math.round(pos.accuracy)}m).`,
      });
    } catch (err) {
      setShowManualOptions(true);
      setFeedback({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusyStage(null);
    }
  }

  async function submitClockInWithPayload(params: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    selfie_object_key?: string | null;
    qr_token?: string | null;
    verification_method: 'face_scan' | 'qr' | 'selfie';
    biometric_type: string;
    face_model?: 'web_faceapi_128d';
    face_descriptor?: number[];
    face_similarity_percent?: number | null;
  }) {
    if (!selectedOffice) return;
    await clockInMut.mutateAsync({
      office_id: selectedOffice.id,
      latitude: params.latitude,
      longitude: params.longitude,
      selfie_object_key: params.selfie_object_key ?? null,
      qr_token: params.qr_token ?? null,
      verification_method: params.verification_method,
      face_model: params.face_model,
      face_descriptor: params.face_descriptor,
      device_info: collectBrowserDeviceInfo(
        params.accuracy,
        params.biometric_type,
        params.face_similarity_percent,
      ),
    });
  }

  async function handleOneClickClockIn() {
    if (!selectedOffice || busyStage || clockInMut.isPending) return;
    setFeedback(null);
    setVerifyModalError(null);

    let lat = Number(latInput);
    let lng = Number(lngInput);
    let acc = gpsAccuracy;

    if (!latInput || !lngInput || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      setBusyStage('Membaca lokasi GPS browser...');
      try {
        const pos = await acquireBrowserGps();
        lat = pos.latitude;
        lng = pos.longitude;
        acc = pos.accuracy;
        setLatInput(lat.toFixed(6));
        setLngInput(lng.toFixed(6));
        setGpsAccuracy(acc);
      } catch (err) {
        setBusyStage(null);
        setShowManualOptions(true);
        setFeedback({ kind: 'error', text: (err as Error).message });
        return;
      }
      setBusyStage(null);
    }

    const trimmedQr = qrToken.trim();
    if (trimmedQr) {
      setBusyStage('Mengirim presensi masuk...');
      try {
        await submitClockInWithPayload({
          latitude: lat,
          longitude: lng,
          accuracy: acc,
          qr_token: trimmedQr,
          verification_method: 'qr',
          biometric_type: 'web_qr',
        });
      } finally {
        setBusyStage(null);
      }
      return;
    }

    setPendingCoords({ latitude: lat, longitude: lng, accuracy: acc });
    setVerifyModalMode('clock_in');
  }

  async function handleVerifiedFaceSubmit(result: VerifiedFaceResult) {
    setVerifyModalError(null);
    if (verifyModalMode === 'clock_out') {
      setBusyStage('Mencatat Clock-Out...');
      try {
        await clockOutMut.mutateAsync({
          latitude: pendingCoords?.latitude,
          longitude: pendingCoords?.longitude,
          selfie_object_key: result.selfieKey,
          verification_method: 'face_scan',
          face_model: result.model,
          face_descriptor: result.descriptor,
          device_info: collectBrowserDeviceInfo(
            pendingCoords?.accuracy ?? gpsAccuracy,
            'web_face_scan',
            result.similarityPercent ?? null,
          ),
        });
        await queryClient.invalidateQueries({ queryKey: ['attendance', 'face-status'] });
        closeVerifyModal();
      } finally {
        setBusyStage(null);
      }
      return;
    }

    if (!pendingCoords) {
      throw new Error('Koordinat GPS belum tersedia. Silakan ulangi absensi.');
    }

    setBusyStage('Mencatat Clock-In...');
    try {
      await submitClockInWithPayload({
        latitude: pendingCoords.latitude,
        longitude: pendingCoords.longitude,
        accuracy: pendingCoords.accuracy,
        selfie_object_key: result.selfieKey,
        verification_method: 'face_scan',
        face_model: result.model,
        face_descriptor: result.descriptor,
        face_similarity_percent: result.similarityPercent ?? null,
        biometric_type: 'web_face_scan',
      });
      await queryClient.invalidateQueries({ queryKey: ['attendance', 'face-status'] });
      closeVerifyModal();
    } finally {
      setBusyStage(null);
    }
  }

  async function handleModalQrSubmit(tokenInput: string) {
    const trimmed = tokenInput.trim();
    if (trimmed.length < 3) {
      throw new Error('Masukkan token QR kantor minimal 3 karakter.');
    }
    setVerifyModalError(null);

    if (verifyModalMode === 'clock_out') {
      setBusyStage('Memverifikasi token QR...');
      try {
        await clockOutMut.mutateAsync({
          latitude: pendingCoords?.latitude,
          longitude: pendingCoords?.longitude,
          qr_token: trimmed,
          verification_method: 'qr',
          device_info: collectBrowserDeviceInfo(pendingCoords?.accuracy ?? gpsAccuracy, 'web_qr'),
        });
        closeVerifyModal();
      } finally {
        setBusyStage(null);
      }
      return;
    }

    if (!pendingCoords) {
      throw new Error('Koordinat GPS belum tersedia. Silakan ulangi absensi.');
    }
    setBusyStage('Memverifikasi token QR...');
    try {
      await submitClockInWithPayload({
        latitude: pendingCoords.latitude,
        longitude: pendingCoords.longitude,
        accuracy: pendingCoords.accuracy,
        qr_token: trimmed,
        verification_method: 'qr',
        biometric_type: 'web_qr',
      });
      closeVerifyModal();
    } finally {
      setBusyStage(null);
    }
  }

  async function handleOneClickClockOut() {
    if (busyStage || clockOutMut.isPending) return;
    setFeedback(null);
    setVerifyModalError(null);
    setBusyStage('Membaca GPS perangkat...');

    let lat = latInput && Number.isFinite(Number(latInput)) ? Number(latInput) : undefined;
    let lng = lngInput && Number.isFinite(Number(lngInput)) ? Number(lngInput) : undefined;
    let acc = gpsAccuracy;

    if (lat === undefined || lng === undefined) {
      try {
        const pos = await acquireBrowserGps();
        lat = pos.latitude;
        lng = pos.longitude;
        acc = pos.accuracy;
        setLatInput(lat.toFixed(6));
        setLngInput(lng.toFixed(6));
        setGpsAccuracy(acc);
      } catch {
        // Backend /clock-out mengizinkan absen pulang tanpa GPS jika browser tidak memiliki izin/sensor lokasi.
      }
    }

    const trimmedQr = qrToken.trim();
    if (trimmedQr) {
      setBusyStage('Mengirim Clock-Out...');
      try {
        await clockOutMut.mutateAsync({
          latitude: lat,
          longitude: lng,
          qr_token: trimmedQr,
          verification_method: 'qr',
          device_info: collectBrowserDeviceInfo(acc, 'web_qr'),
        });
      } finally {
        setBusyStage(null);
      }
      return;
    }

    setBusyStage(null);
    setPendingCoords(
      lat !== undefined && lng !== undefined
        ? { latitude: lat, longitude: lng, accuracy: acc }
        : null,
    );
    setVerifyModalMode('clock_out');
  }

  const columns = useMemo<Array<ColumnDef<AttendanceRecord, any>>>(
    () => [
      {
        accessorKey: 'attendance_date',
        header: 'Tanggal',
        cell: ({ row }) => <span>{formatDateId(row.original.attendance_date)}</span>,
      },
      {
        accessorKey: 'employee_name',
        header: 'Karyawan',
        cell: ({ row }) => (
          <div>
            <p className="font-semibold text-text-primary">{row.original.employee_name}</p>
            <p className="text-xs text-text-secondary">{row.original.employee_code}</p>
          </div>
        ),
      },
      {
        accessorKey: 'clock_in_at',
        header: 'Masuk / Keluar',
        cell: ({ row }) => (
          <div className="text-xs tabular-nums">
            <p>In: {row.original.clock_in_at ? formatDateTimeId(row.original.clock_in_at) : '-'}</p>
            <p className="text-text-secondary">
              Out: {row.original.clock_out_at ? formatDateTimeId(row.original.clock_out_at) : '-'}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Kehadiran',
        cell: ({ row }) => {
          const st = row.original.status;
          return (
            <StatusBadge
              tone={
                st === 'present'
                  ? 'success'
                  : st === 'late'
                    ? 'warning'
                    : st === 'absent'
                      ? 'danger'
                      : 'info'
              }
              label={`${st.toUpperCase()}${
                row.original.late_minutes > 0 ? ` (${row.original.late_minutes}m)` : ''
              }`}
            />
          );
        },
      },
      {
        id: 'telemetry',
        header: 'Verifikasi & Perangkat',
        cell: ({ row }) => {
          const rec = row.original;
          const method = rec.clock_in_method;
          const methodLabel =
            method === 'biometric'
              ? 'Biometrik'
              : method === 'face_scan'
                ? 'Scan Wajah'
                : method === 'qr'
                  ? 'QR Kantor'
                  : method === 'selfie'
                    ? 'Selfie'
                    : '-';
          const deviceText = rec.clock_in_device?.model || rec.clock_in_device?.brand || null;
          const ipText = rec.clock_in_ip || rec.clock_in_device?.local_ip || null;
          return (
            <div className="text-xs">
              <p className="font-semibold text-text-primary">{methodLabel}</p>
              <p className="text-text-secondary">
                {deviceText ?? 'Perangkat standar'}
                {ipText ? ` | ${ipText}` : ''}
              </p>
            </div>
          );
        },
      },
      {
        accessorKey: 'approval_status',
        header: 'Approval',
        cell: ({ row }) => {
          const ap = row.original.approval_status;
          return (
            <StatusBadge
              tone={ap === 'approved' ? 'accent' : ap === 'pending' ? 'warning' : 'danger'}
              label={ap.toUpperCase()}
            />
          );
        },
      },
      {
        id: 'actions',
        header: 'Aksi',
        enableSorting: false,
        cell: ({ row }) => {
          if (!canApprove || row.original.approval_status !== 'pending') return '-';
          return (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => approveMut.mutate({ id: row.original.id, decision: 'approved' })}
                className="inline-flex items-center gap-1 rounded border border-border-strong bg-accent-soft px-2 py-1 text-xs font-semibold text-[#115E59] dark:text-[#34D399]"
              >
                <Check className="h-3 w-3" aria-hidden="true" />
                Setujui
              </button>
              <button
                type="button"
                onClick={() => approveMut.mutate({ id: row.original.id, decision: 'rejected' })}
                className="inline-flex items-center gap-1 rounded border border-border-strong bg-danger-soft px-2 py-1 text-xs font-semibold text-[#991B1B] dark:text-[#FCA5A5]"
              >
                <X className="h-3 w-3" aria-hidden="true" />
                Tolak
              </button>
            </div>
          );
        },
      },
    ],
    [canApprove, approveMut],
  );

  if (!canView) {
    return (
      <EmptyState
        title="Akses Modul Absensi Ditolak"
        description="Role Anda tidak memiliki izin attendance:view."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-text-primary">
            Absensi & Geofencing Karyawan
          </h2>
          <p className="text-xs text-text-secondary">
            Clock-in berbasis radius GPS + selfie Object Storage / QR kantor, shift, cuti, dan
            lembur
          </p>
        </div>

        {canCreate ? (
          <button
            type="button"
            onClick={() => setLeaveDrawerOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
          >
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
            Ajukan Cuti / Sakit
          </button>
        ) : null}
      </div>

      {feedback ? (
        <div
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-center justify-between rounded-md border px-3.5 py-2.5 text-xs font-medium ${
            feedback.kind === 'error'
              ? 'border-[#FECACA] bg-danger-soft text-[#991B1B] dark:border-[#7F1D1D] dark:text-[#FCA5A5]'
              : 'border-[#BBF7D0] bg-success-soft text-[#14532D] dark:border-[#14532D] dark:text-[#86EFAC]'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} className="ml-4 underline">
            Tutup
          </button>
        </div>
      ) : null}

      {/* Unified 1-click Clock-in / Clock-out panel */}
      {canCreate && selectedOffice ? (
        <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-accent" aria-hidden="true" />
                <h3 className="font-display text-sm font-bold text-text-primary">
                  Presensi Hari Ini
                </h3>
              </div>
              <LiveAttendanceClock />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                tone={hasClockedOut ? 'success' : hasClockedIn ? 'accent' : 'warning'}
                label={
                  hasClockedOut
                    ? 'Absensi Selesai'
                    : hasClockedIn
                      ? 'Sudah Masuk'
                      : 'Belum Clock-In'
                }
              />
              {estimatedDistance !== null ? (
                <StatusBadge
                  tone={estimatedDistance <= selectedOffice.radius_meters ? 'success' : 'danger'}
                  label={`Jarak ${formatDistanceId(estimatedDistance)} / maks ${selectedOffice.radius_meters}m`}
                />
              ) : null}
              {canCreate && !faceStatusQuery.isLoading && faceStatusQuery.data ? (
                <StatusBadge
                  tone={faceStatusQuery.data.enrolled ? 'accent' : 'warning'}
                  label={faceStatusQuery.data.enrolled ? 'Wajah Terdaftar' : 'Belum Daftar Wajah'}
                />
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3 flex-1 min-w-0">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="att-office" className="block text-xs font-semibold">
                    Lokasi Kantor
                  </label>
                  <select
                    id="att-office"
                    value={selectedOffice.id}
                    onChange={(e) => setOfficeId(e.target.value)}
                    className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
                  >
                    {offices.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} ({o.work_start_time} - {o.work_end_time})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <div className="rounded-md border border-border bg-surface-subtle px-3 py-1.5 text-xs">
                    <span className="text-text-secondary">Shift: </span>
                    <span className="font-semibold text-text-primary tabular-nums">
                      {selectedOffice.work_start_time} - {selectedOffice.work_end_time} WIB
                    </span>
                  </div>
                  <div className="rounded-md border border-border bg-surface-subtle px-3 py-1.5 text-xs">
                    <span className="text-text-secondary">Radius: </span>
                    <span className="font-semibold text-text-primary tabular-nums">
                      {selectedOffice.radius_meters}m
                    </span>
                  </div>
                </div>
              </div>

              {/* Background telemetry strip */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-subtle px-2.5 py-1 text-text-primary">
                  <MapPin className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                  {latInput && lngInput
                    ? `GPS siap (${Number(latInput).toFixed(4)}, ${Number(lngInput).toFixed(4)}${gpsAccuracy !== null ? ` · akurasi ${Math.round(gpsAccuracy)}m` : ''})`
                    : 'GPS otomatis dibaca saat presensi'}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-subtle px-2.5 py-1 text-text-primary">
                  <Laptop className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                  {browserPreviewDevice.brand} · {browserPreviewDevice.os_version} ({browserPreviewDevice.model})
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-subtle px-2.5 py-1 text-text-secondary">
                  <ShieldCheck className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                  IP dicatat otomatis oleh server
                </span>
              </div>

              {todayRecord ? (
                <p className="text-xs text-text-secondary tabular-nums">
                  Catatan hari ini: Masuk{' '}
                  <strong className="text-text-primary">
                    {todayRecord.clock_in_at ? formatDateTimeId(todayRecord.clock_in_at) : '-'}
                  </strong>
                  {' · '}Pulang{' '}
                  <strong className="text-text-primary">
                    {todayRecord.clock_out_at ? formatDateTimeId(todayRecord.clock_out_at) : 'Belum'}
                  </strong>
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {!hasClockedIn ? (
                <button
                  type="button"
                  disabled={Boolean(busyStage) || clockInMut.isPending}
                  onClick={() => void handleOneClickClockIn()}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
                >
                  <ScanFace className="h-4 w-4" aria-hidden="true" />
                  {busyStage || (clockInMut.isPending ? 'Memproses...' : 'Absen Masuk (1-Klik)')}
                </button>
              ) : !hasClockedOut ? (
                <button
                  type="button"
                  disabled={Boolean(busyStage) || clockOutMut.isPending}
                  onClick={() => void handleOneClickClockOut()}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border-strong bg-accent-soft px-5 text-sm font-semibold text-[#115E59] hover:border-accent dark:text-[#34D399] disabled:opacity-50"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  {busyStage || (clockOutMut.isPending ? 'Memproses...' : 'Absen Pulang (1-Klik)')}
                </button>
              ) : (
                <div className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface-subtle px-4 text-xs font-semibold text-text-secondary">
                  <Check className="h-4 w-4 text-accent" aria-hidden="true" />
                  Presensi Hari Ini Selesai
                </div>
              )}

              {canCreate && faceStatusQuery.data && !faceStatusQuery.data.enrolled ? (
                <button
                  type="button"
                  disabled={Boolean(busyStage) || clockInMut.isPending || clockOutMut.isPending}
                  onClick={handleStartEnrollFace}
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3.5 text-xs font-semibold text-text-primary hover:bg-surface-subtle disabled:opacity-50"
                >
                  <ScanFace className="h-4 w-4 text-accent" aria-hidden="true" />
                  Daftar Wajah
                </button>
              ) : null}

              <button
                type="button"
                aria-expanded={showManualOptions}
                onClick={() => setShowManualOptions((v) => !v)}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3.5 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
              >
                {showManualOptions ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                    Tutup Opsi Manual
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    Opsi Manual / QR
                  </>
                )}
              </button>
            </div>
          </div>

          {showManualOptions ? (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <label htmlFor="att-lat" className="block text-xs font-semibold">
                    Latitude Manual
                  </label>
                  <input
                    id="att-lat"
                    type="number"
                    step="any"
                    value={latInput}
                    onChange={(e) => setLatInput(e.target.value)}
                    placeholder={String(selectedOffice.latitude)}
                    className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm tabular-nums"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="att-lng" className="block text-xs font-semibold">
                    Longitude Manual
                  </label>
                  <input
                    id="att-lng"
                    type="number"
                    step="any"
                    value={lngInput}
                    onChange={(e) => setLngInput(e.target.value)}
                    placeholder={String(selectedOffice.longitude)}
                    className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm tabular-nums"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="att-qr" className="block text-xs font-semibold">
                    Token QR Kantor
                  </label>
                  <input
                    id="att-qr"
                    value={qrToken}
                    onChange={(e) => setQrToken(e.target.value)}
                    placeholder="Contoh: OFFICE-TEGAL-QR"
                    className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={Boolean(busyStage)}
                  onClick={() => void captureBrowserGps()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong bg-surface-subtle px-3 text-xs font-semibold text-text-primary hover:border-accent"
                >
                  <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
                  Ambil GPS Browser
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <div role="tablist" aria-label="Submodul absensi" className="flex gap-1 border-b border-border pb-2">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'records'}
          onClick={() => setTab('records')}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
            tab === 'records' ? 'bg-accent text-on-accent' : 'bg-surface-subtle text-text-primary'
          }`}
        >
          Riwayat Presensi
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'offices'}
          onClick={() => setTab('offices')}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
            tab === 'offices' ? 'bg-accent text-on-accent' : 'bg-surface-subtle text-text-primary'
          }`}
        >
          Lokasi Geofence Kantor
        </button>
      </div>

      {tab === 'records' ? (
        recordsQuery.isLoading ? (
          <TableSkeleton columns={6} rows={6} label="Memuat riwayat kehadiran..." />
        ) : recordsQuery.isError ? (
          <ErrorState
            message={(recordsQuery.error as Error).message}
            onRetry={() => void recordsQuery.refetch()}
          />
        ) : (
          <DataTable
            data={records}
            columns={columns}
            searchPlaceholder="Cari nama karyawan atau tanggal..."
            emptySlot={
              <EmptyState
                title="Belum ada catatan kehadiran"
                description="Lakukan clock-in dari panel di atas atau aplikasi Android MyEkalliptus untuk mencatat kehadiran harian."
              />
            }
          />
        )
      ) : null}

      {tab === 'offices' ? (
        <div className="space-y-3">
          {isHrOrOwner ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={openCreateOffice}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Tambah Lokasi Kantor
              </button>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {offices.map((o) => (
              <div key={o.id} className="rounded-lg border border-border bg-surface p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="flex items-center gap-1.5 font-semibold text-text-primary">
                    <MapPin className="h-4 w-4 text-accent" aria-hidden="true" />
                    <span>{o.name}</span>
                  </h4>
                  <StatusBadge tone="accent" label={`Radius ${o.radius_meters}m`} />
                </div>
                <p className="text-xs text-text-secondary tabular-nums">
                  Koordinat: {o.latitude}, {o.longitude}
                </p>
                <p className="text-xs text-text-secondary">
                  Jam Kerja: {o.work_start_time} - {o.work_end_time} WIB
                </p>
                {isOwner ? (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => openEditOffice(o)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface-subtle px-2.5 text-xs font-semibold text-text-primary hover:border-accent"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      Ubah Posisi (Maps)
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <SlideOver
        open={leaveDrawerOpen}
        onClose={() => setLeaveDrawerOpen(false)}
        title="Ajukan Cuti atau Izin Sakit"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            leaveMut.mutate({
              attendance_date: leaveDate,
              status: leaveStatus,
              note: leaveNote.trim(),
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-1">
            <label htmlFor="lv-date" className="block text-xs font-semibold">
              Tanggal
            </label>
            <input
              id="lv-date"
              type="date"
              required
              value={leaveDate}
              onChange={(e) => setLeaveDate(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="lv-status" className="block text-xs font-semibold">
              Jenis Izin
            </label>
            <select
              id="lv-status"
              value={leaveStatus}
              onChange={(e) => setLeaveStatus(e.target.value as 'leave' | 'sick')}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
            >
              <option value="leave">Cuti / Izin Pribadi</option>
              <option value="sick">Izin Sakit</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="lv-note" className="block text-xs font-semibold">
              Alasan / Keterangan
            </label>
            <textarea
              id="lv-note"
              rows={3}
              required
              minLength={3}
              value={leaveNote}
              onChange={(e) => setLeaveNote(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-surface p-2.5 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={leaveMut.isPending}
            className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent"
          >
            {leaveMut.isPending ? 'Mengirim...' : 'Kirim Pengajuan'}
          </button>
        </form>
      </SlideOver>

      <SlideOver
        open={officeModalMode !== 'closed'}
        onClose={() => setOfficeModalMode('closed')}
        title={
          officeModalMode === 'edit'
            ? 'Ubah Lokasi Geofence Kantor (Maps)'
            : 'Tambah Lokasi Geofence Kantor'
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const payload = {
              name: offName.trim(),
              latitude: Number(offLat),
              longitude: Number(offLng),
              radius_meters: Math.max(20, Math.min(5000, Math.trunc(Number(offRadius) || 150))),
              work_start_time: offStart,
              work_end_time: offEnd,
            };
            if (officeModalMode === 'edit' && editingOfficeId) {
              updateOfficeMut.mutate({ id: editingOfficeId, body: payload });
            } else {
              createOfficeMut.mutate(payload);
            }
          }}
          className="space-y-4"
        >
          <OfficeMapPicker
            latitude={Number.isFinite(Number(offLat)) ? Number(offLat) : -6.8694}
            longitude={Number.isFinite(Number(offLng)) ? Number(offLng) : 109.1402}
            radiusMeters={Math.max(20, Math.min(5000, Math.trunc(Number(offRadius) || 250)))}
            onPick={(lat, lng) => {
              setOffLat(String(lat));
              setOffLng(String(lng));
            }}
          />
          <button
            type="button"
            onClick={captureOfficeBrowserGps}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface-subtle px-2.5 text-xs font-semibold text-text-primary hover:border-accent"
          >
            <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
            Pakai GPS Browser
          </button>
          <div className="space-y-1">
            <label htmlFor="off-name" className="block text-xs font-semibold">
              Nama Kantor
            </label>
            <input
              id="off-name"
              required
              value={offName}
              onChange={(e) => setOffName(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="off-lat" className="block text-xs font-semibold">
                Latitude
              </label>
              <input
                id="off-lat"
                type="number"
                step="any"
                required
                value={offLat}
                onChange={(e) => setOffLat(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="off-lng" className="block text-xs font-semibold">
                Longitude
              </label>
              <input
                id="off-lng"
                type="number"
                step="any"
                required
                value={offLng}
                onChange={(e) => setOffLng(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label htmlFor="off-rad" className="block text-xs font-semibold">
                Radius (m)
              </label>
              <input
                id="off-rad"
                type="number"
                min={20}
                max={5000}
                value={offRadius}
                onChange={(e) => setOffRadius(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="off-start" className="block text-xs font-semibold">
                Masuk
              </label>
              <input
                id="off-start"
                value={offStart}
                onChange={(e) => setOffStart(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="off-end" className="block text-xs font-semibold">
                Pulang
              </label>
              <input
                id="off-end"
                value={offEnd}
                onChange={(e) => setOffEnd(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2 text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={createOfficeMut.isPending || updateOfficeMut.isPending}
            className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent"
          >
            {createOfficeMut.isPending || updateOfficeMut.isPending
              ? 'Menyimpan...'
              : officeModalMode === 'edit'
                ? 'Simpan Perubahan Lokasi'
                : 'Simpan Kantor'}
          </button>
        </form>
      </SlideOver>

      <FaceVerificationModal
        open={verifyModalMode !== 'closed'}
        mode={verifyModalMode === 'closed' ? 'clock_in' : verifyModalMode}
        employeeName={me.employee.full_name}
        faceStatus={faceStatusQuery.data}
        allowQrFallback={verifyModalMode !== 'enroll'}
        busy={Boolean(busyStage) || clockInMut.isPending || clockOutMut.isPending}
        busyText={busyStage}
        externalError={verifyModalError}
        onClose={closeVerifyModal}
        onVerifiedFace={handleVerifiedFaceSubmit}
        onEnrolled={() => {
          void queryClient.invalidateQueries({ queryKey: ['attendance', 'face-status'] });
        }}
        onSubmitQr={handleModalQrSubmit}
      />
    </div>
  );
}
