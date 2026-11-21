import { createAuthClient } from '@neon/auth';
import { BetterAuthReactAdapter } from '@neon/auth/react/adapters';

const neonAuthUrl = import.meta.env.VITE_NEON_AUTH_URL;
if (!neonAuthUrl) {
  throw new Error('VITE_NEON_AUTH_URL belum dikonfigurasi pada environment.');
}

export const authClient = createAuthClient(neonAuthUrl, {
  adapter: BetterAuthReactAdapter(),
});

let cachedToken: string | null = null;
let cachedExpMs = 0;

function readJwtExpiryMs(jwt: string): number {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return 0;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export function clearAccessTokenCache(): void {
  cachedToken = null;
  cachedExpMs = 0;
}

type SessionLikeClient = typeof authClient & {
  getSession: (opts?: {
    fetchOptions?: { headers?: Record<string, string> };
  }) => Promise<{ data?: { session?: { token?: string }; token?: string } | null }>;
  token: (opts?: {
    fetchOptions?: { headers?: Record<string, string> };
  }) => Promise<{ data?: { token?: string; session?: { token?: string } } | null }>;
};

function isJwtString(val: string | null | undefined): val is string {
  return typeof val === 'string' && val.split('.').length === 3;
}

export async function getAccessToken(forceRefresh = false): Promise<string | null> {
  const now = Date.now();
  if (!forceRefresh && cachedToken && cachedExpMs - now > 60_000) {
    return cachedToken;
  }

  const client = authClient as unknown as SessionLikeClient;

  // @neon/auth caches GET /get-session and injects the `set-auth-jwt` JWT into `data.session.token`.
  const sessionRes = await client.getSession(
    forceRefresh ? { fetchOptions: { headers: { 'X-Force-Fetch': 'true' } } } : undefined,
  );
  const sessionObj = sessionRes?.data as {
    session?: { token?: string };
    token?: string;
  } | null;
  const sessionCandidate = sessionObj?.session?.token ?? sessionObj?.token ?? null;

  let token = isJwtString(sessionCandidate) ? sessionCandidate : null;

  if (!token) {
    const tokenRes = await client.token({
      fetchOptions: { headers: { 'X-Force-Fetch': 'true' } },
    });
    const tokObj = tokenRes?.data as {
      token?: string;
      session?: { token?: string };
    } | null;
    const directCandidate = tokObj?.token ?? tokObj?.session?.token ?? null;
    if (isJwtString(directCandidate)) {
      token = directCandidate;
    }
  }

  if (!token) {
    const rawRes = await fetch(`${neonAuthUrl.replace(/\/+$/, '')}/get-session`, {
      method: 'GET',
      credentials: 'include',
    }).catch(() => null);
    const hdrJwt = rawRes?.headers.get('set-auth-jwt') ?? null;
    if (isJwtString(hdrJwt)) {
      token = hdrJwt;
    }
  }

  if (!token) {
    clearAccessTokenCache();
    return null;
  }

  cachedToken = token;
  cachedExpMs = readJwtExpiryMs(token) || now + 10 * 60_000;
  return cachedToken;
}
