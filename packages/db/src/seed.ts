import { config } from 'dotenv';
import { and, eq, inArray } from 'drizzle-orm';
import { createDirectDb } from './client.js';
import {
  employees,
  finance_accounts,
  finance_categories,
  office_locations,
  permissions,
  role_permissions,
  roles,
  warehouses,
} from './schema.js';

config({ path: '.env.local' });
config({ path: '.env' });

const MODULES = ['finance', 'inventory', 'attendance', 'payroll', 'rbac', 'audit'] as const;
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
