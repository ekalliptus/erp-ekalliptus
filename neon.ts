import { defineConfig } from '@neon/config/v1';

export default defineConfig({
  preview: {
    realtime: true,
  },
  auth: true,
  functions: {
    erpapi: {
      name: 'Ekalliptus ERP API',
      source: './functions/erpapi/src/index.ts',
      env: {
        ERP_REALTIME_SECRET: { value: process.env.NEON_REALTIME_SECRET, required: true },
      },
    },
  },
  buckets: {
    assets: { access: 'private' },
  },
  branch: (branch) => {
    if (branch.isDefault) {
      return {};
    }
    if (!branch.exists) {
      return { ttl: '7d' };
    }
    return {};
  },
});
