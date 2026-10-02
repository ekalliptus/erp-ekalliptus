import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

const root = resolve(import.meta.dirname, '..');
const directory = await mkdtemp(join(tmpdir(), 'nexus-verify-'));
const password = randomBytes(24).toString('hex');
const email = `verify-${randomUUID()}@example.test`;
const port = async () => {
  const server = createServer();
  await new Promise((yes, no) => server.once('error', no).listen(0, '127.0.0.1', yes));
  const value = server.address().port;
  await new Promise(yes => server.close(yes));
  return value;
};
const dbPort = await port();
const apiPort = Number(process.env.TEST_API_PORT || await port());
const database = new EmbeddedPostgres({ databaseDir: join(directory, 'pg'), user: 'nexus_test', password,
  port: dbPort, persistent: true, authMethod: 'scram-sha-256',
  postgresFlags: ['-h', '127.0.0.1'], onLog() {}, onError() {} });
const url = `postgresql://nexus_test:${password}@127.0.0.1:${dbPort}/nexus_test`;
const env = { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url, ADMIN_EMAIL: email,
  ADMIN_PASSWORD: password, PORT: String(apiPort), HOST: '127.0.0.1', CORS_ORIGIN: 'http://localhost:3100' };
let api;
let client;
let token;
let finished = false;
const children = new Set();
function command(args) {
  return new Promise((yes, no) => {
    const child = spawn(process.execPath, args, { cwd: join(root, 'backend'), env, stdio: 'inherit' });
    children.add(child);
    child.once('error', no);
    child.once('exit', code => { children.delete(child); code === 0 ? yes() : no(new Error(`Command exited ${code}: ${args.join(' ')}`)); });
  });
}
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`http://127.0.0.1:${apiPort}/api/v1${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, data: await response.json() };
}
async function good(path, body, method) {
  const result = await request(path, body, method);
  assert.ok(result.status < 300, `${method || 'request'} ${path}: ${result.status} ${JSON.stringify(result.data)}`);
  return result.data;
}
async function stop() {
  if (finished) return;
  finished = true;
  for (const child of children) child.kill();
  if (api && api.exitCode === null) { api.kill(); await new Promise(resolve => { api.once('exit', resolve); setTimeout(resolve, 5000).unref(); }); }
  await client?.end();
  await database.stop();
}
process.once('SIGINT', () => void stop().then(() => process.exit(0)));
process.once('SIGTERM', () => void stop().then(() => process.exit(0)));
try {
  await database.initialise();
  await database.start();
  await database.createDatabase('nexus_test');
  console.log('PASS PostgreSQL temporary cluster started on loopback');
  await command(['node_modules/tsx/dist/cli.mjs', 'src/cli.ts', 'migrate']);
  await command(['node_modules/tsx/dist/cli.mjs', 'src/cli.ts', 'admin']);
  await command(['node_modules/tsx/dist/cli.mjs', '--test', 'test/database.test.ts']);
  api = spawn(process.execPath, ['dist/main.js'], { cwd: join(root, 'backend'), env, stdio: 'inherit' });
  api.on('error', error => console.error(error.message));
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (api.exitCode !== null) throw new Error('API exited before readiness');
    try { await request('/auth/me'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  assert.ok(ready, 'API startup timed out');
  assert.equal((await request('/inventory')).status, 401);
  assert.equal((await request('/auth/login', { email, password: 'incorrect' })).status, 401);
  token = (await good('/auth/login', { email, password })).token;
  assert.ok(token);
  assert.equal((await good('/auth/me')).email, email);
  console.log('PASS login and anonymous access rejection');
  const customer = await good('/customers', { fullName: 'Verification Customer', phoneNumber: '+6281234567890' });
  async function item(sku, quantity) {
    const created = await good('/inventory', { sku, name: sku, costPrice: '10.00', salePrice: '25.00' });
    if (quantity) await good(`/inventory/${created.id}/adjust`, { quantity, reason: 'Integration test opening stock' });
    return created;
  }
  const limited = await item('TEST-LIMITED', 1);
  const order = key => ({ customerId: customer.id, items: [{ itemId: limited.id, quantity: 1 }], paymentMethod: 'cash', idempotencyKey: key });
  const keys = [randomUUID(), randomUUID()];
  const concurrent = await Promise.all(keys.map(key => request('/orders', order(key))));
  assert.equal(concurrent.filter(r => r.status < 300).length, 1);
  assert.equal(concurrent.filter(r => r.status === 409).length, 1);
  assert.equal((await good('/inventory')).find(i => i.id === limited.id).currentStock, 0);
  const winner = concurrent.find(r => r.status < 300).data;
  const winnerKey = keys[concurrent.findIndex(r => r.status < 300)];
  assert.equal((await good('/orders', order(winnerKey))).id, winner.id);
  assert.equal((await request('/orders', { ...order(winnerKey), items: [{ itemId: limited.id, quantity: 2 }] })).status, 409);
  console.log('PASS concurrent checkout prevents overselling');
  const available = await item('TEST-ROLLBACK', 2);
  const unavailable = await item('TEST-EMPTY', 0);
  const ordersBefore = (await good('/orders')).length;
  const ledgerBefore = (await good('/ledger')).length;
  const failed = await request('/orders', { customerId: customer.id, items: [{ itemId: available.id, quantity: 1 }, { itemId: unavailable.id, quantity: 1 }], paymentMethod: 'cash', idempotencyKey: randomUUID() });
  assert.equal(failed.status, 409);
  assert.equal((await good('/inventory')).find(i => i.id === available.id).currentStock, 2);
  assert.equal((await good('/orders')).length, ordersBefore);
  assert.equal((await good('/ledger')).length, ledgerBefore);
  console.log('PASS failed checkout rolls back stock, order and journal');
  const project = await good('/projects', { customerId: customer.id, title: 'Verification Website', totalContractValue: '100.00', targetDeliveryDate: '2027-01-01', scopeDescription: 'Integration verification only' });
  await good(`/projects/${project.id}/milestones/${project.milestones[0].id}/complete`, {});
  const invoice = (await good('/invoices')).find(i => i.sourceId === project.milestones[0].id || (i.sourceModule === 'agency' && i.customerId === customer.id));
  assert.ok(invoice, 'Project completion creates invoice');
  const payment = { amount: '40.00', paymentMethod: 'manual_transfer', paymentReference: randomUUID() };
  assert.equal((await good(`/invoices/${invoice.id}/payments`, payment)).paidAmount, '40.00');
  assert.equal((await good(`/invoices/${invoice.id}/payments`, payment)).paidAmount, '40.00');
  assert.equal((await request(`/invoices/${invoice.id}/payments`, { ...payment, amount: '41.00' })).status, 409);
  const payments = await Promise.all([1, 2].map(() => request(`/invoices/${invoice.id}/payments`, { amount: '60.00', paymentMethod: 'cash', paymentReference: randomUUID() })));
  assert.equal(payments.filter(p => p.status < 300).length, 1);
  assert.equal(payments.filter(p => p.status === 409).length, 1);
  assert.equal((await good('/invoices')).find(i => i.id === invoice.id).status, 'paid');
  console.log('PASS partial payment, replay, conflict and concurrent overpayment');
  const repair = await good('/repairs', { customerId: customer.id, deviceType: 'Laptop', brand: 'Test', modelName: 'Test', declaredDefects: 'Labor verification' });
  const state = (value, evidence = {}) => good(`/repairs/${repair.id}/state`, { state: value, ...evidence }, 'PATCH');
  await state('inspection_pending', { intakeEvidence: 'Device serial and physical condition recorded' });
  await good(`/repairs/${repair.id}/quotation`, { amount: '50.00', description: 'Labor only' });
  await state('diagnosed_quotation_ready');
  await state('waiting_customer_approval');
  await state('repair_approved_in_progress', { approvalEvidence: 'Customer approved labor quote' });
  await state('qa_qc_validation');
  await state('ready_for_pickup', { qcEvidence: 'Power and function checks passed' });
  assert.equal((await request(`/repairs/${repair.id}/state`, { state: 'delivered_closed' }, 'PATCH')).status, 409);
  const repairInvoice = (await good('/invoices')).find(i => i.sourceId === repair.id);
  assert.ok(repairInvoice);
  await good(`/invoices/${repairInvoice.id}/payments`, { amount: '50.00', paymentMethod: 'cash', paymentReference: randomUUID() });
  assert.equal((await state('delivered_closed')).currentState, 'delivered_closed');
  console.log('PASS repair evidence, quotation, billing and paid-only closure');
  const cents = amount => BigInt(amount.replace('.', ''));
  const ledger = await good('/ledger');
  assert.ok(ledger.length);
  for (const journal of ledger) assert.equal(journal.lines.reduce((sum, line) => sum + cents(line.debit) - cents(line.credit), 0n), 0n);
  console.log('PASS every API journal balances exactly');
  assert.equal((await request('/integrations/ppob', {})).status, 503);
  await good('/auth/logout', {});
  assert.equal((await request('/auth/me')).status, 401);
  console.log('PASS provider unavailable and session revocation');
  token = undefined;
  if (process.env.KEEP_TEST_SERVICES === '1') {
    const credentialFile = join(directory, 'credentials.json');
    await writeFile(credentialFile, JSON.stringify({ apiPort, dbPort, email, password, databaseUrl: url }), { mode: 0o600 });
    await chmod(credentialFile, 0o600);
    console.log(`PASS integration suite; temporary services kept alive. Private local credentials: ${credentialFile}`);
    console.log(`API http://127.0.0.1:${apiPort}; stop this process to shut down temporary services.`);
    await new Promise(() => {});
  }
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await stop(); }
