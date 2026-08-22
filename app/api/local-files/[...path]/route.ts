import fs from 'node:fs';
import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { isLocalMode } from '@/lib/data/store';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

/** ローカル検証モードのアップロード画像配信（Supabase Storage の代替） */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!isLocalMode()) return new NextResponse('Not found', { status: 404 });
  const { path: parts } = await ctx.params;
  const { filesDir } = await import('@/lib/data/local-db');
  const base = filesDir();
  const abs = path.resolve(base, ...parts);
  if (!abs.startsWith(base) || abs.includes('quotes')) return new NextResponse('Not found', { status: 404 });
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return new NextResponse('Not found', { status: 404 });
  const ext = path.extname(abs).toLowerCase();
  const type = MIME[ext];
  if (!type) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(fs.readFileSync(abs)), {
    headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' },
  });
}
