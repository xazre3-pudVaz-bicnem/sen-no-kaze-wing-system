export type EstimateDemoSampleRow = {
  id: string;
  section: '本体' | '内外装工事' | 'オプション' | '別途';
  name: string;
  quantity: number;
  unit: string;
  cost: number;
  sale: number;
  manualSale: boolean;
  priceOnRequest: boolean;
  remark: string;
  source: 'base' | 'product' | 'free';
};

export type EstimateDemoSample = {
  id: string;
  name: string;
  model: string;
  spec: string;
  fireSpec: string;
  region: string;
  baseMaster: string;
  sourceSheet: string;
  sourceFile: string;
  sourceSubtotal: number;
  adjustment: number;
  tax: number;
  sourceTotal: number;
  rows: EstimateDemoSampleRow[];
};
