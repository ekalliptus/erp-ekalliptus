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
const createdPosSaleIds = [];
const createdAttendanceIds = [];
const createdPayrollRunIds = [];
const createdReleaseIds = [];
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

  const previewOwner = await apiJson('/api/auth/claim-preview', null, {
    method: 'POST',
    body: JSON.stringify({ code: ownerClaimCode }),
  });
  assert.equal(previewOwner.status, 200, 'claim-preview owner harus 200: ' + JSON.stringify(previewOwner.json));
  assert.equal(previewOwner.json.valid, true);
  assert.equal(previewOwner.json.employee?.email, ownerEmail);
  assert.equal(previewOwner.json.employee?.full_name, 'E2E Verification Owner');
  assert.equal(previewOwner.json.employee?.role_code, 'owner');
  assert.equal(previewOwner.json.employee?.base_salary, undefined, 'claim-preview must not expose salary');

  const previewWrong = await apiJson('/api/auth/claim-preview', null, {
    method: 'POST',
    body: JSON.stringify({ code: 'EK-WRONGCODE1' }),
  });
  assert.equal(previewWrong.status, 404, 'claim-preview kode salah harus 404');

  const ownerClaim = await apiJson('/api/auth/claim', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({ code: ownerClaimCode }),
  });
  assert.equal(ownerClaim.status, 200, 'claim owner harus sukses: ' + JSON.stringify(ownerClaim.json));

  const previewAfterClaim = await apiJson('/api/auth/claim-preview', null, {
    method: 'POST',
    body: JSON.stringify({ code: ownerClaimCode }),
  });
  assert.equal(previewAfterClaim.status, 404, 'claim-preview kode terpakai harus 404');

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
  console.log('[PASS] Claim preview auto-fetch + activation (owner + staff) + wrong/used code guards');

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

  // 5b. Kasir / POS Sales + Receipt PDF + Void/Retur Stock & Cash Restoration
  const posCatRes = await apiJson('/api/finance/pos/catalog', ownerJwt);
  assert.equal(posCatRes.status, 200);
  const posProduct = posCatRes.json.products.find((p) => p.id === itemId);
  assert.ok(posProduct, 'Created inventory item must appear in POS catalog');
  assert.equal(posProduct.stocks_by_warehouse[defaultWh.id], 4);

  const posCreateRes = await apiJson('/api/finance/pos/sales', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({
      warehouse_id: defaultWh.id,
      account_id: kasId,
      customer_name: `Pelanggan E2E ${ts}`,
      payment_method: 'cash',
      discount_type: 'percent',
      discount_value: 10,
      tax_percent: 11,
      paid_amount: 800000,
      note: 'E2E POS sale',
      items: [
        {
          inventory_item_id: itemId,
          sku: posProduct.sku,
          item_name: posProduct.name,
          unit: 'pcs',
          qty: 2,
          unit_price: 350000,
        },
        {
          item_name: 'Biaya Pasang E2E',
          unit: 'jasa',
          qty: 1,
          unit_price: 50000,
        },
      ],
    }),
  });
  assert.equal(posCreateRes.status, 201, 'POS create sale must return 201: ' + JSON.stringify(posCreateRes.json));
  const posSale = posCreateRes.json.sale;
  createdPosSaleIds.push(posSale.id);
  if (posSale.finance_transaction_id) {
    createdTransactionIds.push(posSale.finance_transaction_id);
  }
  assert.equal(posSale.subtotal, '750000');
  assert.equal(posSale.discount_amount, '75000');
  assert.equal(posSale.tax_amount, '74250');
  assert.equal(posSale.total_amount, '749250');
  assert.equal(posSale.change_amount, '50750');

  const posCatAfterSell = await apiJson('/api/finance/pos/catalog', ownerJwt);
  assert.equal(posCatAfterSell.status, 200);
  const soldProductAfter = posCatAfterSell.json.products.find((p) => p.id === itemId);
  assert.equal(soldProductAfter.stocks_by_warehouse[defaultWh.id], 2);

  const posSalesRes = await apiJson('/api/finance/pos/sales', ownerJwt);
  assert.equal(posSalesRes.status, 200);
  assert.ok(posSalesRes.json.sales.some((s) => s.id === posSale.id));

  const posPdfRes = await apiJson(`/api/finance/pos/sales/${posSale.id}/receipt-pdf`, ownerJwt);
  assert.equal(posPdfRes.status, 200);
  assert.ok(posPdfRes.json.download_url, 'POS receipt PDF URL must be returned');
  uploadedS3Keys.push(posPdfRes.json.object_key);
  const posPdfGet = await fetch(posPdfRes.json.download_url);
  assert.equal(posPdfGet.status, 200);
  const posPdfBytes = Buffer.from(await posPdfGet.arrayBuffer());
  assert.equal(posPdfBytes.subarray(0, 5).toString('ascii'), '%PDF-');

  const posVoidRes = await apiJson(`/api/finance/pos/sales/${posSale.id}/void`, ownerJwt, {
    method: 'POST',
    body: JSON.stringify({ reason: 'E2E POS void test' }),
  });
  assert.equal(posVoidRes.status, 200);
  assert.equal(posVoidRes.json.sale.status, 'void');

  const posCatAfterVoid = await apiJson('/api/finance/pos/catalog', ownerJwt);
  const restoredProductAfter = posCatAfterVoid.json.products.find((p) => p.id === itemId);
  assert.equal(restoredProductAfter.stocks_by_warehouse[defaultWh.id], 4);
  console.log('[PASS] Kasir / POS checkout, discount/PPN, stock deduction, PDF receipt & Void restoration verified');

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
      verification_method: 'qr',
      note: 'E2E clock-in',
    }),
  });
  assert.equal(insideRes.status, 201);
  createdAttendanceIds.push(insideRes.json.record.id);

  // 6b. Live Face Recognition Guards (status, enroll, verify, mismatch 403, clock-in/out, reset)
  const faceVecA = Array.from({ length: 128 }, (_, i) => (i % 2 === 0 ? 0.15 : -0.1));
  const faceVecMismatch = Array.from({ length: 128 }, (_, i) => (i % 2 === 0 ? -0.35 : 0.35));

  const faceInitStatus = await apiJson('/api/attendance/face-status', staffJwt);
  assert.equal(faceInitStatus.status, 200);
  assert.equal(faceInitStatus.json.enrolled, false);

  const unenrolledClockIn = await apiJson('/api/attendance/clock-in', staffJwt, {
    method: 'POST',
    body: JSON.stringify({
      office_id: office.id,
      latitude: office.latitude,
      longitude: office.longitude,
      verification_method: 'face_scan',
      face_model: 'web_faceapi_128d',
      face_descriptor: faceVecA,
      selfie_object_key: receiptKey,
    }),
  });
  assert.equal(unenrolledClockIn.status, 400);

  const enrollRes = await apiJson('/api/attendance/face-enroll', staffJwt, {
    method: 'POST',
    body: JSON.stringify({
      face_model: 'web_faceapi_128d',
      face_descriptor: faceVecA,
      selfie_object_key: receiptKey,
    }),
  });
  assert.equal(enrollRes.status, 201);
  assert.equal(enrollRes.json.enrolled, true);

  const dupEnrollRes = await apiJson('/api/attendance/face-enroll', staffJwt, {
    method: 'POST',
    body: JSON.stringify({
      face_model: 'web_faceapi_128d',
      face_descriptor: faceVecA,
      selfie_object_key: receiptKey,
    }),
  });
  assert.equal(dupEnrollRes.status, 409);

  const verifyOkRes = await apiJson('/api/attendance/face-verify', staffJwt, {
    method: 'POST',
    body: JSON.stringify({ face_model: 'web_faceapi_128d', face_descriptor: faceVecA }),
  });
  assert.equal(verifyOkRes.status, 200);
  assert.equal(verifyOkRes.json.matched, true);

  const verifyMismatchRes = await apiJson('/api/attendance/face-verify', staffJwt, {
    method: 'POST',
    body: JSON.stringify({ face_model: 'web_faceapi_128d', face_descriptor: faceVecMismatch }),
  });
  assert.equal(verifyMismatchRes.status, 200);
  assert.equal(verifyMismatchRes.json.matched, false);

  const faceInMismatch = await apiJson('/api/attendance/clock-in', staffJwt, {
    method: 'POST',
    body: JSON.stringify({
      office_id: office.id,
      latitude: office.latitude,
      longitude: office.longitude,
      verification_method: 'face_scan',
      face_model: 'web_faceapi_128d',
      face_descriptor: faceVecMismatch,
      selfie_object_key: receiptKey,
    }),
  });
  assert.equal(faceInMismatch.status, 403);

  const faceInOk = await apiJson('/api/attendance/clock-in', staffJwt, {
    method: 'POST',
    body: JSON.stringify({
      office_id: office.id,
      latitude: office.latitude,
      longitude: office.longitude,
      verification_method: 'face_scan',
      face_model: 'web_faceapi_128d',
      face_descriptor: faceVecA,
      selfie_object_key: receiptKey,
      note: 'E2E face clock-in',
    }),
  });
  assert.equal(faceInOk.status, 201);
  createdAttendanceIds.push(faceInOk.json.record.id);

  const unverifiedOutRes = await apiJson('/api/attendance/clock-out', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({ note: 'Unverified E2E clock-out' }),
  });
  assert.equal(unverifiedOutRes.status, 400);

  const faceOutMismatch = await apiJson('/api/attendance/clock-out', staffJwt, {
    method: 'POST',
    body: JSON.stringify({
      verification_method: 'face_scan',
      face_model: 'web_faceapi_128d',
      face_descriptor: faceVecMismatch,
      selfie_object_key: receiptKey,
    }),
  });
  assert.equal(faceOutMismatch.status, 403);

  const faceOutOk = await apiJson('/api/attendance/clock-out', staffJwt, {
    method: 'POST',
    body: JSON.stringify({
      verification_method: 'face_scan',
      face_model: 'web_faceapi_128d',
      face_descriptor: faceVecA,
      selfie_object_key: receiptKey,
      note: 'E2E face clock-out',
    }),
  });
  assert.equal(faceOutOk.status, 200);

  const resetFaceRes = await apiJson(`/api/rbac/employees/${staffEmpId}/face`, ownerJwt, {
    method: 'DELETE',
  });
  assert.equal(resetFaceRes.status, 200);

  const faceAfterReset = await apiJson('/api/attendance/face-status', staffJwt);
  assert.equal(faceAfterReset.status, 200);
  assert.equal(faceAfterReset.json.enrolled, false);

  const outRes = await apiJson('/api/attendance/clock-out', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({
      qr_token: 'E2E-QR-TOKEN',
      verification_method: 'qr',
      note: 'E2E clock-out',
    }),
  });
  assert.equal(outRes.status, 200);
  console.log('[PASS] Attendance Geofence + Face Recognition (enroll/mismatch 403/reset) + Clock-In/Out verified');

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

  // 12. Owner Employee CRUD + Guards (Create w/ claim code, Update, Duplicate 409, Self/Staff Guards, Delete / 409 history)
  const crudCode = `E2E-MGR-${ts % 100000}`;
  const crudEmail = `e2e-mgr-${ts}@ekalliptus.com`;
  const crudUsername = `e2emgr${ts % 100000}`;
  const createMgr = await apiJson('/api/rbac/employees', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({
      employee_code: crudCode,
      full_name: 'E2E Managed Employee',
      email: crudEmail,
      username: crudUsername,
      phone: '081200011122',
      role_id: staffRole.id,
      base_salary: 4500000,
      issue_claim_code: true,
    }),
  });
  assert.equal(createMgr.status, 201, 'Owner create employee must succeed: ' + JSON.stringify(createMgr.json));
  assert.ok(createMgr.json.claim_code && createMgr.json.claim_code.startsWith('EK-'), 'issue_claim_code must return claim_code');
  const mgrEmpId = createMgr.json.employee.id;
  createdEmployeeIds.push(mgrEmpId);

  const listAfterCreate = await apiJson('/api/rbac/employees', ownerJwt);
  assert.equal(listAfterCreate.status, 200);
  const listedMgr = listAfterCreate.json.employees.find((e) => e.id === mgrEmpId);
  assert.ok(listedMgr, 'Created employee must appear in GET /api/rbac/employees');
  assert.equal(listedMgr.username, crudUsername);
  assert.equal(listedMgr.has_claim_code, true);

  const dupEmailRes = await apiJson('/api/rbac/employees', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({
      employee_code: `E2E-MGR2-${ts % 100000}`,
      full_name: 'Dup Email Test',
      email: crudEmail,
      role_id: staffRole.id,
      base_salary: 3000000,
    }),
  });
  assert.equal(dupEmailRes.status, 409, 'Duplicate employee email must return 409 Conflict');

  const updMgr = await apiJson(`/api/rbac/employees/${mgrEmpId}`, ownerJwt, {
    method: 'PATCH',
    body: JSON.stringify({
      full_name: 'E2E Managed Updated',
      base_salary: 5200000,
      is_active: false,
    }),
  });
  assert.equal(updMgr.status, 200);
  assert.equal(updMgr.json.employee.full_name, 'E2E Managed Updated');
  assert.equal(updMgr.json.employee.base_salary, '5200000');
  assert.equal(updMgr.json.employee.is_active, false);

  const reactivateMgr = await apiJson(`/api/rbac/employees/${mgrEmpId}`, ownerJwt, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: true }),
  });
  assert.equal(reactivateMgr.status, 200);
  assert.equal(reactivateMgr.json.employee.is_active, true);

  const selfDeact = await apiJson(`/api/rbac/employees/${ownerEmpId}`, ownerJwt, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: false }),
  });
  assert.equal(selfDeact.status, 400, 'Owner cannot deactivate self');

  const selfDel = await apiJson(`/api/rbac/employees/${ownerEmpId}`, ownerJwt, {
    method: 'DELETE',
  });
  assert.equal(selfDel.status, 400, 'Owner cannot delete self');

  const staffDel = await apiJson(`/api/rbac/employees/${mgrEmpId}`, staffJwt, {
    method: 'DELETE',
  });
  assert.equal(staffDel.status, 403, 'Staff cannot delete employees');

  // staffEmpId has operational history (clock-in attempt failed 400, wait: what has history? ownerEmpId is self, what about staffEmpId who called /api/me/username or payroll_items!).
  // E2E payroll run included staffEmpId in payroll_items, so DELETE staffEmpId must return 409 can_deactivate: true!
  const conflictDel = await apiJson(`/api/rbac/employees/${staffEmpId}`, ownerJwt, {
    method: 'DELETE',
  });
  assert.equal(conflictDel.status, 409, 'Deleting employee with payroll history must return 409');
  assert.equal(conflictDel.json.can_deactivate, true);

  const cleanDel = await apiJson(`/api/rbac/employees/${mgrEmpId}`, ownerJwt, {
    method: 'DELETE',
  });
  assert.equal(cleanDel.status, 200, 'Clean employee without history must delete cleanly');
  assert.equal(cleanDel.json.mode, 'deleted');
  console.log('[PASS] Owner Employee CRUD + conflict 409 + self/RBAC guards verified');

  // 13. App Version, Changelog & Update Check + Owner Release Guards
  const verOutdated = await apiJson(
    '/api/app/version?platform=android&current_version=1.0.0&current_build=1',
    null,
  );
  assert.equal(verOutdated.status, 200);
  assert.equal(verOutdated.json.has_update, true, 'Outdated client build=1 must receive has_update=true');
  assert.ok(
    Array.isArray(verOutdated.json.pending_releases) && verOutdated.json.pending_releases.length >= 2,
    'Outdated client build=1 must receive pending releases',
  );

  const verCurrent = await apiJson(
    '/api/app/version?platform=android&current_version=1.2.0&current_build=3',
    null,
  );
  assert.equal(verCurrent.status, 200);
  assert.equal(verCurrent.json.has_update, false, 'Current client build=3 must have has_update=false');

  const webChangelog = await apiJson('/api/app/changelog?platform=web', null);
  assert.equal(webChangelog.status, 200);
  assert.ok(
    Array.isArray(webChangelog.json.releases) && webChangelog.json.releases.length >= 3,
    'Public changelog must return seeded releases',
  );

  const staffPub = await apiJson('/api/app/releases', staffJwt, {
    method: 'POST',
    body: JSON.stringify({
      platform: 'web',
      version: '9.9.8',
      build_number: 99998,
      title: 'Unauthorized Release',
      changelog: ['Should fail'],
    }),
  });
  assert.equal(staffPub.status, 403, 'Staff cannot publish app releases');

  const e2eBuildNumber = 90000 + (ts % 9000);
  const ownerPub = await apiJson('/api/app/releases', ownerJwt, {
    method: 'POST',
    body: JSON.stringify({
      platform: 'web',
      version: '9.9.9',
      build_number: e2eBuildNumber,
      title: `E2E Test Release ${ts}`,
      changelog: ['Pembaruan uji E2E otomatis'],
      download_url: 'https://my.ekalliptus.com',
    }),
  });
  assert.equal(ownerPub.status, 201, 'Owner publish release must succeed');
  const tmpReleaseId = ownerPub.json.release.id;
  createdReleaseIds.push(tmpReleaseId);

  const verAfterPub = await apiJson(
    '/api/app/version?platform=web&current_version=1.2.0&current_build=3',
    null,
  );
  assert.equal(verAfterPub.status, 200);
  assert.equal(verAfterPub.json.has_update, true);
  assert.equal(verAfterPub.json.latest.version, '9.9.9');

  const delRelease = await apiJson(`/api/app/releases/${tmpReleaseId}`, ownerJwt, {
    method: 'DELETE',
  });
  assert.equal(delRelease.status, 200);

  const dlRes = await fetch(`${API_BASE}/api/app/download/android`, {
    method: 'GET',
    redirect: 'manual',
    headers: { 'X-Platform': 'web' },
  });
  assert.equal(dlRes.status, 302, 'GET /api/app/download/android must redirect 302 to S3 presigned URL');
  const dlLoc = dlRes.headers.get('location') || '';
  assert.ok(dlLoc.startsWith('http'), 'APK redirect Location header must be an HTTP URL');
  const s3Get = await fetch(dlLoc, {
    method: 'GET',
    headers: { Range: 'bytes=0-15' },
  });
  assert.ok(
    s3Get.status === 206 || s3Get.status === 200,
    `Presigned Android APK download URL must respond 206/200 on GET (got ${s3Get.status})`,
  );
  const contentRange = s3Get.headers.get('content-range') || '';
  const rangeTotalMatch = /\/(\d+)$/.exec(contentRange);
  const apkLen = rangeTotalMatch
    ? Number(rangeTotalMatch[1])
    : Number(s3Get.headers.get('content-length') || '0');
  await s3Get.arrayBuffer();
  assert.ok(apkLen > 1000000, `Uploaded Android APK size must be > 1MB (got ${apkLen})`);
  console.log(`[PASS] App Version, Changelog, Update Check, APK Download (${(apkLen / (1024 * 1024)).toFixed(2)} MB) & Owner Guards verified`);

  console.log('\nALL 5 NEON SERVICES + NOTIFICATIONS + OWNER CRUD + APP VERSION VERIFIED END-TO-END SUCCESSFULLY!');
}

async function cleanup() {
  try {
    realtimeSub?.unsubscribe();
    realtimeClient?.close();
  } catch {
    // Ignore close errors.
  }

  try {
    if (createdReleaseIds.length > 0) {
      await pool.query('DELETE FROM app_releases WHERE id = ANY($1::uuid[])', [createdReleaseIds]);
    }
    if (createdPayrollRunIds.length > 0) {
      await pool.query('DELETE FROM payroll_items WHERE payroll_run_id = ANY($1::uuid[])', [
        createdPayrollRunIds,
      ]);
      await pool.query('DELETE FROM payroll_runs WHERE id = ANY($1::uuid[])', [
        createdPayrollRunIds,
      ]);
    }
    if (createdPosSaleIds.length > 0) {
      await pool.query('DELETE FROM pos_sale_items WHERE sale_id = ANY($1::uuid[])', [
        createdPosSaleIds,
      ]);
      await pool.query('DELETE FROM pos_sales WHERE id = ANY($1::uuid[])', [
        createdPosSaleIds,
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
