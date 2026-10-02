import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import EmbeddedPostgres from 'embedded-postgres';

const root = resolve(import.meta.dirname, '..');
const dataDir = join(root, '.data');
const dbDir = join(dataDir, 'postgres');
const dbMeta = join(dataDir, 'local-db.json');
const pidFile = join(dataDir, 'local-services.json');
const envFile = join(root, '.env');
const apiPort = 3000;
const webPort = 3100;

async function freePort(preferred) {
  const probe = async port => new Promise((yes, no) => { const s = createServer(); s.once('error', no).listen(port, '127.0.0.1', () => s.close(yes)); });
  if (await probe(preferred).then(() => true, () => false)) return preferred;
  return new Promise((yes, no) => { const s = createServer(); s.once('error', no).listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => yes(p)); }); });
}

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  return out;
}

function run(args, cwd, env) {
  return new Promise((yes, no) => {
    const child = spawn(args[0], args.slice(1), { cwd, env, stdio: 'inherit' });
    child.once('error', no);
    child.once('exit', code => (code === 0 ? yes() : no(new Error(`exit ${code}: ${args.join(' ')}`))));
  });
}

const children = new Set();
function keep(args, cwd, env) {
  const child = spawn(args[0], args.slice(1), { cwd, env, stdio: 'inherit' });
  children.add(child);
  child.once('exit', code => { children.delete(child); if (!stopping && code !== 0) console.error(`Process exited (${code}): ${args.join(' ')}`); });
  return child;
}

let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) { try { c.kill(); } catch {} }
  await new Promise(r => setTimeout(r, 1500));
  try { await database?.stop(); } catch {}
  await rm(pidFile, { force: true });
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => void shutdown(0));

if (process.argv[2] === '--down') {
  if (!existsSync(pidFile)) { console.log('No local services running.'); process.exit(0); }
  const { pid } = JSON.parse(await readFile(pidFile, 'utf8'));
  await new Promise((yes, no) => { const t = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); t.once('exit', yes); t.once('error', no); });
  await rm(pidFile, { force: true });
  console.log('Local services stopped.');
  process.exit(0);
}

if (existsSync(pidFile)) { console.error('Local services already running. Stop them first: npm run local:down'); process.exit(1); }
for (const port of [apiPort, webPort]) {
  const busy = !(await freePort(port).then(() => true, () => false));
  if (busy) { console.error(`Port ${port} is in use. Free it or stop the old process first.`); process.exit(1); }
}

await mkdir(dataDir, { recursive: true });
let admin = existsSync(envFile) ? parseEnv(await readFile(envFile, 'utf8')) : {};
if (!admin.ADMIN_EMAIL || !admin.ADMIN_PASSWORD) {
  admin.ADMIN_EMAIL = admin.ADMIN_EMAIL || 'admin@nexus.local';
  admin.ADMIN_PASSWORD = admin.ADMIN_PASSWORD || randomBytes(18).toString('base64url');
  const generated = `# MyEkalliptus local run credentials (generated; file is gitignored).\nADMIN_EMAIL=${admin.ADMIN_EMAIL}\nADMIN_PASSWORD=${admin.ADMIN_PASSWORD}\n`;
  await writeFile(envFile, existsSync(envFile) ? await readFile(envFile, 'utf8') + generated : generated);
  console.log(`Generated administrator credentials in .env (${admin.ADMIN_EMAIL}).`);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin.ADMIN_EMAIL) || admin.ADMIN_PASSWORD.length < 12) {
  console.error('.env ADMIN_EMAIL/ADMIN_PASSWORD invalid (password minimum 12 characters).'); process.exit(1);
}

let meta = existsSync(dbMeta) ? JSON.parse(await readFile(dbMeta, 'utf8')) : null;
if (!meta?.password) { meta = { password: randomBytes(24).toString('hex') }; await writeFile(dbMeta, JSON.stringify(meta), { mode: 0o600 }); }

const dbPort = await freePort(54329);
const database = new EmbeddedPostgres({
  databaseDir: dbDir, user: 'nexus_local', password: meta.password, port: dbPort,
  persistent: true, authMethod: 'scram-sha-256', postgresFlags: ['-h', '127.0.0.1'], onLog() {}, onError() {},
});
const fresh = !existsSync(join(dbDir, 'PG_VERSION'));
if (fresh) { console.log('Initialising local PostgreSQL cluster at .data/postgres …'); await database.initialise(); }
await database.start();
try { await database.createDatabase('nexus_erp'); } catch { /* Database already exists from a previous run. */ }
const url = `postgresql://nexus_local:${meta.password}@127.0.0.1:${dbPort}/nexus_erp`;
const env = { ...process.env, DATABASE_URL: url, ADMIN_EMAIL: admin.ADMIN_EMAIL, ADMIN_PASSWORD: admin.ADMIN_PASSWORD };

console.log('Applying migrations …');
await run([process.execPath, 'node_modules/tsx/dist/cli.mjs', 'src/cli.ts', 'migrate'], join(root, 'backend'), env);
await run([process.execPath, 'node_modules/tsx/dist/cli.mjs', 'src/cli.ts', 'admin'], join(root, 'backend'), env);

if (!existsSync(join(root, 'backend', 'dist', 'main.js'))) {
  console.log('Building backend …');
  await run([process.execPath, join(root, 'backend', 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(root, 'backend', 'tsconfig.json')], root, process.env);
}
if (!existsSync(join(root, 'apps', 'web', '.next', 'BUILD_ID'))) {
  console.log('Building frontend …');
  await run([process.execPath, join(root, 'apps', 'web', 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], join(root, 'apps', 'web'), { ...process.env, BACKEND_URL: 'http://127.0.0.1:3000' });
}

console.log('Starting backend (loopback) and frontend (LAN) …');
keep([process.execPath, 'dist/main.js'], join(root, 'backend'), { ...env, PORT: String(apiPort), HOST: '127.0.0.1', CORS_ORIGIN: `http://localhost:${webPort}` });
keep([process.execPath, join(root, 'apps', 'web', 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '--hostname', '0.0.0.0', '--port', String(webPort)], join(root, 'apps', 'web'), { ...process.env, BACKEND_URL: 'http://127.0.0.1:3000', NODE_ENV: 'production' });

const waitHealthy = async (port, path) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (stopping) return false;
    if ([...children].some(c => c.exitCode !== null)) throw new Error('A service exited during startup; check the logs above.');
    try { const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2000) }); if (res.ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`Service on port ${port} did not become healthy.`);
};
await waitHealthy(apiPort, '/api/v1/health');
await waitHealthy(webPort, '/');

const lan = Object.values(networkInterfaces()).flat().filter(i => i?.family === 'IPv4' && !i.internal).map(i => i.address);
await writeFile(pidFile, JSON.stringify({ pid: process.pid, dbPort, apiPort, webPort }));
console.log('');
console.log('MyEkalliptus local services are running.');
console.log(`  Web (PC ini)        : http://localhost:${webPort}`);
for (const ip of lan) console.log(`  Web (WiFi/LAN)      : http://${ip}:${webPort}`);
console.log(`  API Flutter emulator: http://10.0.2.2:${webPort}/api/v1`);
for (const ip of lan) console.log(`  API Flutter (HP/WiFi): http://${ip}:${webPort}/api/v1`);
console.log(`  Admin login         : lihat .env (ADMIN_EMAIL / ADMIN_PASSWORD)`);
console.log('');
console.log('Stop with: npm run local:down');
await new Promise(() => {});

