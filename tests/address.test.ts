import { describe, expect, it } from 'vitest';
import { matchesRegion, parseAddress, readRegionFilter } from '@/lib/domain/address';

describe('parseAddress（ブロック・県・市町村の読み取り）', () => {
  it('都道府県とブロックを読み取る', () => {
    expect(parseAddress('石川県七尾市1-1')).toEqual({ block: '中部', prefecture: '石川県', city: '七尾市' });
    expect(parseAddress('東京都千代田区丸の内1-1-1')).toEqual({ block: '関東', prefecture: '東京都', city: '千代田区' });
    expect(parseAddress('北海道札幌市中央区北1条')).toEqual({ block: '北海道', prefecture: '北海道', city: '札幌市' });
    expect(parseAddress('沖縄県那覇市おもろまち1-1')).toEqual({ block: '九州・沖縄', prefecture: '沖縄県', city: '那覇市' });
  });

  it('郡は取り除いて町村名にする', () => {
    expect(parseAddress('福岡県糟屋郡新宮町緑ケ浜1-1')).toEqual({ block: '九州・沖縄', prefecture: '福岡県', city: '新宮町' });
  });

  it('「市」を名前に含む市名も正しく読む', () => {
    expect(parseAddress('千葉県市川市八幡1-1')).toEqual({ block: '関東', prefecture: '千葉県', city: '市川市' });
    expect(parseAddress('広島県廿日市市本町1-1')).toEqual({ block: '中国', prefecture: '広島県', city: '廿日市市' });
  });

  it('郵便番号などの前置きがあっても拾う', () => {
    expect(parseAddress('〒926-0000 石川県七尾市府中町1')).toMatchObject({ prefecture: '石川県', city: '七尾市' });
  });

  it('読み取れない住所は null（抽出時は「不明」扱い）', () => {
    expect(parseAddress('')).toEqual({ block: null, prefecture: null, city: null });
    expect(parseAddress('海外 ハワイ州')).toEqual({ block: null, prefecture: null, city: null });
  });
});

describe('matchesRegion', () => {
  const f = (v: Partial<{ block: string; pref: string; city: string }>) =>
    readRegionFilter({ block: v.block, pref: v.pref, city: v.city });

  it('条件なしは常に一致', () => {
    expect(matchesRegion('どこでも', f({}))).toBe(true);
    expect(matchesRegion(null, f({}))).toBe(true);
  });

  it('ブロック・県・市町村で段階的に絞れる', () => {
    const addr = '石川県七尾市1-1';
    expect(matchesRegion(addr, f({ block: '中部' }))).toBe(true);
    expect(matchesRegion(addr, f({ block: '関東' }))).toBe(false);
    expect(matchesRegion(addr, f({ pref: '石川県' }))).toBe(true);
    expect(matchesRegion(addr, f({ pref: '石川県', city: '七尾市' }))).toBe(true);
    expect(matchesRegion(addr, f({ pref: '石川県', city: '金沢市' }))).toBe(false);
  });

  it('条件があるとき、読み取れない住所は除外される', () => {
    expect(matchesRegion('住所未記入', f({ block: '関東' }))).toBe(false);
  });
});
