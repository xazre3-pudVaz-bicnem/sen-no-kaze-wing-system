import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const form = fs.readFileSync(path.join(root, 'components/mypage/quote-request-form.tsx'), 'utf8');
const actions = fs.readFileSync(path.join(root, 'lib/actions/configurations.ts'), 'utf8');

describe('見積依頼：任意項目を折り畳んでも入力と送信を維持する', () => {
  it('土地・打合せの任意項目を初期状態で閉じたネイティブdetailsにする', () => {
    expect(form.match(/<details\b/g)).toHaveLength(2);
    expect(form).toContain('data-testid="quote-request-site-profile-disclosure"');
    expect(form).toContain('data-testid="quote-request-preferences-disclosure"');
    expect(form).toContain('<span>土地について（任意）</span>');
    expect(form).toContain('<span>打合せのご希望（任意）</span>');
    expect(form).toContain('<summary className=');
    // openを固定trueにはせず、土地入力エラー時だけ自動で開く。
    expect(form).toContain("open={Boolean(state.error?.startsWith('設置予定地・土地：'))}");
    expect(form).not.toContain('defaultOpen');
  });

  it('土地の選択欄を閉じてもマウントしたまま保持し、送信時のフォームデータから除外しない', () => {
    const start = form.indexOf('data-testid="quote-request-site-profile-disclosure"');
    const end = form.indexOf('data-testid="quote-request-preferences-disclosure"');
    const land = form.slice(start, end);
    expect(land).toContain('data-testid="quote-request-site-profile"');
    expect(land).toContain('SiteProfileFields profile={siteProfile} values={state.values}');
    expect(land).toContain('includeAddress={false} defaultDesiredArea={siteArea}');
    expect(land).not.toContain('disabled={');
    expect(form).toContain('name="site_profile_lock_version" value={v.site_profile_lock_version ?? \'\'}');
  });

  it('打合せの代理店・方法・希望日3件・要望欄を保持する', () => {
    const start = form.indexOf('data-testid="quote-request-preferences-disclosure"');
    const meeting = form.slice(start, form.indexOf('      </details>', start));
    expect(meeting).toContain('data-testid="quote-request-preferences"');
    for (const name of ['preferred_dealer_id', 'meeting_method', 'slot_${n}_date', 'slot_${n}_period', 'schedule_note']) {
      expect(meeting).toContain(name);
    }
    expect(meeting).toContain('{[1, 2, 3].map((n) => (');
    expect(meeting).not.toContain('disabled={');
  });

  it('必須連絡先・設置予定地表示・送信Action・金額は変更しない', () => {
    expect(form).toContain('data-testid="quote-request-selected-site-area"');
    expect(form).toContain('name="site_address" defaultValue={v.site_address}');
    for (const name of ['full_name', 'email', 'phone', 'address']) {
      expect(form).toContain(`name="${name}"`);
    }
    expect(form).toContain('<form action={action}');
    expect(form).toContain('name="expected_lock_version" value={lockVersion ?? \'\'}');
    expect(actions).toContain('saveSiteProfileFromForm(user, configuration_id, formData)');
    expect(actions).toContain('saveQuoteRequestPreferencesFromForm(user, requestId, formData)');
  });
});
