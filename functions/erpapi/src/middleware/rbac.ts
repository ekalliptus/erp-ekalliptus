import { hasPermission, type ErpAction, type ErpModule } from '@ekalliptus/contracts';
import type { Context, Next } from 'hono';
import type { AppEnv } from '../types.js';

export function requirePermission(module: ErpModule, action: ErpAction) {
  return async (c: Context<AppEnv>, next: Next) => {
    const auth = c.get('auth');
    if (!auth) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    if (!hasPermission(auth.permissions, module, action)) {
      return c.json(
        {
          error: 'Forbidden: insufficient permissions.',
          required: `${module}:${action}`,
          role: auth.roleCode,
        },
        403,
      );
    }
    await next();
  };
}
