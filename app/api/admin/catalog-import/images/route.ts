import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { getStore, isLocalMode } from '@/lib/data/store';
import { hasRoleAtLeast } from '@/lib/domain/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const LOCAL_URL_RE = /^\/api\/local-files\/catalog-import\/[A-Za-z0-9._-]+$/;

async function authorize() {
  if (!isLocalMode()) return null;
  const user = await getSessionUser();
  return user && hasRoleAtLeast(user.role, 'master_dealer') ? user : null;
}

/** ローカル検証専用。Route HandlerなのでServer Actionの4MB上限とは独立する。 */
export async function POST(request: NextRequest) {
  if (!(await authorize())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File) || !ALLOWED_IMAGE_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: '画像は JPEG / PNG / WebP / AVIF、1ファイル10MB以下にしてください。' }, { status: 400 });
  }
  const store = await getStore();
  const url = await store.uploadImage(
    { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type, fileName: file.name },
    'catalog-import'
  );
  return NextResponse.json({ url });
}

/** Apply前の失敗時に、この操作で作ったローカル画像だけを削除する。 */
export async function DELETE(request: NextRequest) {
  if (!(await authorize())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await request.json().catch(() => null) as { urls?: unknown } | null;
  const urls = Array.isArray(body?.urls) ? body.urls.slice(0, 1000) : [];
  const valid = urls.filter((url): url is string => typeof url === 'string' && LOCAL_URL_RE.test(url));
  const store = await getStore();
  const results = await Promise.allSettled(valid.map((url) => store.deleteUploadedImage(url)));
  const failed = urls.length - valid.length + results.filter((result) => result.status === 'rejected').length;
  return NextResponse.json({ failed });
}
