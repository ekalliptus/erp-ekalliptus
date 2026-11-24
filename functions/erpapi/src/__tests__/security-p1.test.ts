import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  authorizeStorageDownload,
  canViewAllEmployeesData,
  isSafeObjectKey,
  resolveMeKpiScopes,
} from '../services/security-policy.js';

const STAFF_PERMS = ['attendance:view', 'attendance:create', 'inventory:view', 'payroll:view'];
const WAREHOUSE_PERMS = ['inventory:view', 'inventory:create', 'attendance:view', 'attendance:create'];
const HR_PERMS = ['attendance:view', 'attendance:approve', 'payroll:view', 'payroll:create'];
const FINANCE_PERMS = ['finance:view', 'finance:approve', 'payroll:view', 'payroll:approve'];
const OWNER_PERMS = [
  'finance:view',
  'inventory:view',
  'attendance:view',
  'attendance:approve',
  'payroll:view',
  'payroll:approve',
  'rbac:view',
  'audit:view',
];

describe('isSafeObjectKey', () => {
  it('rejects traversal, empty, backslash, leading/trailing slashes, and control characters', () => {
    const unsafe = [
      '',
      'single',
      'slips/../other/EK-001.pdf',
      'slips/./EK-001.pdf',
      '/slips/run/EK-001.pdf',
      'slips/run/EK-001.pdf/',
      'slips\\run\\EK-001.pdf',
      'slips//EK-001.pdf',
      'slips/run\x00/EK-001.pdf',
    ];
    for (const key of unsafe) {
      assert.equal(isSafeObjectKey(key), false, `Expected unsafe key to be rejected: ${key}`);
    }
  });

  it('accepts structured non-traversal keys', () => {
    assert.equal(isSafeObjectKey('slips/run-1/EK-002.pdf'), true);
    assert.equal(isSafeObjectKey('avatar/emp-1/photo.webp'), true);
    assert.equal(isSafeObjectKey('invoices/inv-1.pdf'), true);
  });
});

describe('authorizeStorageDownload (APP-ERP-01)', () => {
  it('blocks staff from downloading another employee payroll slip PDF', async () => {
    const decision = await authorizeStorageDownload({
      key: 'slips/run-1/EK-001.pdf',
      roleCode: 'staff',
      employeeId: 'emp-2',
      employeeCode: 'EK-002',
      permissions: STAFF_PERMS,
      ownsSlipObject: async () => true,
    });
    assert.equal(decision.allowed, false);
  });

  it('blocks staff when slip ownership verification returns false or is absent', async () => {
    const notOwned = await authorizeStorageDownload({
      key: 'slips/run-1/EK-002.pdf',
      roleCode: 'staff',
      employeeId: 'emp-2',
      employeeCode: 'EK-002',
      permissions: STAFF_PERMS,
      ownsSlipObject: async () => false,
    });
    assert.equal(notOwned.allowed, false);

    const noChecker = await authorizeStorageDownload({
      key: 'slips/run-1/EK-002.pdf',
      roleCode: 'staff',
      employeeId: 'emp-2',
      employeeCode: 'EK-002',
      permissions: STAFF_PERMS,
    });
    assert.equal(noChecker.allowed, false);

    const extraSeg = await authorizeStorageDownload({
      key: 'slips/run-1/nested/EK-002.pdf',
      roleCode: 'staff',
      employeeId: 'emp-2',
      employeeCode: 'EK-002',
      permissions: STAFF_PERMS,
      ownsSlipObject: async () => true,
    });
    assert.equal(extraSeg.allowed, false);
  });

  it('allows staff to download their own verified payroll slip PDF', async () => {
    const decision = await authorizeStorageDownload({
      key: 'slips/run-1/EK-002.pdf',
      roleCode: 'staff',
      employeeId: 'emp-2',
      employeeCode: 'EK-002',
      permissions: STAFF_PERMS,
      ownsSlipObject: async () => true,
    });
    assert.equal(decision.allowed, true);
  });

  it('allows owner, hr, and finance to download payroll slips', async () => {
    for (const [role, perms] of [
      ['owner', OWNER_PERMS],
      ['hr', HR_PERMS],
      ['finance', FINANCE_PERMS],
    ] as const) {
      const decision = await authorizeStorageDownload({
        key: 'slips/run-1/EK-001.pdf',
        roleCode: role,
        employeeId: 'emp-x',
        employeeCode: 'EK-999',
        permissions: perms,
      });
      assert.equal(decision.allowed, true, `Expected ${role} to download payroll slip`);
    }
  });

  it('enforces per-employee ownership on avatar, selfie, and receipt objects', async () => {
    assert.equal(
      (
        await authorizeStorageDownload({
          key: 'avatar/emp-other/pic.png',
          roleCode: 'staff',
          employeeId: 'emp-self',
          employeeCode: 'EK-002',
          permissions: STAFF_PERMS,
        })
      ).allowed,
      false,
    );
    assert.equal(
      (
        await authorizeStorageDownload({
          key: 'avatar/emp-self/pic.png',
          roleCode: 'staff',
          employeeId: 'emp-self',
          employeeCode: 'EK-002',
          permissions: STAFF_PERMS,
        })
      ).allowed,
      true,
    );
    assert.equal(
      (
        await authorizeStorageDownload({
          key: 'selfie/emp-other/in.jpg',
          roleCode: 'owner',
          employeeId: 'emp-self',
          employeeCode: 'EK-001',
          permissions: OWNER_PERMS,
        })
      ).allowed,
      false,
    );
  });

  it('enforces module permissions on invoices, product images, and unknown prefixes', async () => {
    assert.equal(
      (
        await authorizeStorageDownload({
          key: 'invoices/inv-1.pdf',
          roleCode: 'staff',
          employeeId: 'emp-2',
          employeeCode: 'EK-002',
          permissions: STAFF_PERMS,
        })
      ).allowed,
      false,
    );
    assert.equal(
      (
        await authorizeStorageDownload({
          key: 'invoices/inv-1.pdf',
          roleCode: 'finance',
          employeeId: 'emp-3',
          employeeCode: 'EK-003',
          permissions: FINANCE_PERMS,
        })
      ).allowed,
      true,
    );
    assert.equal(
      (
        await authorizeStorageDownload({
          key: 'product/item-1/img.png',
          roleCode: 'staff',
          employeeId: 'emp-2',
          employeeCode: 'EK-002',
          permissions: STAFF_PERMS,
        })
      ).allowed,
      true,
    );
    assert.equal(
      (
        await authorizeStorageDownload({
          key: 'releases/android/app.apk',
          roleCode: 'owner',
          employeeId: 'emp-1',
          employeeCode: 'EK-001',
          permissions: OWNER_PERMS,
        })
      ).allowed,
      false,
    );
  });
});

