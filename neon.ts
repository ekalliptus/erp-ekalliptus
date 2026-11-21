import { readFileSync } from 'node:fs';
import { defineConfig } from '@neon/config/v1';

// Service account FCM disimpan di .secrets/fcm-service-account.json (di luar git).
// Jika file ada, isinya di-inline sebagai env function saat deploy.
try {
  const fcmSecretPath = './.secrets/fcm-service-account.json';
  if (!process.env.FCM_SERVICE_ACCOUNT_JSON) {
    process.env.FCM_SERVICE_ACCOUNT_JSON = readFileSync(fcmSecretPath, 'utf8');
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
