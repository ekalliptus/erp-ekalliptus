import type { PlatformKind, RoleCode } from '@ekalliptus/contracts';
import { employees, permissions, role_permissions, roles } from '@ekalliptus/db';
import { eq, isNull, and, sql } from 'drizzle-orm';
import type { Context, Next } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getDb } from '../db.js';
import type { AppEnv } from '../types.js';

let jwksClient: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedIssuer: string | null = null;

function getJwtVerifier() {
  const jwksUrl = process.env.NEON_AUTH_JWKS_URL;
  const authBaseUrl = process.env.NEON_AUTH_BASE_URL;
  if (!jwksUrl || !authBaseUrl) {
    throw new Error('NEON_AUTH_JWKS_URL and NEON_AUTH_BASE_URL are required.');
  }
  if (!jwksClient) {
    jwksClient = createRemoteJWKSet(new URL(jwksUrl));
    cachedIssuer = new URL(authBaseUrl).origin;
  }
  return { jwks: jwksClient, issuer: cachedIssuer! };
}

function parsePlatform(headerValue: string | undefined): PlatformKind {
  if (headerValue === 'flutter' || headerValue === 'web' || headerValue === 'system') {
    return headerValue;
  }
  return 'web';
}

export function extractBearerToken(c: Context, allowQueryToken = false): string | null {
  const authHeader = c.req.header('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) return token;
  }
  if (allowQueryToken) {
    const q = c.req.query('token')?.trim();
    if (q) return q;
  }
  return null;
}

export function createAuthMiddleware(allowQueryToken = false) {
  return async (c: Context<AppEnv>, next: Next) => {
    const token = extractBearerToken(c, allowQueryToken);
    if (!token) {
      return c.json({ error: 'Unauthorized: missing Bearer token.' }, 401);
    }

    let sub: string;
    let tokenEmail: string | undefined;

    try {
      const { jwks, issuer } = getJwtVerifier();
      const { payload } = await jwtVerify(token, jwks, { issuer });
      if (!payload.sub) {
        return c.json({ error: 'Unauthorized: token missing subject.' }, 401);
      }
      sub = payload.sub;
      if (typeof payload.email === 'string') {
        tokenEmail = payload.email.trim().toLowerCase();
      }
    } catch {
      return c.json({ error: 'Unauthorized: invalid or expired session token.' }, 401);
    }

    const db = getDb();

    let [emp] = await db
      .select()
      .from(employees)
      .where(eq(employees.auth_user_id, sub))
      .limit(1);

    if (!emp && tokenEmail) {
      const [matchedByEmail] = await db
        .select()
        .from(employees)
        .where(
          and(
            sql`lower(${employees.email}) = ${tokenEmail}`,
            isNull(employees.auth_user_id),
          ),
        )
        .limit(1);

      if (matchedByEmail) {
        const [linked] = await db
          .update(employees)
          .set({ auth_user_id: sub })
          .where(and(eq(employees.id, matchedByEmail.id), isNull(employees.auth_user_id)))
          .returning();
        emp = linked ?? matchedByEmail;
      }
    }

    if (!emp) {
      return c.json(
        { error: 'Forbidden: no active employee profile mapped to this account.' },
        403,
      );
    }

    if (!emp.is_active) {
      return c.json({ error: 'Forbidden: employee account is deactivated.' }, 403);
    }

    const [roleRow] = await db
      .select()
      .from(roles)
      .where(eq(roles.id, emp.role_id))
      .limit(1);

    if (!roleRow) {
      return c.json({ error: 'Forbidden: employee role is missing.' }, 403);
    }

    const permRows = await db
      .select({
        module: permissions.module,
        action: permissions.action,
      })
      .from(role_permissions)
      .innerJoin(permissions, eq(permissions.id, role_permissions.permission_id))
      .where(eq(role_permissions.role_id, roleRow.id));

    const permissionSet = new Set(permRows.map((p) => `${p.module}:${p.action}`));

    c.set('auth', {
      authUserId: sub,
      employee: emp,
      roleCode: roleRow.code as RoleCode,
      roleName: roleRow.name,
      permissions: permissionSet,
      platform: parsePlatform(c.req.header('x-platform')),
    });

    await next();
  };
}
