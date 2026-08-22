import fs from 'node:fs';
import path from 'node:path';

/** .env.local → process.env（dotenv 非依存の最小ローダー。既存の環境変数を優先） */
export function loadEnv(file = '.env.local'): void {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, '');
  }
}

export function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`環境変数 ${key} が未設定です（.env.local を確認してください）`);
    process.exit(1);
  }
  return v;
}

export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return fallback;
}
