import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/customers/page.tsx'), 'utf8');

describe('ユーザー・担当者画面', () => {
  it('担当者を中心に表示し、顧客は必要な場合だけ含める', () => {
    expect(page).toContain("profile.role_code !== 'customer'");
    expect(page).toContain('顧客アカウントを含める');
    expect(page).toContain("sp.include_customers === '1'");
    expect(page).toContain('通常は本部・総代理店・代理店の担当者だけを表示します。');
  });

  it('担当者管理に不要な地域・保存仕様列を外す', () => {
    expect(page).not.toContain('RegionFilter');
    expect(page).not.toContain('listAllConfigurations');
    expect(page).not.toContain('<Th>住所</Th>');
    expect(page).not.toContain('保存仕様');
    for (const label of ['氏名 / 法人', '連絡先', '現在の権限', '登録日', '権限変更']) {
      expect(page).toContain(label);
    }
  });

  it('検索と権限絞り込み、権限説明の折り畳みを用意する', () => {
    expect(page).toContain('氏名・法人・メールで検索');
    expect(page).toContain('name="role"');
    expect(page).toContain('権限の説明を見る');
    expect(page).toContain('正式な所属組織・招待／停止状態は、組織管理の正式接続後に追加します。');
  });
});
