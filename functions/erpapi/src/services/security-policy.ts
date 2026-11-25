import { hasPermission } from '@ekalliptus/contracts';

const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/;

export const ALLOWED_PORTFOLIO_UPLOAD_MIMES = new Set([
  'image/webp',
  'image/png',
  'image/jpeg',
  'image/avif',
]);

export function isAllowedPortfolioImageMime(contentType: string): boolean {
  return ALLOWED_PORTFOLIO_UPLOAD_MIMES.has(contentType.trim().toLowerCase());
}

export function isSafePortfolioObjectKey(key: string): boolean {
  return isSafeObjectKey(key) && key.startsWith('portfolio/');
}

export function isSafePrintObjectKey(key: string): boolean {
  return isSafeObjectKey(key) && key.startsWith('print-jobs/');
}

export function slugifyPortfolioTitle(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

export function isSafeHttpsUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw.trim());
    return parsed.protocol === 'https:' && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

export function isSafeObjectKey(key: string): boolean {
  if (!key || CONTROL_CHARS_RE.test(key)) return false;
  if (key.includes('\\') || key.startsWith('/') || key.endsWith('/')) return false;
  const segments = key.split('/');
  if (segments.length < 2) return false;
  return segments.every((seg) => seg.length > 0 && seg !== '.' && seg !== '..');
}

export function canViewAllEmployeesData(roleCode: string): boolean {
  return roleCode === 'owner' || roleCode === 'hr' || roleCode === 'finance';
}

export interface StorageDownloadDecisionInput {
  key: string;
  roleCode: string;
  employeeId: string;
  employeeCode: string;
  permissions: Iterable<string>;
  ownsSlipObject?: () => Promise<boolean>;
}

export async function authorizeStorageDownload(
  input: StorageDownloadDecisionInput,
): Promise<{ allowed: boolean; reason?: string }> {
  if (!isSafeObjectKey(input.key)) {
    return { allowed: false, reason: 'invalid_key' };
  }

  const segments = input.key.split('/');
  const [top, second, third] = segments;

  if (top === 'receipt' || top === 'selfie' || top === 'avatar') {
    return segments.length >= 3 && second === input.employeeId
      ? { allowed: true }
      : { allowed: false, reason: 'owner_mismatch' };
  }

  if (top === 'slips') {
    if (!hasPermission(input.permissions, 'payroll', 'view')) {
      return { allowed: false, reason: 'missing_payroll_view' };
    }
    if (canViewAllEmployeesData(input.roleCode)) {
      return { allowed: true };
    }
    if (segments.length !== 3 || third !== `${input.employeeCode}.pdf`) {
      return { allowed: false, reason: 'slip_employee_mismatch' };
    }
    if (!input.ownsSlipObject) {
      return { allowed: false, reason: 'missing_ownership_check' };
    }
    const owned = await input.ownsSlipObject();
    return owned ? { allowed: true } : { allowed: false, reason: 'slip_not_owned' };
  }

  if (top === 'invoices') {
    return segments.length >= 2 && hasPermission(input.permissions, 'finance', 'view')
      ? { allowed: true }
      : { allowed: false, reason: 'missing_finance_view' };
  }

  if (top === 'product') {
    return segments.length >= 2 && hasPermission(input.permissions, 'inventory', 'view')
      ? { allowed: true }
      : { allowed: false, reason: 'missing_inventory_view' };
  }

  if (top === 'portfolio') {
    return segments.length >= 3 && hasPermission(input.permissions, 'portfolio', 'view')
      ? { allowed: true }
      : { allowed: false, reason: 'missing_portfolio_view' };
  }

  if (top === 'print-jobs') {
    return segments.length >= 2 && hasPermission(input.permissions, 'printer', 'view')
      ? { allowed: true }
      : { allowed: false, reason: 'missing_printer_view' };
  }

  return { allowed: false, reason: 'forbidden_prefix' };
}

export interface MeKpiScopes {
  canViewFinance: boolean;
  canViewInventory: boolean;
  canApproveAttendance: boolean;
  canManagePayroll: boolean;
}

export function resolveMeKpiScopes(
  roleCode: string,
  permissions: Iterable<string>,
): MeKpiScopes {
  return {
    canViewFinance: hasPermission(permissions, 'finance', 'view'),
    canViewInventory: hasPermission(permissions, 'inventory', 'view'),
    canApproveAttendance: hasPermission(permissions, 'attendance', 'approve'),
    canManagePayroll: canViewAllEmployeesData(roleCode),
  };
}
