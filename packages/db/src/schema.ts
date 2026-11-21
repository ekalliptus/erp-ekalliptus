import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
});

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    module: text('module').notNull(),
    action: text('action').notNull(),
  },
  (table) => [unique('permissions_module_action_uq').on(table.module, table.action)],
);

export const role_permissions = pgTable(
  'role_permissions',
  {
    role_id: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission_id: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.role_id, table.permission_id] })],
);

export const employees = pgTable('employees', {
  id: uuid('id').primaryKey().defaultRandom(),
  auth_user_id: text('auth_user_id').unique(),
  role_id: uuid('role_id')
    .notNull()
    .references(() => roles.id),
  employee_code: text('employee_code').notNull().unique(),
  full_name: text('full_name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  base_salary: bigint('base_salary', { mode: 'bigint' }).notNull().default(sql`0`),
  is_active: boolean('is_active').notNull().default(true),
  avatar_object_key: text('avatar_object_key'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const finance_accounts = pgTable(
  'finance_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    type: text('type').notNull(),
    account_number: text('account_number'),
    balance: bigint('balance', { mode: 'bigint' }).notNull().default(sql`0`),
    is_active: boolean('is_active').notNull().default(true),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check(
      'finance_accounts_type_chk',
      sql`type IN ('cash', 'bank', 'ewallet', 'qris')`,
    ),
  ],
);

export const finance_categories = pgTable(
  'finance_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
  },
  (table) => [
    unique('finance_categories_name_kind_uq').on(table.name, table.kind),
    check('finance_categories_kind_chk', sql`kind IN ('income', 'expense')`),
  ],
);

export const finance_transactions = pgTable(
  'finance_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    account_id: uuid('account_id')
      .notNull()
      .references(() => finance_accounts.id),
    target_account_id: uuid('target_account_id').references(() => finance_accounts.id),
    category_id: uuid('category_id').references(() => finance_categories.id),
    type: text('type').notNull(),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    description: text('description').notNull().default(''),
    reference_type: text('reference_type'),
    reference_id: uuid('reference_id'),
    receipt_object_key: text('receipt_object_key'),
    status: text('status').notNull().default('posted'),
    created_by: uuid('created_by')
      .notNull()
      .references(() => employees.id),
    approved_by: uuid('approved_by').references(() => employees.id),
    transacted_at: timestamp('transacted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('finance_tx_account_transacted_idx').on(table.account_id, table.transacted_at.desc()),
    check('finance_tx_amount_pos_chk', sql`amount > 0`),
    check('finance_tx_type_chk', sql`type IN ('income', 'expense', 'transfer')`),
    check('finance_tx_status_chk', sql`status IN ('pending', 'posted', 'void')`),
  ],
);

export const finance_obligations = pgTable(
  'finance_obligations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    counterparty_name: text('counterparty_name').notNull(),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    paid_amount: bigint('paid_amount', { mode: 'bigint' }).notNull().default(sql`0`),
    due_date: date('due_date'),
    status: text('status').notNull().default('open'),
    note: text('note'),
    created_by: uuid('created_by')
      .notNull()
      .references(() => employees.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check('finance_obligations_kind_chk', sql`kind IN ('receivable', 'payable')`),
    check('finance_obligations_amount_pos_chk', sql`amount > 0`),
    check('finance_obligations_status_chk', sql`status IN ('open', 'partial', 'paid', 'void')`),
  ],
);

export const warehouses = pgTable('warehouses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  address: text('address'),
  is_default: boolean('is_default').notNull().default(false),
});

export const inventory_items = pgTable('inventory_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  sku: text('sku').notNull().unique(),
  barcode: text('barcode').unique(),
  name: text('name').notNull(),
  unit: text('unit').notNull().default('pcs'),
  cost_price: bigint('cost_price', { mode: 'bigint' }).notNull().default(sql`0`),
  sell_price: bigint('sell_price', { mode: 'bigint' }).notNull().default(sql`0`),
  min_stock: integer('min_stock').notNull().default(0),
  image_object_key: text('image_object_key'),
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inventory_stocks = pgTable(
  'inventory_stocks',
  {
    item_id: uuid('item_id')
      .notNull()
      .references(() => inventory_items.id, { onDelete: 'cascade' }),
    warehouse_id: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    qty: integer('qty').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.item_id, table.warehouse_id] }),
    check('inventory_stocks_qty_nonneg_chk', sql`qty >= 0`),
  ],
);

export const stock_movements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    item_id: uuid('item_id')
      .notNull()
      .references(() => inventory_items.id),
    warehouse_id: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    movement_type: text('movement_type').notNull(),
    qty_delta: integer('qty_delta').notNull(),
    unit_cost: bigint('unit_cost', { mode: 'bigint' }).notNull().default(sql`0`),
    note: text('note'),
    created_by: uuid('created_by')
      .notNull()
      .references(() => employees.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('stock_movements_item_created_idx').on(table.item_id, table.created_at.desc()),
    check('stock_movements_type_chk', sql`movement_type IN ('in', 'out', 'adjustment', 'transfer')`),
  ],
);

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const purchase_orders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    po_number: text('po_number').notNull().unique(),
    supplier_id: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    warehouse_id: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    status: text('status').notNull().default('draft'),
    total_amount: bigint('total_amount', { mode: 'bigint' }).notNull().default(sql`0`),
    note: text('note'),
    created_by: uuid('created_by')
      .notNull()
      .references(() => employees.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check(
      'purchase_orders_status_chk',
      sql`status IN ('draft', 'ordered', 'received', 'cancelled')`,
    ),
  ],
);

