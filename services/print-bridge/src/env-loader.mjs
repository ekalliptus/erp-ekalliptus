import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const PLACEHOLDER_TOKEN_HINT = 'ganti_dengan_token';

/**
 * Load environment variables for print-bridge from both repo root and bridge directory.
 * Precedence (lowest to highest):
 *   1. <repoRoot>/.env
 *   2. <bridgeRoot>/.env
 *   3. <repoRoot>/.env.local
 *   4. <bridgeRoot>/.env.local
 *   5. Pre-existing process/shell env vars
 */
export function loadBridgeEnv({ bridgeRoot, targetEnv = process.env } = {}) {
  const resolvedBridgeRoot =
    bridgeRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const resolvedRepoRoot = path.resolve(resolvedBridgeRoot, '../..');

  const initialKeys = new Set(Object.keys(targetEnv));
  const candidates = [
    path.join(resolvedRepoRoot, '.env'),
    path.join(resolvedBridgeRoot, '.env'),
    path.join(resolvedRepoRoot, '.env.local'),
    path.join(resolvedBridgeRoot, '.env.local'),
  ];

  const loadedFiles = [];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;

    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = dotenv.parse(raw);
    loadedFiles.push(path.basename(filePath) === '.env.local' && filePath.startsWith(resolvedRepoRoot)
      ? `root/${path.basename(filePath)}`
      : path.relative(resolvedRepoRoot, filePath).replace(/\\/g, '/') || path.basename(filePath));

    for (const [key, value] of Object.entries(parsed)) {
      if (initialKeys.has(key)) continue;
      const trimmed = String(value ?? '').trim();
      if (trimmed === '') continue;

      const existing = String(targetEnv[key] ?? '').trim();
      if (
        key === 'PRINT_AGENT_TOKEN' &&
        trimmed.includes(PLACEHOLDER_TOKEN_HINT) &&
        existing &&
        !existing.includes(PLACEHOLDER_TOKEN_HINT)
      ) {
        continue;
      }

      targetEnv[key] = value;
    }
  }

  return { loadedFiles };
}
