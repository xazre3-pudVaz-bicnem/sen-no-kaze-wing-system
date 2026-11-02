import { getSessionUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const STORAGE_BUCKET = 'contact-attachments';
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };

const FILE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  pdf: 'application/pdf',
};

function errorResponse(status: number) {
  return new Response(status === 403 ? 'Forbidden' : status === 404 ? 'Not found' : 'Unable to open attachment', {
    status,
    headers: NO_STORE,
  });
}

/**
 * 非公開の問い合わせ添付を本部管理者だけに配信する。
 * クライアントからStorage pathやbucketを受け取らず、RLSで読める問い合わせIDから引く。
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== 'admin') return errorResponse(403);

    const { id } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return errorResponse(404);
    }

    // authenticatedユーザーのRLSを通した上で、同じ行の添付だけを読み込む。
    const supabase = await createClient();
    const { data: contact, error: contactError } = await supabase
      .from('contact_messages')
      .select('attachment_path, attachment_name')
      .eq('id', id)
      .maybeSingle();

    if (contactError) return errorResponse(500);
    if (!contact?.attachment_path || !contact.attachment_name || !contact.attachment_path.startsWith('contact/')) {
      return errorResponse(404);
    }

    const extension = contact.attachment_path.split('.').pop()?.toLowerCase() ?? '';
    const mime = FILE_TYPES[extension];
    if (!mime) return errorResponse(404);

    // service roleキーはサーバー内のみ。署名URL・公開URLをブラウザに渡さない。
    const admin = createAdminClient();
    const { data: blob, error: fileError } = await admin.storage
      .from(STORAGE_BUCKET)
      .download(contact.attachment_path);

    if (fileError || !blob) return errorResponse(404);

    const download = new URL(request.url).searchParams.get('download') === '1';
    const disposition = download ? 'attachment' : 'inline';
    const filename = encodeURIComponent(contact.attachment_name).replace(/['()*]/g, (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );

    return new Response(blob, {
      status: 200,
      headers: {
        ...NO_STORE,
        'Content-Type': mime,
        'Content-Disposition': `${disposition}; filename="attachment"; filename*=UTF-8''${filename}`,
        'Referrer-Policy': 'no-referrer',
        'Vary': 'Cookie',
      },
    });
  } catch {
    return errorResponse(500);
  }
}
