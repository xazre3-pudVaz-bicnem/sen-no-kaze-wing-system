import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const root = process.cwd();
const page = fs.readFileSync(path.join(root, 'app/admin/contacts/page.tsx'), 'utf8');
const inbox = fs.readFileSync(path.join(root, 'components/admin/contact-inbox.tsx'), 'utf8');
const route = fs.readFileSync(path.join(root, 'app/api/admin/contacts/[id]/attachment/route.ts'), 'utf8');

describe('問い合わせ受付の実運用向け改善', () => {
  it('本部専用ページのまま一覧・検索・絞り込み・詳細表示を提供する', () => {
    expect(page).toContain('await requireAdmin()');
    expect(page).toContain('<ContactInbox messages={messages} />');
    expect(inbox).toContain('type StatusFilter');
    expect(inbox).toContain('setQuery');
    expect(inbox).toContain('setStatus');
    expect(inbox).toContain('setTopic');
    expect(inbox).toContain('matchesContact(message, query, status, topic)');
    expect(inbox).toContain('詳細を見る');
    expect(inbox).toContain('truncate');
    expect(inbox).toContain('ContactStatusForm');
  });

  it('添付ファイルはIDで参照し、ブラウザにはStorage pathをURLとして渡さない', () => {
    expect(inbox).toContain('/api/admin/contacts/');
    expect(inbox).toContain('?download=1');
    expect(inbox).not.toContain('storage/v1/object');
    expect(inbox).not.toContain('getPublicUrl');
  });

  it('ダウンロード処理はadmin判定とRLSを通して非公開Storageを参照する', () => {
    const adminCheck = route.indexOf("user.role !== 'admin'");
    const dbRead = route.indexOf(".from('contact_messages')");
    const storageDownload = route.indexOf('.download(contact.attachment_path)');
    expect(adminCheck).toBeGreaterThan(-1);
    expect(dbRead).toBeGreaterThan(adminCheck);
    expect(storageDownload).toBeGreaterThan(dbRead);
    expect(route).toContain("STORAGE_BUCKET = 'contact-attachments'");
    expect(route).toContain("contact.attachment_path.startsWith('contact/')");
    expect(route).toContain("private, no-store");
    expect(route).toContain("'X-Content-Type-Options': 'nosniff'");
    expect(route).toContain("'Content-Disposition'");
    expect(route).not.toContain('createSignedUrl');
    expect(route).not.toContain('getPublicUrl');
  });
});


const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));

import { GET } from '@/app/api/admin/contacts/[id]/attachment/route';

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_PATH = 'contact/example.png';

function request(download = false) {
  return new Request(`https://example.test/api/admin/contacts/${CONTACT_ID}/attachment${download ? '?download=1' : ''}`);
}

function params(id = CONTACT_ID) {
  return { params: Promise.resolve({ id }) };
}

function mockContactAndStorage(path = CONTACT_PATH) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: { attachment_path: path, attachment_name: '図面.png' },
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const download = vi.fn().mockResolvedValue({
    data: new Blob(['fake-image'], { type: 'image/png' }),
    error: null,
  });
  const bucket = vi.fn().mockReturnValue({ download });
  mocks.createClient.mockResolvedValue({ from });
  mocks.createAdminClient.mockReturnValue({ storage: { from: bucket } });
  return { from, eq, bucket, download };
}

describe('問い合わせ添付APIのアクセス制御', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([null, { role: 'customer' }, { role: 'dealer' }, { role: 'master_dealer' }])(
    '非本部アカウントは取得不可（%j）',
    async (session) => {
      mocks.getSessionUser.mockResolvedValue(session);
      const response = await GET(request(), params());
      expect(response.status).toBe(403);
      expect(mocks.createClient).not.toHaveBeenCalled();
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    },
  );

  it('不正な問い合わせIDはStorageアクセス前に拒否する', async () => {
    mocks.getSessionUser.mockResolvedValue({ role: 'admin' });
    const response = await GET(request(), params('../other'));
    expect(response.status).toBe(404);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('本部だけがDB上の添付パスからファイルを閲覧・保存できる', async () => {
    mocks.getSessionUser.mockResolvedValue({ role: 'admin' });
    const { from, eq, bucket, download } = mockContactAndStorage();
    const preview = await GET(request(), params());
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toBe('image/png');
    expect(preview.headers.get('cache-control')).toContain('no-store');
    expect(preview.headers.get('content-disposition')).toContain('inline;');
    expect(await preview.text()).toBe('fake-image');
    expect(from).toHaveBeenCalledWith('contact_messages');
    expect(eq).toHaveBeenCalledWith('id', CONTACT_ID);
    expect(bucket).toHaveBeenCalledWith('contact-attachments');
    expect(download).toHaveBeenCalledWith(CONTACT_PATH);

    const saved = await GET(request(true), params());
    expect(saved.status).toBe(200);
    expect(saved.headers.get('content-disposition')).toContain('attachment;');
  });

  it('DBの添付パスが想定外ならservice roleからも読まない', async () => {
    mocks.getSessionUser.mockResolvedValue({ role: 'admin' });
    mockContactAndStorage('other-bucket/secret.png');
    const response = await GET(request(), params());
    expect(response.status).toBe(404);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('DBから対象の行が見つからない場合は取得できない', async () => {
    mocks.getSessionUser.mockResolvedValue({ role: 'admin' });
    mocks.createClient.mockResolvedValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    });
    const response = await GET(request(), params());
    expect(response.status).toBe(404);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
