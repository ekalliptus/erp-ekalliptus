import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
let url = process.env.DATABASE_URL;
if (!url) {
  if (!existsSync(join(root, '.data', 'local-db.json')) || !existsSync(join(root, '.data', 'local-services.json'))) {
    console.error('DATABASE_URL is not set and no local run database found. Start local services first: npm run local:up');
    process.exit(1);
  }
  const { password } = JSON.parse(await readFile(join(root, '.data', 'local-db.json'), 'utf8'));
  const { dbPort } = JSON.parse(await readFile(join(root, '.data', 'local-services.json'), 'utf8'));
  url = `postgresql://nexus_local:${password}@127.0.0.1:${dbPort}/nexus_erp`;
}
const env = { ...process.env, DATABASE_URL: url, DEMO_PASSWORD: process.env.DEMO_PASSWORD ?? 'DemoMyEkalliptus2026' };
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/cli.ts', 'demo'], { cwd: join(root, 'backend'), env, stdio: 'inherit' });
child.once('exit', code => process.exitCode = code ?? 1);