export const office_locations = pgTable('office_locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  radius_meters: integer('radius_meters').notNull().default(150),
  work_start_time: text('work_start_time').notNull().default('09:00'),
  work_end_time: text('work_end_time').notNull().default('17:00'),
});

export const attendances = pgTable(
  'attendances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employee_id: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    office_id: uuid('office_id').references(() => office_locations.id),
    attendance_date: date('attendance_date').notNull(),
    clock_in_at: timestamp('clock_in_at', { withTimezone: true }),
    clock_out_at: timestamp('clock_out_at', { withTimezone: true }),
    clock_in_lat: doublePrecision('clock_in_lat'),
    clock_in_lng: doublePrecision('clock_in_lng'),
    clock_in_selfie_key: text('clock_in_selfie_key'),
    clock_out_selfie_key: text('clock_out_selfie_key'),
    status: text('status').notNull().default('present'),
    late_minutes: integer('late_minutes').notNull().default(0),
    overtime_minutes: integer('overtime_minutes').notNull().default(0),
    note: text('note'),
    approval_status: text('approval_status').notNull().default('approved'),
    approved_by: uuid('approved_by').references(() => employees.id),
  },
  (table) => [
    unique('attendances_employee_date_uq').on(table.employee_id, table.attendance_date),
    index('attendances_employee_date_idx').on(table.employee_id, table.attendance_date.desc()),
    check('attendances_status_chk', sql`status IN ('present', 'late', 'leave', 'sick', 'absent')`),
    check(
      'attendances_approval_status_chk',
      sql`approval_status IN ('pending', 'approved', 'rejected')`,
    ),
  ],
);

export const payroll_runs = pgTable(
  'payroll_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    period_start: date('period_start').notNull(),
    period_end: date('period_end').notNull(),
    status: text('status').notNull().default('draft'),
    total_disbursed: bigint('total_disbursed', { mode: 'bigint' }).notNull().default(sql`0`),
    finance_account_id: uuid('finance_account_id').references(() => finance_accounts.id),
    approved_by: uuid('approved_by').references(() => employees.id),
    paid_at: timestamp('paid_at', { withTimezone: true }),
    created_by: uuid('created_by')
      .notNull()
      .references(() => employees.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [check('payroll_runs_status_chk', sql`status IN ('draft', 'approved', 'paid')`)],
);

export const payroll_items = pgTable(
  'payroll_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    payroll_run_id: uuid('payroll_run_id')
      .notNull()
      .references(() => payroll_runs.id, { onDelete: 'cascade' }),
    employee_id: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    base_salary: bigint('base_salary', { mode: 'bigint' }).notNull(),
    allowances: bigint('allowances', { mode: 'bigint' }).notNull().default(sql`0`),
    overtime_pay: bigint('overtime_pay', { mode: 'bigint' }).notNull().default(sql`0`),
    deductions: bigint('deductions', { mode: 'bigint' }).notNull().default(sql`0`),
    net_salary: bigint('net_salary', { mode: 'bigint' })
      .notNull()
      .generatedAlwaysAs(
        (): SQL => sql`base_salary + allowances + overtime_pay - deductions`,
      ),
    slip_pdf_object_key: text('slip_pdf_object_key'),
    finance_transaction_id: uuid('finance_transaction_id').references(
      () => finance_transactions.id,
    ),
  },
  (table) => [unique('payroll_items_run_employee_uq').on(table.payroll_run_id, table.employee_id)],
);

export const audit_logs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor_id: uuid('actor_id').references(() => employees.id),
    platform: text('platform').notNull(),
    module: text('module').notNull(),
    action: text('action').notNull(),
    entity_id: text('entity_id'),
    before_data: jsonb('before_data'),
    after_data: jsonb('after_data'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_module_created_idx').on(table.module, table.created_at.desc()),
    check('audit_logs_platform_chk', sql`platform IN ('web', 'flutter', 'system')`),
  ],
);

export const erp_events = pgTable(
  'erp_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    channel: text('channel').notNull(),
    event_type: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('erp_events_channel_id_idx').on(table.channel, table.id.desc())],
);

export const device_tokens = pgTable(
  'device_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auth_user_id: text('auth_user_id')
      .notNull()
      .references(() => employees.auth_user_id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: text('platform').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('device_tokens_token_uq').on(table.token),
    index('device_tokens_auth_user_idx').on(table.auth_user_id),
    check('device_tokens_platform_chk', sql`platform IN ('web', 'flutter')`),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipient_auth_user_id: text('recipient_auth_user_id')
      .notNull()
      .references(() => employees.auth_user_id, { onDelete: 'cascade' }),
    actor_employee_id: uuid('actor_employee_id').references(() => employees.id, {
      onDelete: 'cascade',
    }),
    module: text('module').notNull(),
    event_type: text('event_type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    entity_id: text('entity_id'),
    payload: jsonb('payload'),
    pushed_at: timestamp('pushed_at', { withTimezone: true }),
    read_at: timestamp('read_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_recipient_created_idx').on(
      table.recipient_auth_user_id,
      table.created_at.desc(),
    ),
    index('notifications_recipient_unread_idx')
      .on(table.recipient_auth_user_id)
      .where(sql`read_at IS NULL`),
  ],
);
