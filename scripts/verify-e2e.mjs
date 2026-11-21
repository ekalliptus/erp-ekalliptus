import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createRealtimeClient } from '@neon/realtime/client';
import { drizzleParsers } from '@neon/realtime-drizzle/client';
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';

loadDotenv({ path: '.env.local' });

const DB_URL = (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '').replace(
  'sslmode=require',
  'sslmode=verify-full',
);
const AUTH_BASE = (process.env.NEON_AUTH_BASE_URL || '').replace(/\/+$/, '');
const REALTIME_URL = process.env.NEON_REALTIME_URL || '';
const API_BASE = (
  process.env.VITE_API_BASE_URL ||
  'https://br-odd-frog-aoghf6vq-erpapi.compute.c-2.ap-southeast-1.aws.neon.tech'
).replace(/\/+$/, '');
const BUCKET = process.env.STORAGE_BUCKET || 'assets';
const AUTH_ORIGIN = 'http://localhost:5173';

assert.ok(DB_URL, 'DATABASE_URL or DATABASE_URL_UNPOOLED is required');
assert.ok(AUTH_BASE, 'NEON_AUTH_BASE_URL is required');
assert.ok(REALTIME_URL, 'NEON_REALTIME_URL is required');

const ts = Date.now();
const ownerEmail = `e2e-owner-${ts}@ekalliptus.com`;
const staffEmail = `e2e-staff-${ts}@ekalliptus.com`;
const password = `Ekalliptus#${ts}`;

const pool = new pg.Pool({ connectionString: DB_URL, max: 3 });

const createdEmployeeIds = [];
const createdAccountIds = [];
const createdTransactionIds = [];
const createdItemIds = [];
const createdAttendanceIds = [];
const createdPayrollRunIds = [];
const uploadedS3Keys = [];

