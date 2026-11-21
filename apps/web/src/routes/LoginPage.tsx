import { KeyRound, UserPlus } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { ThemeToggleButton } from '../components/ThemeToggleButton.tsx';
import { authClient, clearAccessTokenCache, getAccessToken } from '../lib/auth.ts';

type AuthMode = 'signin' | 'signup';

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setErrorMsg('Masukkan alamat email kerja yang valid.');
      return;
    }
    if (password.length < 8) {
      setErrorMsg('Kata sandi minimal 8 karakter.');
      return;
    }
    if (mode === 'signup' && fullName.trim().length < 2) {
      setErrorMsg('Nama lengkap wajib diisi minimal 2 karakter.');
      return;
    }

    setPending(true);
    try {
      clearAccessTokenCache();
      if (mode === 'signin') {
        const res = await authClient.signIn.email({
          email: trimmedEmail,
          password,
        });
        if (res.error) {
          setErrorMsg(
            res.error.message || 'Email atau kata sandi tidak cocok dengan akun Neon Auth.',
          );
          return;
        }
        await getAccessToken(true);
        onSuccess();
      } else {
        const res = await authClient.signUp.email({
          email: trimmedEmail,
          password,
          name: fullName.trim(),
        });
        if (res.error) {
          setErrorMsg(
            res.error.message || 'Gagal mendaftarkan akun. Pastikan email belum terdaftar.',
          );
          return;
        }
        setInfoMsg('Akun Neon Auth aktif. Menghubungkan sesi ke profil MyEkalliptus...');
        await getAccessToken(true);
        onSuccess();
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Terjadi kesalahan koneksi saat menghubungi layanan auth.',
      );
    } finally {
      setPending(false);
    }
  }

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

        <ThemeToggleButton showLabel className="bg-surface hover:bg-surface-subtle" />
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
                : 'Daftar menggunakan email karyawan yang sudah tercatat di direktori HR untuk penautan RBAC otomatis.'}
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
                setMode('signin');
                setErrorMsg(null);
                setInfoMsg(null);
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
                setMode('signup');
                setErrorMsg(null);
                setInfoMsg(null);
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
              <div className="space-y-1.5">
                <label htmlFor={nameId} className="block text-xs font-semibold text-text-primary">
                  Nama Lengkap
                </label>
                <input
                  id={nameId}
                  type="text"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Sesuai data karyawan"
                  className="h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-text-primary focus:border-accent"
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label htmlFor={emailId} className="block text-xs font-semibold text-text-primary">
                Email Kerja
              </label>
              <input
                id={emailId}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@ekalliptus.com"
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
              <input
                id={passwordId}
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimal 8 karakter"
                className="h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-text-primary focus:border-accent"
              />
            </div>

            <button
              type="submit"
              disabled={pending}
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
      </main>

      <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-xs text-text-secondary">
        <span>MyEkalliptus Enterprise Resource Planning</span>
        <span>Kontak Resmi: alul@ekalliptus.com</span>
      </footer>
    </div>
  );
}
