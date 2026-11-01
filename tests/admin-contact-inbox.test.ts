import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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
