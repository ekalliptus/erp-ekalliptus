import { importPKCS8, SignJWT } from 'jose';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const SEND_CONCURRENCY = 5;

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

let cachedAccount: ServiceAccount | null | undefined;
let cachedAccessToken: CachedToken | null = null;

function resolveServiceAccount(): ServiceAccount | null {
  if (cachedAccount !== undefined) return cachedAccount;
  cachedAccount = null;
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw || raw.trim() === '') return null;
  try {
    const parsed = JSON.parse(raw) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
      token_uri?: string;
    };
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      console.warn('[fcm] FCM_SERVICE_ACCOUNT_JSON tidak lengkap (butuh project_id, client_email, private_key).');
      return null;
    }
    cachedAccount = {
      project_id: parsed.project_id,
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, '\n'),
      token_uri: parsed.token_uri ?? 'https://oauth2.googleapis.com/token',
    };
  } catch (err) {
    console.warn('[fcm] FCM_SERVICE_ACCOUNT_JSON bukan JSON valid:', err instanceof Error ? err.message : err);
  }
  return cachedAccount;
}

export function isFcmConfigured(): boolean {
  return resolveServiceAccount() !== null;
}

async function getAccessToken(): Promise<string> {
  const account = resolveServiceAccount();
  if (!account) throw new Error('FCM service account belum dikonfigurasi.');
  const nowMs = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAtMs - nowMs > 60_000) {
    return cachedAccessToken.token;
  }

  const iat = Math.floor(nowMs / 1000);
  const key = await importPKCS8(account.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: FCM_SCOPE })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(account.client_email)
    .setAudience(account.token_uri)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(key);

  const res = await fetch(account.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google token exchange gagal (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('Token exchange Google tidak mengembalikan access_token.');
  cachedAccessToken = {
    token: data.access_token,
    expiresAtMs: nowMs + (data.expires_in ?? 3600) * 1000,
  };
  return cachedAccessToken.token;
}

export interface FcmPayload {
  title: string;
  body: string;
  data: Record<string, string>;
  link?: string;
}

export interface FcmSendResult {
  sent: number;
  failed: number;
  deadTokens: string[];
}

export async function sendFcmToTokens(
  tokens: string[],
  payload: FcmPayload,
): Promise<FcmSendResult> {
  const result: FcmSendResult = { sent: 0, failed: 0, deadTokens: [] };
  const usable = tokens.filter((t) => typeof t === 'string' && t.length > 0);
  if (usable.length === 0 || !isFcmConfigured()) return result;

  const account = resolveServiceAccount();
  if (!account) return result;
  const accessToken = await getAccessToken();
  const endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;

  for (let i = 0; i < usable.length; i += SEND_CONCURRENCY) {
    const batch = usable.slice(i, i + SEND_CONCURRENCY);
    const outcomes = await Promise.allSettled(
      batch.map(async (token) => {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: payload.title, body: payload.body },
              data: payload.data,
              android: {
                priority: 'HIGH',
                notification: { sound: 'default' },
              },
              webpush: {
                headers: { Urgency: 'high' },
                ...(payload.link ? { fcm_options: { link: payload.link } } : {}),
              },
            },
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          result.sent += 1;
          return;
        }
        const text = await res.text().catch(() => '');
        if (
          res.status === 404 ||
          res.status === 410 ||
          (res.status === 400 &&
            (text.includes('UNREGISTERED') || text.includes('not a valid FCM registration token')))
        ) {
          result.deadTokens.push(token);
          return;
        }
        result.failed += 1;
        console.warn(`[fcm] kirim gagal (HTTP ${res.status}): ${text.slice(0, 160)}`);
      }),
    );
    for (const o of outcomes) {
      if (o.status === 'rejected') {
        result.failed += 1;
        console.warn('[fcm] kirim gagal:', o.reason instanceof Error ? o.reason.message : o.reason);
      }
    }
  }

  return result;
}
