import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const page = fs.readFileSync(
  path.join(root, 'app/(site)/mypage/configurations/[id]/request-quote/page.tsx'),
  'utf8'
);
const form = fs.readFileSync(path.join(root, 'components/mypage/quote-request-form.tsx'), 'utf8');

describe('見積依頼：シミュレーターで保存した設置予定地域の表示', () => {
  it('Configurationの保存済み地域を表示し、未定・未選択を区別する', () => {
    expect(page).toContain("const selectedSiteAreaLabel = configuration.site_location_undecided");
    expect(page).toContain("? '未定'");
    expect(page).toContain("[configuration.site_prefecture, configuration.site_municipality].filter(Boolean).join(' ') || '未選択'");
    expect(page).toContain('selectedSiteAreaLabel={selectedSiteAreaLabel}');
  });

  it('詳細住所は自動補完せず、従来どおり任意入力にする', () => {
    expect(form).toContain('data-testid="quote-request-selected-site-area"');
    expect(form).toContain('シミュレーターで選択した設置予定地');
    expect(form).toContain('{selectedSiteAreaLabel}');
    expect(form).toContain('label="詳しい設置住所・地番（任意）"');
    expect(form).toContain('name="site_address" defaultValue={v.site_address}');
    expect(form).not.toContain('name="site_address" value={selectedSiteAreaLabel}');
  });

  it('土地の希望地域と見積依頼の送信フローは変更しない', () => {
    expect(page).toContain('siteArea={siteArea}');
    expect(form).toContain('defaultDesiredArea={siteArea}');
    expect(form).toContain('action={action}');
    expect(form).toContain('name="configuration_id" value={configurationId}');
    expect(form).toContain('name="expected_lock_version" value={lockVersion ?? \'\'}');
  });
});
