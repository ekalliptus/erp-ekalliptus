import { hasPermission } from '@ekalliptus/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { CalendarPlus, Check, Clock, Crosshair, MapPin, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataTable } from '../components/DataTable.tsx';
import { TableSkeleton } from '../components/Skeleton.tsx';
import { SlideOver } from '../components/SlideOver.tsx';
import { EmptyState, ErrorState } from '../components/StateViews.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import {
  erpApi,
  uploadFileViaPresign,
  type AttendanceRecord,
  type MeResponse,
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

export function AttendancePage({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const canView = hasPermission(me.permissions, 'attendance', 'view');
  const canCreate = hasPermission(me.permissions, 'attendance', 'create');
  const canApprove = hasPermission(me.permissions, 'attendance', 'approve');
  const isHrOrOwner = me.role === 'owner' || me.role === 'hr';

  const [tab, setTab] = useState<AttendanceTab>('records');
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );

  // Clock-in state
  const [officeId, setOfficeId] = useState('');
  const [latInput, setLatInput] = useState('');
  const [lngInput, setLngInput] = useState('');
  const [qrToken, setQrToken] = useState('');
  const [selfieKey, setSelfieKey] = useState<string | null>(null);
  const [uploadingSelfie, setUploadingSelfie] = useState(false);

  // SlideOvers
  const [leaveDrawerOpen, setLeaveDrawerOpen] = useState(false);
  const [officeDrawerOpen, setOfficeDrawerOpen] = useState(false);

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

  const invalidateAtt = async () => {
    await queryClient.invalidateQueries({ queryKey: ['attendance'] });
    await queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  const clockInMut = useMutation({
    mutationFn: erpApi.attendance.clockIn,
    onSuccess: async (res) => {
      await invalidateAtt();
      setSelfieKey(null);
      setQrToken('');
      setFeedback({
        kind: 'success',
        text: `Clock-in berhasil tercatat (${res.distance_meters}m dari radius kantor).`,
      });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const clockOutMut = useMutation({
    mutationFn: erpApi.attendance.clockOut,
    onSuccess: async () => {
      await invalidateAtt();
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
      setOfficeDrawerOpen(false);
      setOffName('');
      setFeedback({ kind: 'success', text: 'Lokasi kantor berhasil ditambahkan.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const offices = officesQuery.data?.offices ?? [];
  const records = recordsQuery.data?.records ?? [];
  const selectedOffice = offices.find((o) => o.id === officeId) ?? offices[0] ?? null;

  const estimatedDistance = useMemo(() => {
    if (!selectedOffice) return null;
    const lat = Number(latInput);
    const lng = Number(lngInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !latInput || !lngInput) return null;
    return Math.round(haversineMeters(lat, lng, selectedOffice.latitude, selectedOffice.longitude));
  }, [selectedOffice, latInput, lngInput]);

  function captureBrowserGps() {
    if (!navigator.geolocation) {
      setFeedback({
        kind: 'error',
        text: 'Browser ini tidak mendukung Geolocation API. Isi koordinat secara manual jika diperlukan.',
      });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatInput(pos.coords.latitude.toFixed(6));
        setLngInput(pos.coords.longitude.toFixed(6));
        setFeedback({ kind: 'success', text: 'Koordinat GPS perangkat berhasil diambil.' });
      },
      (err) => {
        setFeedback({
          kind: 'error',
          text: `Gagal membaca GPS (${err.message}). Anda dapat mengisi koordinat atau menggunakan koordinat kantor untuk verifikasi.`,
        });
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
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

      {/* Clock-in / Clock-out panel */}
      {canCreate && selectedOffice ? (
        <section className="rounded-lg border border-border bg-surface p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-accent" aria-hidden="true" />
              <h3 className="font-display text-sm font-bold text-text-primary">
                Presensi Hari Ini
              </h3>
            </div>
            {estimatedDistance !== null ? (
              <StatusBadge
                tone={estimatedDistance <= selectedOffice.radius_meters ? 'success' : 'danger'}
                label={`Jarak ${estimatedDistance}m / maks ${selectedOffice.radius_meters}m`}
              />
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

            <div className="space-y-1">
              <label htmlFor="att-lat" className="block text-xs font-semibold">
                Latitude
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
                Longitude
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
                Token QR Kantor (jika tanpa selfie)
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

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={captureBrowserGps}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong bg-surface-subtle px-3 text-xs font-semibold text-text-primary hover:border-accent"
              >
                <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
                Ambil GPS Perangkat
              </button>

              <label
                htmlFor="att-selfie"
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface-subtle px-3 text-xs font-semibold text-text-primary hover:border-accent"
              >
                {uploadingSelfie
                  ? 'Mengunggah selfie...'
                  : selfieKey
                    ? 'Selfie Terunggah'
                    : 'Upload Foto Selfie'}
              </label>
              <input
                id="att-selfie"
                type="file"
                accept="image/*"
                capture="user"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setUploadingSelfie(true);
                  try {
                    const key = await uploadFileViaPresign('selfie', file);
                    setSelfieKey(key);
                    setFeedback({ kind: 'success', text: `Selfie terunggah: ${key}` });
                  } catch (err) {
                    setFeedback({ kind: 'error', text: (err as Error).message });
                  } finally {
                    setUploadingSelfie(false);
                  }
                }}
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={clockInMut.isPending}
                onClick={() => {
                  const lat = Number(latInput);
                  const lng = Number(lngInput);
                  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !latInput || !lngInput) {
                    setFeedback({
                      kind: 'error',
                      text: 'Koordinat latitude dan longitude wajib diisi atau diambil dari GPS perangkat.',
                    });
                    return;
                  }
                  clockInMut.mutate({
                    office_id: selectedOffice.id,
                    latitude: lat,
                    longitude: lng,
                    selfie_object_key: selfieKey,
                    qr_token: qrToken.trim() || null,
                  });
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
              >
                Clock-In Sekarang
              </button>

              <button
                type="button"
                disabled={clockOutMut.isPending}
                onClick={() => {
                  clockOutMut.mutate({
                    latitude: latInput ? Number(latInput) : undefined,
                    longitude: lngInput ? Number(lngInput) : undefined,
                    selfie_object_key: selfieKey,
                  });
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-4 text-xs font-semibold text-text-primary hover:bg-surface-subtle disabled:opacity-50"
              >
                Clock-Out
              </button>
            </div>
          </div>
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
                description="Lakukan clock-in dari panel di atas atau aplikasi mobile Flutter untuk mencatat kehadiran harian."
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
                onClick={() => setOfficeDrawerOpen(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Tambah Lokasi Kantor
              </button>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {offices.map((o) => (
              <div key={o.id} className="rounded-lg border border-border bg-surface p-4 space-y-1.5">
                <div className="flex items-center justify-between">
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
        open={officeDrawerOpen}
        onClose={() => setOfficeDrawerOpen(false)}
        title="Tambah Lokasi Geofence Kantor"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createOfficeMut.mutate({
              name: offName.trim(),
              latitude: Number(offLat),
              longitude: Number(offLng),
              radius_meters: Math.max(20, Math.trunc(Number(offRadius) || 150)),
              work_start_time: offStart,
              work_end_time: offEnd,
            });
          }}
          className="space-y-4"
        >
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
            disabled={createOfficeMut.isPending}
            className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent"
          >
            {createOfficeMut.isPending ? 'Menyimpan...' : 'Simpan Kantor'}
          </button>
        </form>
      </SlideOver>
    </div>
  );
}
