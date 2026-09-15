import { describe, expect, it } from 'vitest';
import { PREFECTURES } from '@/lib/domain/address';
import { MUNICIPALITIES_BY_PREFECTURE } from '@/lib/domain/municipalities';

describe('installation location data', () => {
  it('covers every prefecture used by the application', () => {
    for (const prefecture of PREFECTURES) {
      expect(MUNICIPALITIES_BY_PREFECTURE[prefecture]?.length).toBeGreaterThan(0);
    }
  });

  it('contains representative municipalities used by Wing customers', () => {
    expect(MUNICIPALITIES_BY_PREFECTURE['石川県']).toContain('鳳珠郡穴水町');
    expect(MUNICIPALITIES_BY_PREFECTURE['東京都']).toContain('千代田区');
  });

  it('does not contain duplicate municipality names within a prefecture', () => {
    for (const prefecture of PREFECTURES) {
      const municipalities = MUNICIPALITIES_BY_PREFECTURE[prefecture] ?? [];
      expect(new Set(municipalities).size).toBe(municipalities.length);
    }
  });
});
