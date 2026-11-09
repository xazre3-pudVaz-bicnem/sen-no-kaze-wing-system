import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const inbox = read('components/admin/contact-inbox.tsx');
const casePage = read('app/admin/quotes/page.tsx');
const page = read('app/admin/contacts/page.tsx');
const forms = read('components/admin/forms.tsx');

describe('問い合わせ受付・メーラー型UI', () => {
  it('本部専用の既存ページを一覧＋詳細の2ペインにし、横長表をなくす', () => {
    expect(page).toContain('await requireAdmin()');
    expect(inbox).toContain('data-testid="contact-inbox-split"');
    expect(inbox).toContain('data-testid="contact-detail-pane"');
    expect(inbox).toContain('aria-label="問い合わせ一覧"');
    expect(inbox).toContain('aria-label="問い合わせ詳細"');
    expect(inbox).not.toContain('min-w-[64rem]');
    expect(inbox).not.toContain('<table');
  });

  it('狭い画面では一覧と詳細を切り替え、一覧へ戻れる', () => {
    expect(inbox).toContain('setMobileDetailOpen(true)');
    expect(inbox).toContain('setMobileDetailOpen(false)');
    expect(inbox).toContain('一覧に戻る');
    expect(inbox).toContain('lg:hidden');
    expect(inbox).toContain('hidden lg:block');
  });

  it('検索・状態別・種類・分類を切り替えられる', () => {
    for (const label of ['未対応', '対応中', '対応済み', '通常（営業・迷惑を除外）']) {
      expect(inbox).toContain(label);
    }
    expect(inbox).toContain('matchesContact(message, query, status, topic)');
    expect(inbox).toContain('setClassificationFilter');
    expect(inbox).toContain('countStatus(option.value)');
  });

  it('保存処理と本部管理者限定の添付URLを維持する', () => {
    expect(inbox).toContain('ContactStatusForm');
    expect(inbox).toContain('ContactClassificationForm');
    expect(inbox).toContain('/api/admin/contacts/');
    expect(inbox).toContain('?download=1');
    expect(inbox).not.toContain('message.attachment_path');
    expect(forms).toContain('updateContactStatusAction');
    expect(forms).toContain('updateContactClassificationAction');
  });

  it('案件管理ページに本部向けの入口と未対応件数を表示する', () => {
    expect(casePage).toContain('data-testid="case-contacts-link"');
    expect(casePage).toContain('href="/admin/contacts"');
    expect(casePage).toContain('store.getNewContactMessageCount()');
    expect(casePage).toContain('{canCreateQuote && (');
  });
});