let realtimeClient = null;
let realtimeSub = null;

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function apiJson(path, token, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('X-Platform', 'web');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function signUpNeonAuth(name, email, pwd) {
  const res = await fetch(`${AUTH_BASE}/sign-up/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: AUTH_ORIGIN,
    },
    body: JSON.stringify({ name, email, password: pwd }),
  });
  const body = await res.json().catch(() => ({}));
  assert.equal(
    res.status,
    200,
    `Neon Auth sign-up failed for ${email} (${res.status}): ${JSON.stringify(body)}`,
  );

  const setCookies =
    typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
  assert.ok(cookieHeader, `Missing Set-Cookie header from Neon Auth for ${email}`);

  const tokRes = await fetch(`${AUTH_BASE}/token`, {
    method: 'GET',
    headers: {
      Origin: AUTH_ORIGIN,
      Cookie: cookieHeader,
    },
  });
  const tokJson = await tokRes.json().catch(() => ({}));
  assert.equal(tokRes.status, 200, `Token exchange failed (${tokRes.status})`);
  assert.ok(tokJson.token, 'JWT token missing from /token response');
  return tokJson.token;
}

async function main() {
  console.log('=== Ekalliptus ERP End-to-End Verification (5 Neon Services) ===');

  // 1. Seed temporary E2E employees (keeping alul@ekalliptus.com clean)
  const rolesRes = await pool.query('SELECT id, code FROM roles');
  const ownerRole = rolesRes.rows.find((r) => r.code === 'owner');
  const staffRole = rolesRes.rows.find((r) => r.code === 'staff');
  assert.ok(ownerRole && staffRole, 'Seeded roles owner & staff must exist');

  const ownerClaimCode = `EK-E2EOWN${ts % 1000000}`;
  const staffClaimCode = `EK-E2ESTF${ts % 1000000}`;
  const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
  const insOwner = await pool.query(
    `INSERT INTO employees (employee_code, full_name, email, role_id, base_salary, claim_code_hash)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [`E2E-OWN-${ts}`, 'E2E Verification Owner', ownerEmail, ownerRole.id, '5000000', sha256(ownerClaimCode)],
  );
  const ownerEmpId = insOwner.rows[0].id;
  createdEmployeeIds.push(ownerEmpId);

  const insStaff = await pool.query(
    `INSERT INTO employees (employee_code, full_name, email, role_id, base_salary, claim_code_hash)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [`E2E-STF-${ts}`, 'E2E Verification Staff', staffEmail, staffRole.id, '4000000', sha256(staffClaimCode)],
  );
  const staffEmpId = insStaff.rows[0].id;
  createdEmployeeIds.push(staffEmpId);

  // 2. Auth + Functions + RBAC
  const healthRes = await apiJson('/api/health', null);
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.json.status, 'ok');
  console.log('[PASS] Functions GET /api/health -> 200 OK');

  const unauthMe = await apiJson('/api/me', null);
  assert.equal(unauthMe.status, 401);
  console.log('[PASS] Auth guard GET /api/me (unauthenticated) -> 401');

  const ownerJwt = await signUpNeonAuth('E2E Owner', ownerEmail, password);
  const staffJwt = await signUpNeonAuth('E2E Staff', staffEmail, password);

  const ownerClaim = await apiJson('/api/auth/claim', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({ code: ownerClaimCode }),
  });
  assert.equal(ownerClaim.status, 200, 'claim owner harus sukses: ' + JSON.stringify(ownerClaim.json));
  const wrongCode = await apiJson('/api/auth/claim', staffJwt, {
    method: 'POST',
    body: JSON.stringify({ code: 'EK-WRONGCODE1' }),
  });
  assert.equal(wrongCode.status, 403, 'kode salah harus 403');
  const staffClaim = await apiJson('/api/auth/claim', staffJwt, {
    method: 'POST',
    body: JSON.stringify({ code: staffClaimCode }),
  });
  assert.equal(staffClaim.status, 200, 'claim staff harus sukses: ' + JSON.stringify(staffClaim.json));
  console.log('[PASS] Claim code activation (owner + staff) + wrong code rejected 403');

  const ownerMe = await apiJson('/api/me', ownerJwt);
  assert.equal(ownerMe.status, 200);
  assert.equal(ownerMe.json.role, 'owner');
  assert.equal(ownerMe.json.permissions.length, 36);
  assert.ok(ownerMe.json.employee.auth_user_id, 'auth_user_id set after claim');
  console.log('[PASS] Neon Auth JWT + RBAC GET /api/me -> 200 (36 permissions)');

  const staffBlocked = await apiJson('/api/finance/accounts', staffJwt, {
    method: 'POST',
    body: JSON.stringify({ name: 'Unauthorized Kas', type: 'cash', initial_balance: 1000 }),
  });
  assert.equal(staffBlocked.status, 403);
  console.log('[PASS] RBAC enforcement staff POST /api/finance/accounts -> 403 Forbidden');

  // 3. Object Storage presigned upload & download integrity check
  const samplePayload = Buffer.from(`Ekalliptus E2E Receipt ${ts}`, 'utf8');
  const presignUp = await apiJson('/api/storage/presign-upload', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({
      category: 'receipt',
      filename: `e2e-receipt-${ts}.txt`,
      content_type: 'text/plain',
    }),
  });
  assert.equal(presignUp.status, 200);
  const receiptKey = presignUp.json.object_key;
  uploadedS3Keys.push(receiptKey);

  const putS3 = await fetch(presignUp.json.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: samplePayload,
  });
  assert.equal(putS3.status, 200, `S3 presigned PUT failed (${putS3.status})`);

  const presignDown = await apiJson('/api/storage/presign-download', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({ object_key: receiptKey }),
  });
  assert.equal(presignDown.status, 200);

  const getS3 = await fetch(presignDown.json.download_url);
  assert.equal(getS3.status, 200);
  const downloadedBuf = Buffer.from(await getS3.arrayBuffer());
  assert.equal(sha256Hex(downloadedBuf), sha256Hex(samplePayload));
  console.log(`[PASS] Object Storage S3 presigned PUT + GET verified (${receiptKey})`);

  // 4. Postgres ACID Finance + Invoice PDF
  const acc1Res = await apiJson('/api/finance/accounts', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({
      name: `E2E Kas ${ts}`,
      type: 'cash',
      initial_balance: 50000000,
    }),
  });
  assert.equal(acc1Res.status, 201);
  const kasId = acc1Res.json.account.id;
  createdAccountIds.push(kasId);

  const acc2Res = await apiJson('/api/finance/accounts', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({
      name: `E2E Bank ${ts}`,
      type: 'bank',
      initial_balance: 1000000,
    }),
  });
  assert.equal(acc2Res.status, 201);
  const bankId = acc2Res.json.account.id;
  createdAccountIds.push(bankId);

  const incRes = await apiJson('/api/finance/transactions', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({
      account_id: kasId,
      type: 'income',
      amount: 1500000,
      description: `E2E Pemasukan ${ts}`,
      receipt_object_key: receiptKey,
      status: 'posted',
    }),
  });
  assert.equal(incRes.status, 201);
  const incTxId = incRes.json.transaction.id;
  createdTransactionIds.push(incTxId);

  const trRes = await apiJson('/api/finance/transactions', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({
      account_id: kasId,
      target_account_id: bankId,
      type: 'transfer',
      amount: 2000000,
      description: `E2E Transfer Kas ke Bank ${ts}`,
      status: 'posted',
    }),
  });
  assert.equal(trRes.status, 201);
  createdTransactionIds.push(trRes.json.transaction.id);

  const overdraftRes = await apiJson('/api/finance/transactions', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({
      account_id: kasId,
      type: 'expense',
      amount: 999999999,
      description: 'E2E Overdraft Rollback Test',
      status: 'posted',
    }),
  });
  assert.equal(overdraftRes.status, 400);

  const accsCheck = await apiJson('/api/finance/accounts', ownerJwt);
  const kasRow = accsCheck.json.accounts.find((a) => a.id === kasId);
  const bankRow = accsCheck.json.accounts.find((a) => a.id === bankId);
  assert.equal(kasRow.balance, '49500000');
  assert.equal(bankRow.balance, '3000000');
  console.log('[PASS] Postgres ACID Finance + Transfer + Overdraft Rollback verified');

  const invPdfRes = await apiJson(`/api/finance/transactions/${incTxId}/invoice-pdf`, ownerJwt);
  assert.equal(invPdfRes.status, 200);
  uploadedS3Keys.push(invPdfRes.json.object_key);
  const pdfGet = await fetch(invPdfRes.json.download_url);
  assert.equal(pdfGet.status, 200);
  const pdfBytes = Buffer.from(await pdfGet.arrayBuffer());
  assert.equal(pdfBytes.subarray(0, 5).toString('ascii'), '%PDF-');
  console.log('[PASS] Invoice PDF generated & retrieved via Object Storage');

  // 5. Inventory ACID + Low Stock Alert
  const whRes = await apiJson('/api/inventory/warehouses', ownerJwt);
  assert.equal(whRes.status, 200);
  const defaultWh = whRes.json.warehouses[0];
  assert.ok(defaultWh, 'Default warehouse must exist');

  const itemRes = await apiJson('/api/inventory/items', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({
      sku: `E2E-SKU-${ts}`,
      name: `E2E Router ${ts}`,
      unit: 'pcs',
      cost_price: 200000,
      sell_price: 350000,
      min_stock: 5,
    }),
  });
  assert.equal(itemRes.status, 201);
  const itemId = itemRes.json.item.id;
  createdItemIds.push(itemId);

  const mvIn = await apiJson('/api/inventory/movements', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({
      item_id: itemId,
      warehouse_id: defaultWh.id,
      movement_type: 'in',
      qty: 8,
      note: 'E2E initial stock',
    }),
  });
  assert.equal(mvIn.status, 201);
  assert.equal(mvIn.json.qty, 8);

  const mvOut = await apiJson('/api/inventory/movements', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({
      item_id: itemId,
      warehouse_id: defaultWh.id,
      movement_type: 'out',
      qty: 4,
      note: 'E2E dispatch below min_stock',
    }),
  });
  assert.equal(mvOut.status, 201);
  assert.equal(mvOut.json.qty, 4);
  assert.equal(mvOut.json.low_stock_alert, true);
  console.log('[PASS] Inventory ACID stock movements + low_stock_alert verified');

  // 6. Attendance Geofence + Clock-In/Out
  const offRes = await apiJson('/api/attendance/offices', ownerJwt);
  assert.equal(offRes.status, 200);
  const office = offRes.json.offices[0];
  assert.ok(office, 'Default office location must exist');

  const outsideRes = await apiJson('/api/attendance/clock-in', staffJwt, {
    method: 'POST',
    body: JSON.stringify({
      office_id: office.id,
      latitude: -6.2088,
      longitude: 106.8456,
      qr_token: 'E2E-QR-TOKEN',
    }),
  });
  assert.equal(outsideRes.status, 400);

  const insideRes = await apiJson('/api/attendance/clock-in', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({
      office_id: office.id,
      latitude: office.latitude,
      longitude: office.longitude,
      qr_token: 'E2E-QR-TOKEN',
      note: 'E2E clock-in',
    }),
  });
  assert.equal(insideRes.status, 201);
  createdAttendanceIds.push(insideRes.json.record.id);

  const outRes = await apiJson('/api/attendance/clock-out', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({ note: 'E2E clock-out' }),
  });
  assert.equal(outRes.status, 200);
  console.log('[PASS] Attendance Geofence rejection (400) + Clock-In/Clock-Out verified');

  // 7. Payroll + Postgres GENERATED net_salary + ACID Finance posting + Slip PDF
  const today = new Date().toISOString().slice(0, 10);
  const runRes = await apiJson('/api/payroll/runs', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({ period_start: today, period_end: today }),
  });
  assert.equal(runRes.status, 201);
  const runId = runRes.json.run.id;
  createdPayrollRunIds.push(runId);

  const ownerPayItem = runRes.json.items.find((i) => i.employee_id === ownerEmpId);
  assert.ok(ownerPayItem, 'Owner payroll item created');

  const updPay = await apiJson(`/api/payroll/runs/${runId}/items/${ownerPayItem.id}`, ownerJwt, {
    method: 'PATCH',
    body: JSON.stringify({ allowances: 500000, deductions: 100000 }),
  });
  assert.equal(updPay.status, 200);
  const expectedNet =
    BigInt(updPay.json.item.base_salary) +
    BigInt(updPay.json.item.allowances) +
    BigInt(updPay.json.item.overtime_pay) -
    BigInt(updPay.json.item.deductions);
  assert.equal(updPay.json.item.net_salary, expectedNet.toString());

  const appRun = await apiJson(`/api/payroll/runs/${runId}/approve`, ownerJwt, {
    method: 'POST',
  });
  assert.equal(appRun.status, 200);
  assert.equal(appRun.json.run.status, 'approved');

  const runDetail = await apiJson(`/api/payroll/runs/${runId}`, ownerJwt);
  const needed = BigInt(runDetail.json.run.total_disbursed);
  const kasBeforePay = BigInt((await apiJson('/api/finance/accounts', ownerJwt)).json.accounts.find((a) => a.id === kasId).balance);
  if (kasBeforePay < needed) {
    const topup = await apiJson('/api/finance/transactions', ownerJwt, {
      method: 'POST',
      body: JSON.stringify({
        account_id: kasId,
        type: 'income',
        amount: Number(needed - kasBeforePay + 1000000n),
        description: `E2E Topup Payroll ${ts}`,
        status: 'posted',
      }),
    });
    assert.equal(topup.status, 201);
    createdTransactionIds.push(topup.json.transaction.id);
  }

  const payRes = await apiJson(`/api/payroll/runs/${runId}/pay`, ownerJwt, {
    method: 'POST',
    body: JSON.stringify({ finance_account_id: kasId }),
  });
  assert.equal(payRes.status, 200);
  assert.equal(payRes.json.run.status, 'paid');
  if (payRes.json.finance_transaction_id) {
    createdTransactionIds.push(payRes.json.finance_transaction_id);
  }

  for (const item of runDetail.json.items) {
    uploadedS3Keys.push(`slips/${runId}/${item.employee_code}.pdf`);
  }

  const slipRes = await apiJson(`/api/payroll/items/${ownerPayItem.id}/slip-url`, ownerJwt);
  assert.equal(slipRes.status, 200);
  const slipPdfGet = await fetch(slipRes.json.download_url);
  assert.equal(slipPdfGet.status, 200);
  const slipBytes = Buffer.from(await slipPdfGet.arrayBuffer());
  assert.equal(slipBytes.subarray(0, 5).toString('ascii'), '%PDF-');
  console.log('[PASS] Payroll ACID disbursement + GENERATED net_salary + Slip PDF verified');

  // 8. Audit trail verified
  const auditRes = await apiJson('/api/rbac/audit-logs?module=payroll', ownerJwt);
  assert.equal(auditRes.status, 200);
  assert.ok(
    auditRes.json.audit_logs.some((l) => l.entity_id === runId && l.action === 'pay_payroll_run'),
    'Immutable audit log must record pay_payroll_run',
  );
  console.log('[PASS] Immutable Audit Trail verified');

  // 9. Neon Realtime sealed Live Query push on Postgres commit
  const sealed = await apiJson('/api/realtime/seal', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({ feed: 'erp:finance' }),
  });
  assert.equal(sealed.status, 200);
  assert.ok(sealed.json.capability, 'Sealed capability returned');

  realtimeClient = createRealtimeClient({
    url: REALTIME_URL,
    parsers: { ...drizzleParsers },
  });
  realtimeSub = realtimeClient.subscribe(sealed.json);

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Realtime failed to reach live state in 12s')), 12000);
    const unsub = realtimeSub.onChange((snapshot) => {
      if (snapshot.status === 'error') {
        clearTimeout(timeout);
        unsub();
        reject(snapshot.error || new Error('Realtime subscription entered error state'));
      } else if (snapshot.status === 'live') {
        clearTimeout(timeout);
        unsub();
        resolve();
      }
    });
  });

  const uniqueAmount = 250000 + (ts % 10000);
  const matchesLiveTx = (rows) =>
    (rows || []).find(
      (r) =>
        r.event_type === 'transaction_recorded' &&
        r.payload &&
        r.payload.account_id === kasId &&
        String(r.payload.amount) === String(uniqueAmount),
    );

  const eventReceived = new Promise((resolve, reject) => {
    const existing = matchesLiveTx(realtimeSub.getSnapshot().data);
    if (existing) {
      resolve(existing);
      return;
    }
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for Realtime push update (15s)')), 15000);
    const unsub = realtimeSub.onChange((snapshot) => {
      const match = matchesLiveTx(snapshot.data);
      if (match) {
        clearTimeout(timeout);
        unsub();
        resolve(match);
      }
    });
  });

  const rtTx = await apiJson('/api/finance/transactions', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({
      account_id: kasId,
      type: 'income',
      amount: uniqueAmount,
      description: `E2E-RT-LIVE-${ts}`,
      status: 'posted',
    }),
  });
  assert.equal(rtTx.status, 201);
  createdTransactionIds.push(rtTx.json.transaction.id);

  const liveRow = await eventReceived;
  assert.equal(liveRow.event_type, 'transaction_recorded');
  console.log('[PASS] Neon Realtime sealed query pushed live transaction commit over WebSocket');

  // 10. Notifications: token upsert idempotent + list + read-all + unregister
  const fakeToken = `e2e-fake-fcm-${ts}-${'x'.repeat(48)}`;
  const reg1 = await apiJson('/api/notifications/tokens', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({ token: fakeToken, platform: 'web' }),
  });
  assert.equal(reg1.status, 200);
  await apiJson('/api/notifications/tokens', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({ token: fakeToken, platform: 'web' }),
  });
  const tokRows = await pool.query('SELECT count(*)::int AS c FROM device_tokens WHERE token = $1', [fakeToken]);
  assert.equal(tokRows.rows[0].c, 1, 'device token upsert must be idempotent');

  const notifList = await apiJson('/api/notifications', ownerJwt);
  assert.equal(notifList.status, 200);
  assert.ok(Array.isArray(notifList.json.notifications), 'notification list must be an array');
  const unreadBefore = notifList.json.unread;

  const markAll = await apiJson('/api/notifications/read-all', ownerJwt, { method: 'POST' });
  assert.equal(markAll.status, 200);
  const unreadAfter = await apiJson('/api/notifications/unread-count', ownerJwt);
  assert.equal(unreadAfter.status, 200);
  assert.equal(unreadAfter.json.unread, 0, 'read-all must clear unread');
  console.log(`[PASS] Notifications verified (token idempotent, list ok, unread ${unreadBefore} -> 0)`);

  const unreg = await apiJson('/api/notifications/tokens/unregister', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({ token: fakeToken }),
  });
  assert.equal(unreg.status, 200);
  const tokAfter = await pool.query('SELECT count(*)::int AS c FROM device_tokens WHERE token = $1', [fakeToken]);
  assert.equal(tokAfter.rows[0].c, 0, 'unregister must delete the device token');

  // 11. Username: set on own profile, lookup resolves to own email, duplicate rejected
  const meRes = await apiJson('/api/me', ownerJwt);
  assert.equal(meRes.status, 200);
  const myEmail = meRes.json.employee.email;
  const uname = `e2euser${ts % 100000}`;
  const setUn = await apiJson('/api/me/username', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({ username: uname }),
  });
  assert.equal(setUn.status, 200);
  assert.equal(setUn.json.username, uname);
  const lookup = await apiJson('/api/auth/username-lookup', staffJwt, {
    method: 'POST',
    body: JSON.stringify({ username: uname }),
  });
  assert.equal(lookup.status, 200);
  assert.equal(lookup.json.email, myEmail, 'username lookup must resolve to own email');
  const dup = await apiJson('/api/me/username', staffJwt, {
    method: 'POST',
    body: JSON.stringify({ username: uname }),
  });
  assert.equal(dup.status, 409, 'duplicate username must be rejected with 409');
  console.log('[PASS] Username login flow verified (set, lookup, duplicate 409)');

  console.log('\nALL 5 NEON SERVICES + NOTIFICATIONS VERIFIED END-TO-END SUCCESSFULLY!');
}

async function cleanup() {
  try {
    realtimeSub?.unsubscribe();
    realtimeClient?.close();
  } catch {
    // Ignore close errors.
  }

  try {
    if (createdPayrollRunIds.length > 0) {
      await pool.query('DELETE FROM payroll_items WHERE payroll_run_id = ANY($1::uuid[])', [
        createdPayrollRunIds,
      ]);
      await pool.query('DELETE FROM payroll_runs WHERE id = ANY($1::uuid[])', [
        createdPayrollRunIds,
      ]);
    }
    if (createdItemIds.length > 0) {
      await pool.query('DELETE FROM stock_movements WHERE item_id = ANY($1::uuid[])', [
        createdItemIds,
      ]);
      await pool.query('DELETE FROM inventory_stocks WHERE item_id = ANY($1::uuid[])', [
        createdItemIds,
      ]);
      await pool.query('DELETE FROM inventory_items WHERE id = ANY($1::uuid[])', [createdItemIds]);
    }
    if (createdAttendanceIds.length > 0) {
      await pool.query('DELETE FROM attendances WHERE id = ANY($1::uuid[])', [createdAttendanceIds]);
    }
    if (createdTransactionIds.length > 0) {
      await pool.query('DELETE FROM finance_transactions WHERE id = ANY($1::uuid[])', [
        createdTransactionIds,
      ]);
    }
    if (createdAccountIds.length > 0) {
      await pool.query('DELETE FROM finance_accounts WHERE id = ANY($1::uuid[])', [
        createdAccountIds,
      ]);
    }
    if (createdEmployeeIds.length > 0) {
      await pool.query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [
        createdEmployeeIds,
      ]);
      await pool.query('DELETE FROM employees WHERE id = ANY($1::uuid[])', [createdEmployeeIds]);
    }
    await pool.query(
      "DELETE FROM erp_events WHERE payload::text LIKE $1",
      [`%${ts}%`],
    );
    if (createdTransactionIds.length > 0) {
      for (const txId of createdTransactionIds) {
        await pool.query('DELETE FROM erp_events WHERE payload::text LIKE $1', [`%${txId}%`]);
      }
    }
    // Best-effort remove temporary Neon Auth test users
    await pool
      .query('DELETE FROM neon_auth."user" WHERE email IN ($1, $2)', [ownerEmail, staffEmail])
      .catch(() => {});
  } finally {
    await pool.end();
  }

  if (uploadedS3Keys.length > 0 && process.env.AWS_ACCESS_KEY_ID) {
    const s3 = new S3Client({
      region: process.env.AWS_REGION || 'ap-southeast-1',
      endpoint: process.env.AWS_ENDPOINT_URL_S3,
      forcePathStyle: true,
    });
    for (const Key of uploadedS3Keys) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key })).catch(() => {});
    }
    s3.destroy();
  }
  console.log('[CLEANUP] Temporary E2E records and objects removed cleanly.');
}

let exitCode = 0;
try {
  await main();
} catch (err) {
  exitCode = 1;
  console.error(err);
} finally {
  await cleanup();
}
process.exit(exitCode);
