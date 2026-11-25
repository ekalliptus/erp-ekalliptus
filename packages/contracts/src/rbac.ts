export const ERP_MODULES = [
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

export const ERP_ACTIONS = [
  'view',
  'create',
  'update',
  'delete',
  'approve',
  'export',
] as const;

export const ROLE_CODES = [
  'owner',
  'finance',
  'warehouse',
  'hr',
  'staff',
] as const;

export type ErpModule = (typeof ERP_MODULES)[number];
export type ErpAction = (typeof ERP_ACTIONS)[number];
export type RoleCode = (typeof ROLE_CODES)[number];
export type PermissionKey = `${ErpModule}:${ErpAction}`;
export type PlatformKind = 'web' | 'flutter' | 'system';

export function hasPermission(
  permissions: Iterable<string>,
  module: ErpModule,
  action: ErpAction,
): boolean {
  const target: PermissionKey = `${module}:${action}`;
  for (const p of permissions) {
    if (p === target) return true;
  }
  return false;
}
