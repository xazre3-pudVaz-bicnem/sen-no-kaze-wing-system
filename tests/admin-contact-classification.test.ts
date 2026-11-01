import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const inbox = read('components/admin/contact-inbox.tsx');
const forms = read('components/admin/forms.tsx');
const actions = read('lib/actions/admin.ts');
const page = read('app/admin/contacts/page.tsx');
const migration = read('supabase/migrations/20261101140000_contact_inbox_manual_classification.sql');
const supabaseStore = read('lib/data/supabase-store.ts');

describe('問い合わせ受付の手動分類と対応中', () => {
  it('初期表示は通常のみ、営業/迷惑を確認・復帰できる', () => {
    expect(inbox).toContain("useState<ClassificationFilter>('normal')");
    expect(inbox).toContain("(message.classification ?? 'normal') === classificationFilter");
    for (const word of ['営業に分類','迷惑に分類','通常に戻す']) expect(forms).toContain(word);
    for (const item of ['sales','spam','all']) expect(inbox).toContain(`value="${item}"`);
  });
  it('3状態を正しく維持し、古いDBでは新しい選択を使わせない', () => {
    expect(forms).toContain('対応中');
    expect(page).toContain('classificationReady');
    expect(page).toContain('message.classification !== undefined');
    expect(forms).toContain('if (!classificationReady)');
    for (const s of ['new','in_progress','handled']) expect(migration).toContain(`'${s}'`);
  });
  it('本部だけが保存し、既存データとRLSを維持する', () => {
    const code = actions.slice(actions.indexOf('export async function updateContactClassificationAction'));
    expect(code).toContain('await requireAdmin()');
    expect(code).toContain('store.updateContactClassification');
    expect(supabaseStore).toContain('.update({ classification }).eq(\'id\', id)');
    expect(migration).toContain("default 'normal'");
    expect(migration).not.toContain('create policy');
    expect(migration).not.toContain('delete from');
  });
});