describe('resolveMeKpiScopes & canViewAllEmployeesData (APP-ERP-02)', () => {
  it('isolates finance/attendance-approval/payroll KPI scopes for non-managerial roles', () => {
    assert.deepEqual(resolveMeKpiScopes('staff', STAFF_PERMS), {
      canViewFinance: false,
      canViewInventory: true,
      canApproveAttendance: false,
      canManagePayroll: false,
    });
    assert.deepEqual(resolveMeKpiScopes('warehouse', WAREHOUSE_PERMS), {
      canViewFinance: false,
      canViewInventory: true,
      canApproveAttendance: false,
      canManagePayroll: false,
    });
    assert.deepEqual(resolveMeKpiScopes('hr', HR_PERMS), {
      canViewFinance: false,
      canViewInventory: false,
      canApproveAttendance: true,
      canManagePayroll: true,
    });
    assert.deepEqual(resolveMeKpiScopes('finance', FINANCE_PERMS), {
      canViewFinance: true,
      canViewInventory: false,
      canApproveAttendance: false,
      canManagePayroll: true,
    });
    assert.deepEqual(resolveMeKpiScopes('owner', OWNER_PERMS), {
      canViewFinance: true,
      canViewInventory: true,
      canApproveAttendance: true,
      canManagePayroll: true,
    });

    assert.equal(canViewAllEmployeesData('staff'), false);
    assert.equal(canViewAllEmployeesData('warehouse'), false);
    assert.equal(canViewAllEmployeesData('owner'), true);
    assert.equal(canViewAllEmployeesData('hr'), true);
    assert.equal(canViewAllEmployeesData('finance'), true);
  });
});

describe('ERP Web security headers (INFRA-01)', () => {
  it('defines strict global security headers in apps/web/public/_headers', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
    const headersPath = path.join(repoRoot, 'apps', 'web', 'public', '_headers');
    const content = fs.readFileSync(headersPath, 'utf8');

    assert.match(content, /^\/\*\r?\n/m);
    assert.match(content, /Content-Security-Policy: .*frame-ancestors 'none'/);
    assert.match(content, /X-Frame-Options:\s*DENY/);
    assert.match(content, /X-Content-Type-Options:\s*nosniff/);
    assert.match(content, /Strict-Transport-Security:\s*max-age=31536000;\s*includeSubDomains/);
    assert.match(content, /Referrer-Policy:\s*strict-origin-when-cross-origin/);
    assert.match(content, /Permissions-Policy:\s*camera=\(self\)/);
  });
});
