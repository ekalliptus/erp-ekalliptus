import { createHash, randomBytes } from 'node:crypto';
import { config } from 'dotenv';
import { and, eq, inArray } from 'drizzle-orm';
import { createDirectDb } from './client.js';
import {
  app_releases,
  employees,
  finance_accounts,
  finance_categories,
  office_locations,
  permissions,
  print_pricing_rules,
  role_permissions,
  roles,
  warehouses,
} from './schema.js';

config({ path: '.env.local' });
config({ path: '.env' });

const MODULES = [
  'finance',
  'inventory',
  'attendance',
  'payroll',
  'rbac',
  'audit',
  'portfolio',
  'ai',
  'printer',
] as const;
const ACTIONS = ['view', 'create', 'update', 'delete', 'approve', 'export'] as const;

const ROLE_DEFS = [
  {
    code: 'owner',
    name: 'Owner',
    description: 'Full control over all ERP modules, approvals, payroll disbursement, and RBAC.',
  },
  {
    code: 'finance',
    name: 'Finance',
    description: 'Manages cash accounts, ledger transactions, invoices, obligations, and payroll payout.',
  },
  {
    code: 'warehouse',
    name: 'Warehouse',
    description: 'Manages inventory items, stock movements, purchase orders, and suppliers.',
  },
  {
    code: 'hr',
    name: 'Human Resources',
    description: 'Manages attendance verification, leave approvals, payroll runs, and staff roster.',
  },
  {
    code: 'staff',
    name: 'Staff',
    description: 'Daily attendance clock-in/out, leave requests, stock view, and personal payroll slips.',
  },
] as const;

const ROLE_MATRIX: Record<string, Array<[string, string]>> = {
  owner: MODULES.flatMap((m) => ACTIONS.map((a) => [m, a] as [string, string])),
  finance: [
    ...ACTIONS.map((a) => ['finance', a] as [string, string]),
    ['payroll', 'view'],
    ['payroll', 'approve'],
    ['payroll', 'export'],
    ['attendance', 'view'],
    ['audit', 'view'],
    ['printer', 'view'],
    ['printer', 'approve'],
    ['printer', 'update'],
  ],
  warehouse: [
    ...ACTIONS.map((a) => ['inventory', a] as [string, string]),
    ['attendance', 'view'],
    ['attendance', 'create'],
  ],
  hr: [
    ...ACTIONS.map((a) => ['attendance', a] as [string, string]),
    ['payroll', 'view'],
    ['payroll', 'create'],
    ['payroll', 'update'],
    ['payroll', 'export'],
    ['rbac', 'view'],
    ['rbac', 'create'],
    ['rbac', 'update'],
    ['audit', 'view'],
  ],
  staff: [
    ['attendance', 'view'],
    ['attendance', 'create'],
    ['inventory', 'view'],
    ['payroll', 'view'],
    ['printer', 'view'],
    ['printer', 'create'],
    ['printer', 'approve'],
  ],
};

