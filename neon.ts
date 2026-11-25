import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from '@neon/config/v1';

// Service account FCM disimpan di .secrets/ (di luar git). Nama kanonik:
// fcm-service-account.json, tapi nama asli unduhan Firebase juga diterima.
// Isinya di-inline sebagai env function saat deploy.
try {
  if (!process.env.FCM_SERVICE_ACCOUNT_JSON) {
    const canonical = './.secrets/fcm-service-account.json';
    if (existsSync(canonical)) {
      process.env.FCM_SERVICE_ACCOUNT_JSON = readFileSync(canonical, 'utf8');
    } else {
      const { readdirSync } = await import('node:fs');
      const candidates = readdirSync('./.secrets')
        .filter((f) => f.endsWith('.json'))
        .sort();
      if (candidates.length > 0) {
        process.env.FCM_SERVICE_ACCOUNT_JSON = readFileSync(
          `./.secrets/${candidates[0]}`,
          'utf8',
        );
      }
    }
  }
} catch {
  // File belum tersedia: notifikasi berjalan mode in-app tanpa push keluar.
}

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
        FCM_SERVICE_ACCOUNT_JSON: { value: process.env.FCM_SERVICE_ACCOUNT_JSON, required: false },
        AI_ENCRYPTION_KEY: { value: process.env.AI_ENCRYPTION_KEY, required: false },
        WEB_ALLOWED_ORIGINS: {
          value:
            process.env.WEB_ALLOWED_ORIGINS ||
            'https://my.ekalliptus.com,https://ekalliptus.com',
          required: false,
        },
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
