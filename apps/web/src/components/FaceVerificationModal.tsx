import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ScanFace, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { erpApi, uploadFileViaPresign, type FaceStatusResponse } from '../lib/api.ts';
import {
  analyzeVideoFaceFrame,
  averageDescriptors,
  euclideanDistance,
  extractWebDescriptorFromBlob,
  loadFaceModels,
} from '../lib/faceRecognition.ts';

type ScanPhase =
  | 'initializing'
  | 'scanning'
  | 'locking'
  | 'verifying'
  | 'mismatch'
  | 'error'
  | 'success';

type FrameTone = 'neutral' | 'accent' | 'danger';

const ENROLL_POSES = ['front', 'side_1', 'side_2', 'front_confirm'] as const;
const ENROLL_STEP_CHIPS = ['1. Lurus', '2. Kiri', '3. Kanan', '4. Selesai'] as const;

export interface VerifiedFaceResult {
  selfieKey: string;
  descriptor: number[];
  model: 'web_faceapi_128d';
  similarityPercent?: number;
}

export function FaceVerificationModal({
  open,
  mode,
  employeeName,
  faceStatus,
  replace = false,
  allowQrFallback = false,
  busy = false,
  busyText,
  externalError,
  onClose,
  onVerifiedFace,
  onEnrolled,
  onSubmitQr,
}: {
  open: boolean;
  mode: 'clock_in' | 'clock_out' | 'enroll';
  employeeName: string;
  faceStatus: FaceStatusResponse | null | undefined;
  replace?: boolean;
  allowQrFallback?: boolean;
  busy?: boolean;
  busyText?: string | null;
  externalError?: string | null;
  onClose: () => void;
  onVerifiedFace: (result: VerifiedFaceResult) => Promise<void> | void;
  onEnrolled?: () => void;
  onSubmitQr?: (token: string) => Promise<void> | void;
}) {
  const titleId = useId();
  const qrInputId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onVerifiedRef = useRef(onVerifiedFace);
  onVerifiedRef.current = onVerifiedFace;
  const onEnrolledRef = useRef(onEnrolled);
  onEnrolledRef.current = onEnrolled;
  const faceStatusRef = useRef(faceStatus);
  faceStatusRef.current = faceStatus;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const replaceRef = useRef(replace);
  replaceRef.current = replace;

  // Verify frame buffer
  const readySamplesRef = useRef<number[][]>([]);
  // 4-step enrollment buffers
  const enrollStepRef = useRef(0);
  const stepSamplesRef = useRef<number[][]>([]);
  const poseSamplesRef = useRef<number[][]>([]);
  const firstTurnSignRef = useRef<1 | -1 | 0>(0);
  const capturedFrontFileRef = useRef<File | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [phase, setPhase] = useState<ScanPhase>('initializing');
  const [frameTone, setFrameTone] = useState<FrameTone>('neutral');
  const [stabilityCount, setStabilityCount] = useState(0);
  const [enrollStepUi, setEnrollStepUi] = useState(0);
  const [statusMsg, setStatusMsg] = useState('Menyiapkan kamera dan model deteksi wajah...');
  const [mismatchMessage, setMismatchMessage] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanRunId, setScanRunId] = useState(0);
  const [qrToken, setQrToken] = useState('');
  const [qrBusy, setQrBusy] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);

  const isEnrollmentFlow = !faceStatus?.enrolled || mode === 'enroll';

  function resetEnrollmentState() {
    enrollStepRef.current = 0;
    stepSamplesRef.current = [];
    poseSamplesRef.current = [];
    firstTurnSignRef.current = 0;
    capturedFrontFileRef.current = null;
    setEnrollStepUi(0);
  }

  function stopStream() {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }

  useEffect(() => {
    if (!open) {
      stopStream();
      return;
    }

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    let cancelled = false;
    readySamplesRef.current = [];
    resetEnrollmentState();
    setCameraReady(false);
    setModelsReady(false);
    setPhase('initializing');
    setFrameTone('neutral');
    setStabilityCount(0);
    setStatusMsg('Menyiapkan kamera dan model deteksi wajah...');
    setMismatchMessage(null);
    setCameraError(null);
    setQrToken('');
    setQrBusy(false);
    setQrError(null);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    const focusTimer = window.setTimeout(() => {
      dialogRef.current?.focus();
    }, 20);

    async function bootCameraAndModels() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setCameraError('Kamera webcam tidak tersedia di browser ini. Gunakan QR kantor jika diizinkan.');
          setPhase('error');
        }
        return;
      }

      try {
        const [stream] = await Promise.all([
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false,
          }),
          loadFaceModels(),
        ]);

        if (cancelled) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => null);
        }
        setCameraReady(true);
        setModelsReady(true);
        setPhase('scanning');
        setStatusMsg(
          !faceStatusRef.current?.enrolled || modeRef.current === 'enroll'
            ? 'Tahap 1/4: Hadap lurus ke dalam bingkai oval'
            : 'Arahkan wajah Anda ke dalam bingkai oval',
        );
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Izin kamera atau model ditolak';
          setCameraError(`Gagal menyiapkan pemindai wajah (${msg}).`);
          setPhase('error');
        }
      }
    }

    void bootCameraAndModels();

    return () => {
      cancelled = true;
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
      stopStream();
      previousFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !cameraReady || !modelsReady) return;
    if (phase !== 'scanning' && phase !== 'locking') return;

    let cancelled = false;
    let timerId: number | null = null;

    async function captureCanvasJpeg(video: HTMLVideoElement): Promise<File> {
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;
      const scale = Math.min(1, 720 / Math.max(vw, vh));
      const w = Math.max(1, Math.round(vw * scale));
      const h = Math.max(1, Math.round(vh * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Gagal memproses frame gambar dari kamera.');
      ctx.drawImage(video, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.88),
      );
      if (!blob) throw new Error('Gagal menangkap foto wajah dari kamera.');
      return new File([blob], `face-web-${Date.now()}.jpg`, { type: 'image/jpeg' });
    }

    async function handleEnrollmentTick(
      video: HTMLVideoElement,
      descriptor: number[],
      yawRatio: number,
    ): Promise<'continue' | 'done'> {
      const stepIdx = enrollStepRef.current;
      const firstSign = firstTurnSignRef.current;

      if (stepIdx === 0 || stepIdx === 3) {
        if (Math.abs(yawRatio) > 0.14) {
          stepSamplesRef.current = [];
          setStabilityCount(0);
          setPhase('scanning');
          setFrameTone('neutral');
          setStatusMsg(
            stepIdx === 0
              ? 'Tahap 1/4: Hadap lurus ke kamera'
              : 'Tahap 4/4: Hadap lurus kembali untuk konfirmasi',
          );
          return 'continue';
        }
      } else if (stepIdx === 1) {
        if (Math.abs(yawRatio) < 0.16 || Math.abs(yawRatio) > 0.58) {
          stepSamplesRef.current = [];
          setStabilityCount(0);
          setPhase('scanning');
          setFrameTone('neutral');
          setStatusMsg('Tahap 2/4: Tengok sedikit ke kiri lalu tahan');
          return 'continue';
        }
      } else if (stepIdx === 2) {
        const oppYaw = yawRatio * -(firstSign || 1);
        if (oppYaw < 0.16 || Math.abs(yawRatio) > 0.58) {
          stepSamplesRef.current = [];
          setStabilityCount(0);
          setPhase('scanning');
          setFrameTone('neutral');
          const sameSide = yawRatio * (firstSign || 1) > 0.12;
          setStatusMsg(
            sameSide
              ? 'Tahap 3/4: Tengok ke sisi sebaliknya dari langkah sebelumnya'
              : 'Tahap 3/4: Tengok sedikit ke kanan lalu tahan',
          );
          return 'continue';
        }
      }

      const nextBuf = [...stepSamplesRef.current, descriptor].slice(-2);
      stepSamplesRef.current = nextBuf;
      setStabilityCount(nextBuf.length);

      if (nextBuf.length < 2) {
        setPhase('locking');
        setFrameTone('accent');
        setStatusMsg(`Tahap ${stepIdx + 1}/4: Tahan posisi... (${nextBuf.length}/2)`);
        return 'continue';
      }

      const poseAvg = averageDescriptors(nextBuf);
      stepSamplesRef.current = [];

      if (stepIdx === 0) {
        capturedFrontFileRef.current = await captureCanvasJpeg(video);
        if (cancelled) return 'done';
        poseSamplesRef.current = [poseAvg];
        enrollStepRef.current = 1;
        setEnrollStepUi(1);
        setStabilityCount(0);
        setPhase('scanning');
        setFrameTone('accent');
        setStatusMsg('Bagus! Tahap 2/4: Tengok sedikit ke kiri');
        return 'continue';
      }

      if (stepIdx === 1) {
        firstTurnSignRef.current = yawRatio >= 0 ? 1 : -1;
        poseSamplesRef.current = [...poseSamplesRef.current, poseAvg];
        enrollStepRef.current = 2;
        setEnrollStepUi(2);
        setStabilityCount(0);
        setPhase('scanning');
        setFrameTone('accent');
        setStatusMsg('Bagus! Tahap 3/4: Tengok sedikit ke kanan');
        return 'continue';
      }

      if (stepIdx === 2) {
        poseSamplesRef.current = [...poseSamplesRef.current, poseAvg];
        enrollStepRef.current = 3;
        setEnrollStepUi(3);
        setStabilityCount(0);
        setPhase('scanning');
        setFrameTone('accent');
        setStatusMsg('Bagus! Tahap 4/4: Hadap lurus kembali');
        return 'continue';
      }

      const step0 = poseSamplesRef.current[0];
      if (!step0 || euclideanDistance(step0, poseAvg) > 0.58) {
        resetEnrollmentState();
        setStabilityCount(0);
        setPhase('scanning');
        setFrameTone('danger');
        setStatusMsg('Wajah tidak konsisten, ulangi Tahap 1/4: Hadap lurus');
        return 'continue';
      }

      const allPoses = [...poseSamplesRef.current, poseAvg];
      const centroid = averageDescriptors(allPoses);
      const isReplace = replaceRef.current || Boolean(faceStatusRef.current?.enrolled && modeRef.current === 'enroll');

      setPhase('verifying');
      setFrameTone('accent');
      setEnrollStepUi(4);
      setStatusMsg('Menyimpan profil wajah 4 sudut ke akun...');

      const file = capturedFrontFileRef.current ?? (await captureCanvasJpeg(video));
      if (cancelled) return 'done';
      const selfieKey = await uploadFileViaPresign('selfie', file);
      if (cancelled) return 'done';
      await erpApi.attendance.enrollFace({
        face_model: 'web_faceapi_128d',
        face_descriptor: centroid,
        face_samples: allPoses,
        enrollment_poses: [...ENROLL_POSES],
        selfie_object_key: selfieKey,
        replace: isReplace || undefined,
      });
      if (cancelled) return 'done';
      onEnrolledRef.current?.();

      if (modeRef.current === 'enroll') {
        setPhase('success');
        setStatusMsg('Wajah 4 sudut berhasil didaftarkan untuk akun Anda.');
        window.setTimeout(() => {
          if (!cancelled) onCloseRef.current();
        }, 900);
        return 'done';
      }

      setPhase('success');
      setStatusMsg('Wajah terdaftar (100%). Mengirim absensi...');
      await onVerifiedRef.current({
        selfieKey,
        descriptor: centroid,
        model: 'web_faceapi_128d',
        similarityPercent: 100,
      });
      return 'done';
    }

    async function tick() {
      if (cancelled) return;
      const video = videoRef.current;
      if (!video) return;

      try {
        const frame = await analyzeVideoFaceFrame(video);
        if (cancelled) return;

        if (frame.status === 'no_face') {
          readySamplesRef.current = [];
          stepSamplesRef.current = [];
          setStabilityCount(0);
          setPhase('scanning');
          setFrameTone('neutral');
          setStatusMsg(
            !faceStatusRef.current?.enrolled || modeRef.current === 'enroll'
              ? `Tahap ${enrollStepRef.current + 1}/4: Arahkan wajah ke bingkai oval`
              : 'Arahkan wajah Anda ke dalam bingkai oval',
          );
          timerId = window.setTimeout(() => void tick(), 200);
          return;
        }
        if (frame.status === 'multiple_faces') {
          readySamplesRef.current = [];
          stepSamplesRef.current = [];
          setStabilityCount(0);
          setPhase('scanning');
          setFrameTone('danger');
          setStatusMsg('Hanya 1 wajah yang diizinkan di depan kamera');
          timerId = window.setTimeout(() => void tick(), 230);
          return;
        }
        if (frame.status === 'too_far') {
          readySamplesRef.current = [];
          stepSamplesRef.current = [];
          setStabilityCount(0);
          setPhase('scanning');
          setFrameTone('neutral');
          setStatusMsg('Dekatkan wajah sedikit ke kamera');
          timerId = window.setTimeout(() => void tick(), 200);
          return;
        }
        if (frame.status === 'off_center') {
          readySamplesRef.current = [];
          stepSamplesRef.current = [];
          setStabilityCount(0);
          setPhase('scanning');
          setFrameTone('neutral');
          setStatusMsg('Posisikan wajah tepat di tengah bingkai oval');
          timerId = window.setTimeout(() => void tick(), 200);
          return;
        }

        const currentStatus = faceStatusRef.current;
        const currentMode = modeRef.current;
        const shouldEnroll = !currentStatus?.enrolled || currentMode === 'enroll';

        if (shouldEnroll) {
          const outcome = await handleEnrollmentTick(video, frame.descriptor, frame.yawRatio);
          if (outcome === 'continue' && !cancelled) {
            timerId = window.setTimeout(() => void tick(), 200);
          }
          return;
        }

        const samples = [...readySamplesRef.current, frame.descriptor].slice(-2);
        readySamplesRef.current = samples;
        setStabilityCount(samples.length);

        if (samples.length < 2) {
          setPhase('locking');
          setFrameTone('accent');
          setStatusMsg(`Tahan posisi... mengunci wajah (${samples.length}/2)`);
          timerId = window.setTimeout(() => void tick(), 180);
          return;
        }

        setPhase('verifying');
        setFrameTone('accent');

        const probeDescriptor = averageDescriptors(samples);

        if (
          currentStatus &&
          !currentStatus.models.includes('web_faceapi_128d') &&
          currentStatus.has_reference_photo
        ) {
          setStatusMsg('Menyelaraskan profil wajah terdaftar...');
          const refBlob = await erpApi.attendance.fetchFaceReferenceBlob();
          if (cancelled) return;
          const refDescriptor = await extractWebDescriptorFromBlob(refBlob);
          if (cancelled) return;
          const dist = euclideanDistance(refDescriptor, probeDescriptor);
          const sim = Math.max(0, Math.min(100, Math.round((1 - dist * 0.6) * 100)));

          if (dist > 0.52) {
            setPhase('mismatch');
            setFrameTone('danger');
            setMismatchMessage(
              `Wajah tidak cocok dengan data karyawan terdaftar (kemiripan ${sim}%). Absensi ditolak.`,
            );
            setStatusMsg('Verifikasi wajah gagal');
            return;
          }

          const file = await captureCanvasJpeg(video);
          if (cancelled) return;
          const selfieKey = await uploadFileViaPresign('selfie', file);
          if (cancelled) return;
          await erpApi.attendance.enrollFace({
            face_model: 'web_faceapi_128d',
            face_descriptor: refDescriptor,
            selfie_object_key: selfieKey,
            derived_from_reference: true,
          });
          if (cancelled) return;
          onEnrolledRef.current?.();
          setPhase('success');
          setStatusMsg(`Wajah cocok (${sim}%). Mengirim absensi...`);
          await onVerifiedRef.current({
            selfieKey,
            descriptor: probeDescriptor,
            model: 'web_faceapi_128d',
            similarityPercent: sim,
          });
          return;
        }

        setStatusMsg('Mencocokkan identitas wajah...');
        const verifyRes = await erpApi.attendance.verifyFace('web_faceapi_128d', probeDescriptor);
        if (cancelled) return;

        if (!verifyRes.matched) {
          setPhase('mismatch');
          setFrameTone('danger');
          setMismatchMessage(
            `Wajah tidak cocok dengan karyawan terdaftar (kemiripan ${verifyRes.similarity_percent}%). Absensi ditolak.`,
          );
          setStatusMsg('Identitas wajah tidak cocok');
          return;
        }

        setPhase('success');
        setStatusMsg(`Wajah cocok (${verifyRes.similarity_percent}%). Mengirim absensi...`);
        const file = await captureCanvasJpeg(video);
        if (cancelled) return;
        const selfieKey = await uploadFileViaPresign('selfie', file);
        if (cancelled) return;
        await onVerifiedRef.current({
          selfieKey,
          descriptor: probeDescriptor,
          model: 'web_faceapi_128d',
          similarityPercent: verifyRes.similarity_percent,
        });
      } catch (err) {
        if (cancelled) return;
        setPhase('mismatch');
        setFrameTone('danger');
        setMismatchMessage(err instanceof Error ? err.message : 'Verifikasi wajah gagal.');
        setStatusMsg('Gagal memverifikasi wajah');
      }
    }

    timerId = window.setTimeout(() => void tick(), 200);
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [open, cameraReady, modelsReady, phase, scanRunId]);

  if (!open) return null;

  function handleRetryScan() {
    readySamplesRef.current = [];
    resetEnrollmentState();
    setStabilityCount(0);
    setMismatchMessage(null);
    setFrameTone('neutral');
    setPhase('scanning');
    setStatusMsg(
      isEnrollmentFlow
        ? 'Tahap 1/4: Hadap lurus ke dalam bingkai oval'
        : 'Arahkan wajah Anda ke dalam bingkai oval',
    );
    setScanRunId((n) => n + 1);
  }

  async function handleQrSubmit() {
    if (!onSubmitQr) return;
    const trimmed = qrToken.trim();
    if (trimmed.length < 3) {
      setQrError('Masukkan token QR kantor minimal 3 karakter.');
      return;
    }
    setQrError(null);
    setQrBusy(true);
    try {
      await onSubmitQr(trimmed);
    } catch (err) {
      setQrError(err instanceof Error ? err.message : 'Verifikasi QR gagal.');
    } finally {
      setQrBusy(false);
    }
  }

  const ovalStroke =
    frameTone === 'danger'
      ? '#EF4444'
      : frameTone === 'accent'
        ? '#10B981'
        : '#E2E8F0';

  const titleText =
    mode === 'enroll'
      ? replace
        ? 'Perbarui Data Wajah'
        : 'Daftarkan Wajah Karyawan'
      : mode === 'clock_out'
        ? 'Scan Wajah Absen Pulang'
        : 'Scan Wajah Absen Masuk';

  const subtitleText =
    isEnrollmentFlow
      ? `Pendaftaran 4 sudut wajah untuk ${employeeName} agar verifikasi akurat di berbagai sudut & cahaya.`
      : `Deteksi wajah otomatis untuk ${employeeName}. Jika wajah berbeda dari data terdaftar, absensi akan ditolak.`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/65"
        aria-hidden="true"
        onClick={() => onCloseRef.current()}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 w-full max-w-md rounded-xl border border-border bg-surface p-5 text-text-primary shadow-xl outline-none space-y-4 max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[#115E59] dark:text-[#34D399]">
              <ScanFace className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 id={titleId} className="font-display text-base font-bold text-text-primary">
                {titleText}
              </h3>
              <p className="mt-0.5 text-xs text-text-secondary">{subtitleText}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            aria-label="Tutup pemindai wajah"
            className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-surface-subtle text-text-primary hover:border-border-strong"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {isEnrollmentFlow ? (
          <div className="grid grid-cols-4 gap-1.5" aria-label="Tahapan pendaftaran wajah">
            {ENROLL_STEP_CHIPS.map((label, idx) => {
              const completed = idx < enrollStepUi;
              const active = idx === enrollStepUi;
              return (
                <div
                  key={label}
                  className={`rounded-md border px-1.5 py-1.5 text-center text-[11px] font-semibold transition-colors ${
                    completed
                      ? 'border-[#10B981] bg-[#065F46] text-white'
                      : active
                        ? 'border-accent bg-accent text-on-accent'
                        : 'border-border bg-surface-subtle text-text-secondary'
                  }`}
                >
                  {label}
                </div>
              );
            })}
          </div>
        ) : null}

        {cameraError ? (
          <div
            role="alert"
            className="rounded-lg border border-[#FECACA] bg-danger-soft px-3.5 py-2.5 text-xs font-medium text-[#991B1B] dark:border-[#7F1D1D] dark:text-[#FCA5A5]"
          >
            {cameraError}
          </div>
        ) : null}

        {mismatchMessage || externalError ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-[#FECACA] bg-danger-soft px-3.5 py-2.5 text-xs font-medium text-[#991B1B] dark:border-[#7F1D1D] dark:text-[#FCA5A5]"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="flex-1 space-y-2">
              <p>{mismatchMessage || externalError}</p>
              <button
                type="button"
                onClick={handleRetryScan}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#FCA5A5] bg-surface px-2.5 py-1 text-xs font-semibold text-[#991B1B] hover:bg-surface-subtle dark:border-[#991B1B] dark:text-[#FCA5A5]"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Scan Ulang Wajah
              </button>
            </div>
          </div>
        ) : null}

        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-border bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full scale-x-[-1] object-cover transition-opacity ${
              cameraReady ? 'opacity-100' : 'opacity-30'
            }`}
          />

          <svg
            viewBox="0 0 400 300"
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            <defs>
              <mask id="face-oval-cutout">
                <rect width="400" height="300" fill="white" />
                <ellipse cx="200" cy="145" rx="92" ry="118" fill="black" />
              </mask>
            </defs>
            <rect
              width="400"
              height="300"
              fill="rgba(15, 23, 42, 0.45)"
              mask="url(#face-oval-cutout)"
            />
            <ellipse
              cx="200"
              cy="145"
              rx="92"
              ry="118"
              fill="none"
              stroke={ovalStroke}
              strokeWidth="3.5"
              strokeDasharray={phase === 'scanning' ? '8 6' : undefined}
            />
          </svg>

          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-col items-center gap-1.5">
            {phase === 'locking' || phase === 'verifying' || phase === 'success' ? (
              <div className="flex items-center gap-1.5" aria-hidden="true">
                {[1, 2].map((step) => (
                  <span
                    key={step}
                    className={`h-1.5 w-8 rounded-full ${
                      stabilityCount >= step || phase === 'success' ? 'bg-[#10B981]' : 'bg-white/40'
                    }`}
                  />
                ))}
              </div>
            ) : null}
            <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-black/75 px-3 py-1.5 text-center text-xs font-semibold text-white">
              {phase === 'initializing' || phase === 'verifying' || busy ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#34D399]" aria-hidden="true" />
              ) : phase === 'success' ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#34D399]" aria-hidden="true" />
              ) : null}
              <span className="truncate">{busy && busyText ? busyText : statusMsg}</span>
            </div>
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-text-secondary">
          Kamera mendeteksi wajah secara otomatis tanpa perlu menekan tombol foto. Pastikan pencahayaan cukup dan hanya ada wajah Anda di depan kamera.
        </p>

        {allowQrFallback && mode !== 'enroll' && onSubmitQr ? (
          <div className="border-t border-border pt-3 space-y-2">
            <label htmlFor={qrInputId} className="block text-xs font-semibold text-text-secondary">
              Alternatif Resmi: Masukkan Token QR Kantor
            </label>
            {qrError ? (
              <p className="text-xs font-medium text-[#991B1B] dark:text-[#FCA5A5]">{qrError}</p>
            ) : null}
            <div className="flex items-center gap-2">
              <input
                id={qrInputId}
                value={qrToken}
                onChange={(e) => setQrToken(e.target.value)}
                placeholder="Token QR kantor..."
                className="h-9 flex-1 rounded-md border border-border-strong bg-surface px-3 text-xs"
              />
              <button
                type="button"
                disabled={qrBusy || busy}
                onClick={() => void handleQrSubmit()}
                className="h-9 cursor-pointer rounded-md border border-border-strong bg-surface-subtle px-3 text-xs font-semibold text-text-primary hover:border-accent disabled:opacity-50"
              >
                {qrBusy ? 'Mengirim...' : 'Gunakan QR'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
