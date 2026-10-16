import '@/lib/domain/types';

declare module '@/lib/domain/types' {
  interface ProductOption {
    /** メーカー公式資料に記載された電源仕様。migration前の互換性のため optional。 */
    power_spec?: string | null;
  }
}

export {};
