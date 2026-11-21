import type { Hono } from 'hono';
import type { AppEnv } from '../types.js';

export interface ErpModulePlugin {
  id: string;
  basePath: string;
  router: Hono<AppEnv>;
}

export function registerErpPlugins(app: Hono<AppEnv>, plugins: ErpModulePlugin[]): void {
  for (const plugin of plugins) {
    app.route(plugin.basePath, plugin.router);
  }
}
