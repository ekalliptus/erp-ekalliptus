import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, UserPlus } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { DownloadAppButton } from '../components/AppVersionWidgets.tsx';
import { ThemeToggleButton } from '../components/ThemeToggleButton.tsx';
import { authClient, clearAccessTokenCache, getAccessToken } from '../lib/auth.ts';
import { erpApi, type ClaimPreviewEmployee } from '../lib/api.ts';
import { WEB_APP_BUILD_NUMBER, WEB_APP_VERSION } from '../lib/appVersion.ts';

type AuthMode = 'signin' | 'signup';

const USERNAME_PATTERN = /^[a-z0-9_.]{3,24}$/;

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [claimCode, setClaimCode] = useState('');
  const [claimPreview, setClaimPreview] = useState<ClaimPreviewEmployee | null>(null);
  const [verifiedClaimCode, setVerifiedClaimCode] = useState<string | null>(null);
  const [claimLookupLoading, setClaimLookupLoading] = useState(false);
  const [claimLookupError, setClaimLookupError] = useState<string | null>(null);
  const [optionalUsername, setOptionalUsername] = useState('');
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const lookupSeqRef = useRef(0);

  const claimId = useId();
  const optionalUsernameId = useId();
  const emailId = useId();
  const passwordId = useId();

  async function runClaimLookup(rawCode: string) {
    const normalized = rawCode.trim().toUpperCase();
    if (normalized.length < 6) {
      setClaimLookupError('Masukkan minimal 6 karakter kode aktivasi.');
      return;
    }

    const seq = ++lookupSeqRef.current;
    setClaimLookupLoading(true);
    setClaimLookupError(null);

    try {
      const res = await erpApi.profile.previewClaimCode(normalized);
      if (seq !== lookupSeqRef.current) return;
      setClaimPreview(res.employee);
      setVerifiedClaimCode(normalized);
      setOptionalUsername('');
      setClaimLookupError(null);
    } catch (err) {
      if (seq !== lookupSeqRef.current) return;
      setClaimPreview(null);
      setVerifiedClaimCode(null);
      setClaimLookupError(
        err instanceof Error ? err.message : 'Gagal memeriksa kode aktivasi.',
      );
    } finally {
      if (seq === lookupSeqRef.current) {
        setClaimLookupLoading(false);
      }
    }
  }

  useEffect(() => {
    if (mode !== 'signup') return;
    const normalized = claimCode.trim().toUpperCase();
    if (
      !normalized.startsWith('EK-') ||
      normalized.length < 12 ||
      normalized === verifiedClaimCode
    ) {
      return;
    }
    const isExactStandardCode = /^EK-[A-Z0-9]{10}$/.test(normalized);
    const delay = isExactStandardCode ? 150 : 350;
    const timer = window.setTimeout(() => {
      void runClaimLookup(normalized);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [mode, claimCode, verifiedClaimCode]);

  function handleClaimCodeChange(raw: string) {
    const normalized = raw.replace(/\s+/g, '').toUpperCase();
    setClaimCode(normalized);
    if (normalized !== verifiedClaimCode) {
      ++lookupSeqRef.current;
      setClaimPreview(null);
      setVerifiedClaimCode(null);
      setClaimLookupError(null);
      setClaimLookupLoading(false);
      setErrorMsg(null);
      setInfoMsg(null);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    if (mode === 'signin') {
      const identityValue = identity.trim().toLowerCase();
      const isEmailIdentity = identityValue.includes('@');
      if (!identityValue) {
        setErrorMsg('Masukkan email kerja atau username.');
        return;
      }
      if (password.length < 8) {
        setErrorMsg('Kata sandi minimal 8 karakter.');
        return;
      }

      setPending(true);
      try {
        clearAccessTokenCache();
        let signInEmail = identityValue;
        if (!isEmailIdentity) {
          const lookup = await erpApi.profile.lookupUsername(identityValue);
          if (!lookup.email) {
            setErrorMsg('Username tidak ditemukan. Gunakan email kerja untuk masuk.');
            return;
          }
          signInEmail = lookup.email;
        }
        const res = await authClient.signIn.email({
          email: signInEmail,
          password,
        });
        if (res.error) {
          setErrorMsg(
            res.error.message || 'Email/username atau kata sandi tidak cocok dengan akun Neon Auth.',
          );
          return;
        }
        await getAccessToken(true);
        onSuccess();
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Terjadi kesalahan koneksi saat menghubungi layanan auth.',
        );
      } finally {
        setPending(false);
      }
      return;
    }

    const code = claimCode.trim().toUpperCase();
    if (!claimPreview || verifiedClaimCode !== code) {
      setErrorMsg('Masukkan dan verifikasi kode aktivasi terlebih dahulu sampai data karyawan muncul.');
      return;
    }
    if (password.length < 8) {
      setErrorMsg('Kata sandi minimal 8 karakter.');
      return;
    }

    const hasOwnerUsername = Boolean(claimPreview.username && claimPreview.username.trim().length > 0);
    const normalizedOptionalUsername = optionalUsername.trim().toLowerCase();
    if (
      !hasOwnerUsername &&
      normalizedOptionalUsername.length > 0 &&
      !USERNAME_PATTERN.test(normalizedOptionalUsername)
    ) {
      setErrorMsg('Username 3-24 karakter: huruf kecil, angka, titik, atau garis bawah.');
      return;
    }

    setPending(true);
    try {
      clearAccessTokenCache();
      const targetEmail = claimPreview.email.trim().toLowerCase();
      const targetName = claimPreview.full_name.trim();

      const res = await authClient.signUp.email({
        email: targetEmail,
        password,
        name: targetName,
      });
      if (res.error && !/terdaftar|already|exists|duplicate/i.test(res.error.message ?? '')) {
        setErrorMsg(
          res.error.message || 'Gagal mendaftarkan akun. Pastikan email belum terdaftar.',
        );
        return;
      }
      if (res.error) {
        // Email sudah terdaftar di Neon Auth: coba masuk dengan sandi yang
        // diketik untuk melanjutkan klaim (kasus aktivasi ulang).
        const signInRes = await authClient.signIn.email({ email: targetEmail, password });
        if (signInRes.error) {
          setErrorMsg('Email sudah terdaftar dan kata sandi tidak cocok untuk melanjutkan klaim.');
          return;
        }
      }

      await getAccessToken(true);
      try {
        await erpApi.profile.claimAccount(code);
      } catch (claimErr) {
        setInfoMsg(
          claimErr instanceof Error
            ? 'Akun auth dibuat, tapi klaim gagal: ' + claimErr.message
            : 'Akun auth dibuat, tapi klaim gagal.',
        );
        return;
      }

      if (!hasOwnerUsername && normalizedOptionalUsername.length > 0) {
        try {
          await erpApi.profile.setUsername(normalizedOptionalUsername);
        } catch {
          setInfoMsg('Akun aktif, tapi username gagal disimpan (mungkin sudah dipakai). Atur ulang nanti.');
        }
      }

      onSuccess();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Terjadi kesalahan koneksi saat menghubungi layanan auth.',
      );
    } finally {
      setPending(false);
    }
  }

  const hasOwnerUsername = Boolean(claimPreview?.username && claimPreview.username.trim().length > 0);
  const canManualCheck =
    mode === 'signup' &&
    claimCode.trim().length >= 6 &&
    verifiedClaimCode !== claimCode.trim().toUpperCase() &&
    !claimLookupLoading;

  return (
    <div className="flex min-h-screen flex-col justify-between bg-canvas px-4 py-6 text-text-primary sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img
            src="/logo.webp"
            alt="Logo MyEkalliptus"
            width={32}
            height={32}
            decoding="async"
            className="h-8 w-8 rounded-md border border-border bg-white p-0.5 object-contain"
          />
          <div>
            <span className="block font-display text-sm font-bold text-text-primary">
              MyEkalliptus
            </span>
            <span className="block text-xs text-text-secondary">
              Web Command Center
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggleButton showLabel className="bg-surface hover:bg-surface-subtle" />
        </div>
      </div>

      <main className="mx-auto my-8 w-full max-w-md">
        <div className="rounded-xl border border-border bg-surface p-6 sm:p-8">
          <div className="mb-6 space-y-1.5">
            <h1 className="font-display text-xl font-bold text-text-primary">
              {mode === 'signin' ? 'Masuk ke MyEkalliptus' : 'Aktivasi Akun Karyawan'}
            </h1>
            <p className="text-sm text-text-secondary">
              {mode === 'signin'
                ? 'Autentikasi menggunakan akun kerja terdaftar di Neon Auth untuk mengakses modul ERP sesuai role.'
                : 'Masukkan kode aktivasi dari Owner/HR untuk memuat data karyawan otomatis, lalu buat kata sandi login Anda.'}
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Mode autentikasi"
            className="mb-5 grid grid-cols-2 rounded-lg border border-border bg-surface-subtle p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              onClick={() => {
                ++lookupSeqRef.current;
                setMode('signin');
                setErrorMsg(null);
                setInfoMsg(null);
                setClaimLookupError(null);
                setClaimLookupLoading(false);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-semibold ${
                mode === 'signin'
                  ? 'bg-surface text-text-primary border border-border'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Masuk</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              onClick={() => {
                ++lookupSeqRef.current;
                setMode('signup');
                setErrorMsg(null);
                setInfoMsg(null);
                setClaimLookupError(null);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-semibold ${
                mode === 'signup'
                  ? 'bg-surface text-text-primary border border-border'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Aktivasi Pertama</span>
            </button>
          </div>

          {errorMsg ? (
            <div
              role="alert"
              className="mb-4 rounded-md border border-[#FECACA] bg-danger-soft px-3.5 py-2.5 text-xs font-medium text-[#991B1B] dark:border-[#7F1D1D] dark:text-[#FCA5A5]"
            >
              {errorMsg}
            </div>
          ) : null}

          {infoMsg ? (
            <div
              role="status"
              className="mb-4 rounded-md border border-[#BBF7D0] bg-success-soft px-3.5 py-2.5 text-xs font-medium text-[#14532D] dark:border-[#14532D] dark:text-[#86EFAC]"
            >
              {infoMsg}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {mode === 'signup' ? (
              <>
                <div className="space-y-1.5">
                  <label htmlFor={claimId} className="block text-xs font-semibold text-text-primary">
                    Kode Aktivasi
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id={claimId}
                      type="text"
                      required
                      autoComplete="off"
                      spellCheck={false}
                      value={claimCode}
                      onChange={(e) => handleClaimCodeChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !claimPreview && claimCode.trim().length >= 6) {
                          e.preventDefault();
                          void runClaimLookup(claimCode);
                        }
                      }}
                      placeholder="EK-XXXXXXXXXX"
                      className="h-10 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 font-mono text-sm uppercase tracking-wider text-text-primary focus:border-accent"
                    />
                    {canManualCheck ? (
                      <button
                        type="button"
                        onClick={() => void runClaimLookup(claimCode)}
                        className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface-subtle px-3 text-xs font-semibold text-text-primary hover:border-accent hover:text-[#115E59] dark:hover:text-[#34D399]"
                      >
                        Cek Kode
                      </button>
                    ) : null}
                  </div>
                  <p className="text-[0.65rem] text-text-secondary">
                    Masukkan kode dari Owner/HR (contoh: EK-XXXXXXXXXX). Data karyawan dimuat otomatis saat kode lengkap.
                  </p>
                </div>

                {claimLookupLoading ? (
                  <div
                    role="status"
                    className="flex items-center gap-2 rounded-md border border-border bg-surface-subtle px-3.5 py-2.5 text-xs font-medium text-text-secondary"
                  >
                    <Loader2 className="h-4 w-4 animate-spin text-[#115E59] dark:text-[#34D399]" aria-hidden="true" />
                    <span>Memeriksa kode aktivasi...</span>
                  </div>
                ) : null}

                {claimLookupError ? (
                  <div
                    role="alert"
                    className="flex items-start justify-between gap-2 rounded-md border border-[#FECACA] bg-danger-soft px-3.5 py-2.5 text-xs font-medium text-[#991B1B] dark:border-[#7F1D1D] dark:text-[#FCA5A5]"
                  >
                    <span>{claimLookupError}</span>
                    {claimCode.trim().length >= 6 ? (
                      <button
                        type="button"
                        onClick={() => void runClaimLookup(claimCode)}
                        className="shrink-0 underline font-semibold"
                      >
                        Coba Lagi
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {claimPreview ? (
                  <div className="rounded-lg border border-[#86EFAC] bg-success-soft/60 p-3.5 dark:border-[#065F46] dark:bg-success-soft/35">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#86EFAC]/70 pb-2.5 dark:border-[#065F46]">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[#115E59] dark:text-[#34D399]">
                        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>Data Karyawan Terverifikasi</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="rounded border border-border bg-surface px-2 py-0.5 font-mono text-[11px] font-semibold text-text-primary">
                          {claimPreview.employee_code}
                        </span>
                        <span className="rounded border border-[#86EFAC] bg-surface px-2 py-0.5 text-[11px] font-semibold text-[#115E59] dark:border-[#065F46] dark:text-[#34D399]">
                          {claimPreview.role_name}
                        </span>
                      </div>
                    </div>

                    <dl className="mt-2.5 space-y-1.5 text-xs">
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="shrink-0 text-text-secondary">Nama Lengkap</dt>
                        <dd className="text-right font-semibold text-text-primary">{claimPreview.full_name}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="shrink-0 text-text-secondary">Email Kerja</dt>
                        <dd className="truncate text-right font-mono text-text-primary">{claimPreview.email}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="shrink-0 text-text-secondary">Username</dt>
                        <dd className="text-right font-mono text-text-primary">
                          {hasOwnerUsername ? `@${claimPreview.username}` : 'Belum diatur (opsional)'}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ) : null}

                {claimPreview && !hasOwnerUsername ? (
                  <div className="space-y-1.5">
                    <label
                      htmlFor={optionalUsernameId}
                      className="block text-xs font-semibold text-text-primary"
                    >
                      Username Login (Opsional)
                    </label>
                    <input
                      id={optionalUsernameId}
                      type="text"
                      autoComplete="username"
                      value={optionalUsername}
                      onChange={(e) => setOptionalUsername(e.target.value)}
                      placeholder="contoh: budi.santoso"
                      className="h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-text-primary focus:border-accent"
                    />
                    <p className="text-[0.65rem] text-text-secondary">
                      Opsional. 3-24 karakter: huruf kecil, angka, titik, atau garis bawah.
                    </p>
                  </div>
                ) : null}

                {claimPreview ? (
                  <div className="space-y-1.5">
                    <label
                      htmlFor={passwordId}
                      className="block text-xs font-semibold text-text-primary"
                    >
                      Buat Kata Sandi Baru
                    </label>
                    <div className="relative">
                      <input
                        id={passwordId}
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Minimal 8 karakter"
                        className="h-10 w-full rounded-md border border-border-strong bg-surface pl-3 pr-10 text-sm text-text-primary focus:border-accent"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-text-secondary hover:text-text-primary"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    <p className="text-[0.65rem] text-text-secondary">
                      Minimal 8 karakter untuk masuk ke Web dan aplikasi mobile.
                    </p>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label htmlFor={emailId} className="block text-xs font-semibold text-text-primary">
                    Email atau Username
                  </label>
                  <input
                    id={emailId}
                    type="text"
                    autoComplete="username email"
                    required
                    value={identity}
                    onChange={(e) => setIdentity(e.target.value)}
                    placeholder="nama@ekalliptus.com atau username"
                    className="h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-text-primary focus:border-accent"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor={passwordId}
                    className="block text-xs font-semibold text-text-primary"
                  >
                    Kata Sandi
                  </label>
                  <div className="relative">
                    <input
                      id={passwordId}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimal 8 karakter"
                      className="h-10 w-full rounded-md border border-border-strong bg-surface pl-3 pr-10 text-sm text-text-primary focus:border-accent"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-text-secondary hover:text-text-primary"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={pending || (mode === 'signup' && (claimLookupLoading || !claimPreview))}
              className="flex h-10 w-full items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
            >
              {pending
                ? 'Memproses sesi...'
                : mode === 'signin'
                  ? 'Masuk ke Command Center'
                  : 'Aktifkan & Masuk'}
            </button>
          </form>

          <p className="mt-5 border-t border-border pt-4 text-xs text-text-secondary">
            Bantuan akses atau reset akun:{' '}
            <a
              href="mailto:alul@ekalliptus.com"
              className="font-semibold text-[#115E59] underline hover:text-accent dark:text-[#34D399]"
            >
              alul@ekalliptus.com
            </a>
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-xs">
          <div className="min-w-0">
            <p className="font-semibold text-text-primary">Aplikasi Android MyEkalliptus</p>
            <p className="text-text-secondary">
              Absensi 1-Tap biometrik &amp; kontrol ERP langsung dari ponsel.
            </p>
          </div>
          <DownloadAppButton variant="card" />
        </div>
      </main>

      <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-xs text-text-secondary">
        <span>
          MyEkalliptus Enterprise Resource Planning · v{WEB_APP_VERSION} (Build{' '}
          {WEB_APP_BUILD_NUMBER})
        </span>
        <span>Kontak Resmi: alul@ekalliptus.com</span>
      </footer>
    </div>
  );
}
