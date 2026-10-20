import '@/lib/domain/types';

declare module '@/lib/domain/types' {
  interface ProductOption {
    /** 商品価格 price の1単位あたりの単位。例: 台、ケース、㎡。 */
    price_unit?: string | null;
    /** メーカー参考価格 list_price の1単位あたりの単位。 */
    list_price_unit?: string | null;
  }
}
