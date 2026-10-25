import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SAME_SITE_ADDRESS_CONFIRMATION_FIELD,
  sameContactAndSiteAddress,
} from '../lib/domain/quote-contact-site-address';

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const form = source('components/mypage/quote-request-form.tsx');
const action = source('lib/actions/configurations.ts');

describe('見積依頼：連絡先住所と設置住所が同一の場合の誤入力防止', () => {
  it('空の設置先は任意のまま通過し、異なる設置先も警告対象にしない', () => {
    expect(sameContactAndSiteAddress('千葉市花見川区', null)).toBe(false);
    expect(sameContactAndSiteAddress('千葉市花見川区', '')).toBe(false);
    expect(sameContactAndSiteAddress(null, '千葉市花見川区')).toBe(false);
    expect(sameContactAndSiteAddress('千葉市花見川区', '北海道札幌市中央区')).toBe(false);
  });

  it('全角・半角と空白差も含め、同じ住所を検出できる', () => {
    expect(sameContactAndSiteAddress('千葉市花見川区西小中台１－１', ' 千葉市花見川区西小中台1-1 ')).toBe(true);
    expect(sameContactAndSiteAddress('千葉市 花見川区', '千葉市花見川区')).toBe(true);
    expect(sameContactAndSiteAddress('千葉市花見川区1-1', '千葉市花見川区1-2')).toBe(false);
  });

  it('同じ住所のときだけ確認UIを出し、入力欄の意味・項目名を保つ', () => {
    expect(form).toContain('sameContactAndSiteAddress(contactAddress, siteAddress)');
    expect(form).toContain('data-testid="quote-request-same-address-confirmation"');
    expect(form).toContain('name={SAME_SITE_ADDRESS_CONFIRMATION_FIELD}');
    expect(form).toContain('checked={sameAddressConfirmed}');
    expect(form).toContain('setSameAddressConfirmed(false)');
    expect(form).toContain('name="address" defaultValue={v.address} autoComplete="street-address" required');
    expect(form).toContain('name="site_address" defaultValue={v.site_address} autoComplete="off"');
    expect(form).toContain('設置場所が未定なら空欄');
  });

  it('サーバー側でも一致を判定し、未確認時は土地保存・見積発行前に止める', () => {
    expect(SAME_SITE_ADDRESS_CONFIRMATION_FIELD).toBe('confirm_same_site_address');
    const validation = action.indexOf('const parsed = quoteRequestSchema.safeParse(raw)');
    const gate = action.indexOf('if (sameContactAndSiteAddress(contact.address, contact.site_address)');
    const siteSave = action.indexOf('const land = await saveSiteProfileFromForm(');
    const issue = action.indexOf('await store.createQuoteFromConfiguration(');
    expect(validation).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(validation);
    expect(siteSave).toBeGreaterThan(gate);
    expect(issue).toBeGreaterThan(siteSave);
    expect(action).toContain("formData.get(SAME_SITE_ADDRESS_CONFIRMATION_FIELD) !== 'on'");
    expect(action).toContain('return { ok: false, error: SAME_SITE_ADDRESS_CONFIRMATION_MESSAGE, values };');
  });

  it('発行済み見積とPDF、見積金額の計算方法は変更しない', () => {
    expect(action).toContain('createQuoteFromConfiguration(user, configuration_id, contact as QuoteContact, message, expected_lock_version)');
    expect(action).toContain('saveQuoteRequestPreferencesFromForm(user, requestId, formData)');
    expect(form).toContain('selectedSiteAreaLabel');
    expect(form).toContain('type="submit"');
  });
});
