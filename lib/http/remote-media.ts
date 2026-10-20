import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_REDIRECTS = 4;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_TRANSPORT_ATTEMPTS = 2;
const USER_AGENT = 'SenNoKazeProductMediaImporter/1.0';

export type RemoteMediaKind = 'image' | 'pdf';

export interface RemoteMediaFile {
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
  finalUrl: string;
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

function blockedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function blockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith('ff')) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? blockedIpv4(mapped) : false;
}

export function isBlockedRemoteAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return blockedIpv4(address);
  if (version === 6) return blockedIpv6(address);
  return true;
}

function validateUrlShape(value: string): URL {
  if (!value || value.length > 2048) throw new Error('URLを確認してください。');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('有効なURLを入力してください。');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('http または https のURLを入力してください。');
  }
  if (url.username || url.password) throw new Error('認証情報を含むURLは登録できません。');
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new Error('80 / 443 以外のポートを指定したURLは登録できません。');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('内部ネットワークのURLは登録できません。');
  }
  return url;
}

async function validatePublicHost(url: URL): Promise<void> {
  const host = url.hostname;
  if (isIP(host)) {
    if (isBlockedRemoteAddress(host)) throw new Error('内部ネットワークのURLは登録できません。');
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error('URLの接続先を確認できませんでした。');
  }
  if (addresses.length === 0 || addresses.some((row) => isBlockedRemoteAddress(row.address))) {
    throw new Error('内部ネットワークのURLは登録できません。');
  }
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function detectContentType(bytes: Uint8Array): string | null {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) return 'image/png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
    const brands = ascii(bytes, 8, Math.min(bytes.length, 40));
    if (brands.includes('avif') || brands.includes('avis')) return 'image/avif';
  }
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

function extensionFor(contentType: string): string {
  switch (contentType) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/avif': return 'avif';
    case 'application/pdf': return 'pdf';
    default: return 'bin';
  }
}

function fileNameFromUrl(url: URL, contentType: string): string {
  const raw = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? 'media');
  const base = raw.replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'media';
  return `${base.slice(0, 80)}.${extensionFor(contentType)}`;
}

async function readWithLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > maxBytes) throw new Error(`ファイルサイズは${Math.round(maxBytes / 1024 / 1024)}MB以下にしてください。`);

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error(`ファイルサイズは${Math.round(maxBytes / 1024 / 1024)}MB以下にしてください。`);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`ファイルサイズは${Math.round(maxBytes / 1024 / 1024)}MB以下にしてください。`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchRemoteMedia(
  value: string,
  kind: RemoteMediaKind,
  maxBytes: number
): Promise<RemoteMediaFile> {
  let current = validateUrlShape(value.trim());

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await validatePublicHost(current);
    let response: Response | null = null;
    for (let attempt = 1; attempt <= MAX_TRANSPORT_ATTEMPTS; attempt += 1) {
      // 一時的な通信障害だけ再試行する。再試行時も公開接続先の検査を省かない。
      if (attempt > 1) await validatePublicHost(current);
      try {
        response = await fetch(current, {
          cache: 'no-store',
          redirect: 'manual',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: {
            'user-agent': USER_AGENT,
            accept: kind === 'image' ? 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.2' : 'application/pdf,*/*;q=0.2',
          },
        });
        break;
      } catch (error) {
        const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        const cause = error instanceof Error ? error.cause : null;
        const causeCode = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
          ? cause.code
          : undefined;
        // URL全文（クエリに含まれる認証情報等）は記録しない。
        console.warn('[remote-media] URL取込の通信エラー', {
          host: current.hostname,
          kind,
          attempt,
          reason: timeout ? 'timeout' : 'connection',
          causeCode,
        });
        if (attempt === MAX_TRANSPORT_ATTEMPTS) {
          throw new Error(timeout
            ? 'URLからの取得がタイムアウトしました。ファイルをPCに保存して、ファイル選択から登録してください。'
            : 'URLからファイルを取得できませんでした。提供元サイトが外部サーバーからの取得を制限している可能性があります。ファイルをPCに保存して登録してください。');
        }
      }
    }
    if (!response) throw new Error('URLからファイルを取得できませんでした。');

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('URLの転送先を確認できませんでした。');
      if (redirectCount === MAX_REDIRECTS) throw new Error('URLの転送回数が多すぎます。');
      current = validateUrlShape(new URL(location, current).toString());
      continue;
    }

    if (!response.ok) throw new Error(`URLからファイルを取得できませんでした（HTTP ${response.status}）。`);

    const bytes = await readWithLimit(response, maxBytes);
    const detected = detectContentType(bytes);
    if (kind === 'image' && (!detected || !IMAGE_TYPES.has(detected))) {
      throw new Error('URL先が対応画像（JPEG / PNG / WebP / AVIF）ではありません。');
    }
    if (kind === 'pdf' && detected !== 'application/pdf') {
      throw new Error('URL先がPDFファイルではありません。カタログ閲覧ページではなくPDF本体のURLを入力してください。');
    }
    const contentType = detected!;
    return {
      bytes,
      contentType,
      fileName: fileNameFromUrl(current, contentType),
      finalUrl: current.toString(),
    };
  }

  throw new Error('URLからファイルを取得できませんでした。');
}
