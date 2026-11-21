import type { PlatformKind, RoleCode } from '@ekalliptus/contracts';

export interface AuthEmployee {
  id: string;
  auth_user_id: string | null;
  role_id: string;
  employee_code: string;
  full_name: string;
  email: string;
  phone: string | null;
  base_salary: bigint;
  is_active: boolean;
  avatar_object_key: string | null;
}

export interface AuthContext {
  authUserId: string;
  employee: AuthEmployee;
  roleCode: RoleCode;
  roleName: string;
  permissions: Set<string>;
  platform: PlatformKind;
}

export type AppEnv = {
  Variables: {
    auth: AuthContext;
  };
};
