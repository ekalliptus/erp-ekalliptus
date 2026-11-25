import type { PlatformKind, RoleCode } from '@ekalliptus/contracts';
import type { print_devices } from '@ekalliptus/db';

export interface AuthEmployee {
  id: string;
  auth_user_id: string | null;
  role_id: string;
  employee_code: string;
  full_name: string;
  email: string;
  username: string | null;
  phone: string | null;
  base_salary: bigint;
  is_active: boolean;
  avatar_object_key: string | null;
  created_at: Date;
}

export interface AuthContext {
  authUserId: string;
  employee: AuthEmployee;
  roleCode: RoleCode;
  roleName: string;
  roleDescription: string;
  permissions: Set<string>;
  platform: PlatformKind;
}

export type AppEnv = {
  Variables: {
    auth: AuthContext;
    printDevice?: typeof print_devices.$inferSelect;
  };
};