export async function runSeed() {
  const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!conn) {
    throw new Error('DATABASE_URL_UNPOOLED or DATABASE_URL is required to run seed.');
  }

  const { pool, db } = createDirectDb(conn);

  try {
    await db.transaction(async (tx) => {
      for (const r of ROLE_DEFS) {
        await tx
          .insert(roles)
          .values(r)
          .onConflictDoUpdate({
            target: roles.code,
            set: { name: r.name, description: r.description },
          });
      }

      const permRows = MODULES.flatMap((module) =>
        ACTIONS.map((action) => ({ module, action })),
      );
      for (const p of permRows) {
        await tx
          .insert(permissions)
          .values(p)
          .onConflictDoNothing({ target: [permissions.module, permissions.action] });
      }

      const allRoles = await tx.select().from(roles);
      const allPerms = await tx.select().from(permissions);

      const permMap = new Map<string, string>();
      for (const p of allPerms) {
        permMap.set(`${p.module}:${p.action}`, p.id);
      }

      for (const role of allRoles) {
        const grants = ROLE_MATRIX[role.code] ?? [];
        const grantIds = grants
          .map(([m, a]) => permMap.get(`${m}:${a}`))
          .filter((id): id is string => Boolean(id));

        for (const permId of grantIds) {
          await tx
            .insert(role_permissions)
            .values({ role_id: role.id, permission_id: permId })
            .onConflictDoNothing({
              target: [role_permissions.role_id, role_permissions.permission_id],
            });
        }
      }

      const ownerRole = allRoles.find((r) => r.code === 'owner');
      if (!ownerRole) {
        throw new Error('Owner role missing after seed.');
      }

      const ownerEmail = (process.env.OWNER_EMAIL || 'alul@ekalliptus.com').trim().toLowerCase();
      await tx
        .insert(employees)
        .values({
          role_id: ownerRole.id,
          employee_code: 'EK-001',
          full_name: 'Alul (Owner)',
          email: ownerEmail,
          phone: '+62 819-9990-0306',
          base_salary: 15000000n,
          is_active: true,
        })
        .onConflictDoUpdate({
          target: employees.email,
          set: {
            role_id: ownerRole.id,
            full_name: 'Alul (Owner)',
            is_active: true,
          },
        });

      // Kode aktivasi owner: dibuat hanya saat owner belum diklaim dan belum
      // punya kode, lalu dicetak sekali di output seed. Simpan dengan aman.
      const [ownerRow] = await tx
        .select()
        .from(employees)
        .where(eq(employees.email, ownerEmail))
        .limit(1);
      if (ownerRow && !ownerRow.auth_user_id && !ownerRow.claim_code_hash) {
        const claimCode = 'EK-' + randomBytes(16)
          .toString('base64url')
          .replace(/[^A-Za-z0-9]/g, '')
          .slice(0, 10)
          .toUpperCase();
        const claimHash = createHash('sha256').update(claimCode).digest('hex');
        await tx
          .update(employees)
          .set({ claim_code_hash: claimHash })
          .where(eq(employees.id, ownerRow.id));
        console.log('');
        console.log('=== KODE AKTIVASI OWNER (sekali tampil, simpan aman) ===');
        console.log('Email :', ownerEmail);
        console.log('Kode  :', claimCode);
        console.log('========================================================');
      }

      const defaultAccounts = [
        { name: 'Kas Operasional', type: 'cash', account_number: 'KAS-01', balance: 0n },
        { name: 'BCA Bisnis', type: 'bank', account_number: '047-990-2026', balance: 0n },
        { name: 'GoPay Bisnis', type: 'ewallet', account_number: '081999900306', balance: 0n },
        { name: 'QRIS Merchant', type: 'qris', account_number: 'QRIS-EK-01', balance: 0n },
      ];
      for (const acc of defaultAccounts) {
        await tx
          .insert(finance_accounts)
          .values(acc)
          .onConflictDoNothing({ target: finance_accounts.name });
      }

      const defaultCategories = [
        { name: 'Penjualan Layanan Digital', kind: 'income' },
        { name: 'Pembayaran Invoice Klien', kind: 'income' },
        { name: 'Penjualan Produk Hardware', kind: 'income' },
        { name: 'Jasa Cetak & Print', kind: 'income' },
        { name: 'Biaya Operasional Kantor', kind: 'expense' },
        { name: 'Penggajian Karyawan', kind: 'expense' },
        { name: 'Pembelian Stok & Supplier', kind: 'expense' },
        { name: 'Cloud & Utilitas', kind: 'expense' },
      ];
      for (const cat of defaultCategories) {
        await tx
          .insert(finance_categories)
          .values(cat)
          .onConflictDoNothing({ target: [finance_categories.name, finance_categories.kind] });
      }

      const defaultPrintPricing = [
        { paper_size: 'a4', color_mode: 'mono', price_per_page: 500n, duplex_discount_per_page: 0n },
        { paper_size: 'a4', color_mode: 'color', price_per_page: 1500n, duplex_discount_per_page: 0n },
        { paper_size: 'f4', color_mode: 'mono', price_per_page: 600n, duplex_discount_per_page: 0n },
        { paper_size: 'f4', color_mode: 'color', price_per_page: 1800n, duplex_discount_per_page: 0n },
        { paper_size: 'legal', color_mode: 'mono', price_per_page: 600n, duplex_discount_per_page: 0n },
        { paper_size: 'legal', color_mode: 'color', price_per_page: 1800n, duplex_discount_per_page: 0n },
        { paper_size: 'letter', color_mode: 'mono', price_per_page: 500n, duplex_discount_per_page: 0n },
        { paper_size: 'letter', color_mode: 'color', price_per_page: 1500n, duplex_discount_per_page: 0n },
        { paper_size: 'a5', color_mode: 'mono', price_per_page: 400n, duplex_discount_per_page: 0n },
        { paper_size: 'a5', color_mode: 'color', price_per_page: 1000n, duplex_discount_per_page: 0n },
        { paper_size: '4x6', color_mode: 'mono', price_per_page: 2000n, duplex_discount_per_page: 0n },
        { paper_size: '4x6', color_mode: 'color', price_per_page: 3500n, duplex_discount_per_page: 0n },
        { paper_size: '5x7', color_mode: 'mono', price_per_page: 3000n, duplex_discount_per_page: 0n },
        { paper_size: '5x7', color_mode: 'color', price_per_page: 5000n, duplex_discount_per_page: 0n },
      ];
      for (const rule of defaultPrintPricing) {
        await tx
          .insert(print_pricing_rules)
          .values({
            ...rule,
            currency: 'IDR',
            is_active: true,
          })
          .onConflictDoNothing({
            target: [print_pricing_rules.paper_size, print_pricing_rules.color_mode],
          });
      }

      await tx
        .insert(warehouses)
        .values({
          name: 'Gudang Utama Ekalliptus',
          address: 'Tegal, Jawa Tengah',
          is_default: true,
        })
        .onConflictDoNothing({ target: warehouses.name });

      await tx
        .insert(office_locations)
        .values({
          name: 'Kantor Ekalliptus Tegal',
          latitude: -6.8694,
          longitude: 109.1402,
          radius_meters: 250,
          work_start_time: '09:00',
          work_end_time: '17:00',
        })
        .onConflictDoNothing({ target: office_locations.name });

      const baselineReleases = [
        {
          version: '1.0.0',
          build_number: 1,
          title: 'Rilis Awal MyEkalliptus ERP',
          published_at: new Date('2026-11-20T09:00:00+07:00'),
          changelog: [
            'Keuangan, Inventaris, Absensi Geofence & Payroll terintegrasi 5 layanan Neon',
            'RBAC 5 role dengan Audit Trail immutable, Neon Realtime & Notifikasi Push FCM',
          ],
        },
        {
          version: '1.1.0',
          build_number: 2,
          title: 'Absensi 1-Tap, Peta Kantor & Profil per Role',
          published_at: new Date('2026-11-22T10:00:00+07:00'),
          changelog: [
            'Absensi 1-Tap Biometrik & Scan Wajah dengan telemetri GPS, perangkat, dan IP',
            'Halaman Setup Izin Sensor, Pengaturan Posisi Kantor di Maps (Owner), dan Profil Role',
          ],
        },
        {
          version: '1.2.0',
          build_number: 3,
          title: 'Owner User Manager, Presensi 1-Klik Web & Info Pembaruan',
          published_at: new Date('2026-11-22T18:45:00+07:00'),
          changelog: [
            'Owner User & Employee Manager (CRUD karyawan, kode aktivasi, putus tautan, hapus aman & matriks role)',
            'Presensi 1-Klik Web dengan verifikasi webcam/QR & pembacaan GPS otomatis',
            'Info versi aplikasi, riwayat changelog, cek update manual, dan popup pembaruan otomatis',
          ],
        },
        {
          version: '1.3.0',
          build_number: 4,
          title: 'Scan Wajah 4 Tahap, Profil Wajah, Sinkron Avatar & Perbaikan Kasir POS',
          published_at: new Date('2026-11-23T08:30:00+07:00'),
          changelog: [
            'Pendaftaran scan wajah 4 sudut dengan panduan bertahap, deteksi akurat, dan toleransi pencahayaan lebih baik',
            'Menu Data Wajah di halaman Profil Web & Android untuk melihat status, perbarui, dan hapus wajah terdaftar',
            'Sinkronisasi langsung foto profil pada avatar header Beranda Web & Android',
            'Perbaikan posisi bottom sheet Tambah Item Manual Kasir POS agar bebas dari dock navigasi floating',
            'Penghapusan tombol download duplikat di header halaman login web',
          ],
        },
      ];

      for (const platform of ['android', 'web'] as const) {
        for (const rel of baselineReleases) {
          await tx
            .insert(app_releases)
            .values({
              platform,
              version: rel.version,
              build_number: rel.build_number,
              title: rel.title,
              changelog: rel.changelog,
              download_url: 'https://my.ekalliptus.com',
              is_mandatory: false,
              is_published: true,
              published_at: rel.published_at,
            })
            .onConflictDoNothing({
              target: [app_releases.platform, app_releases.build_number],
            });
        }
      }

      const existingOwnerPerms = await tx
        .select()
        .from(role_permissions)
        .where(
          and(
            eq(role_permissions.role_id, ownerRole.id),
            inArray(role_permissions.permission_id, Array.from(permMap.values())),
          ),
        );

      console.log(
        `Seed complete: ${allRoles.length} roles, ${allPerms.length} permissions, ${existingOwnerPerms.length} owner grants, owner=${ownerEmail}`,
      );
    });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed.ts')) {
  runSeed().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
