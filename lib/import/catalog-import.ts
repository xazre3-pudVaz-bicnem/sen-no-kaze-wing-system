import type { Sheet } from './archive';

/**
 * 先方の商品マスター（Wing_product_master.xlsx）を取り込む。
 *
 * シート構成：商品一覧／お客様選択項目／画像一覧／カテゴリー一覧。
 * 実ファイルは列がずれている行がある（画像ファイル名が「Wing追加価格」の列に入っている等）ため、
 * **見出し位置だけを信じず、値の形からも判定する**。取り込みで落ちるより、
 * 拾えたものを取り込んで残りを警告に出すほうが運用しやすい。
 */

export interface ImportedProduct {
  code: string;
  categoryName: string;
  name: string;
  manufacturer: string | null;
  modelNo: string | null;
  sizeNote: string | null;
  listPrice: number | null;
  price: number | null;
  description: string | null;
  highlight: string | null;
  imageFile: string | null;
  sortOrder: number;
}

export interface ImportedChoice {
  productCode: string;
  groupName: string;
  choiceName: string;
  kind: 'standard' | 'option' | 'fixed';
  extraPrice: number | null;
  priceOnRequest: boolean;
  imageFile: string | null;
  note: string | null;
  sortOrder: number;
}

export interface ImportedCategory {
  code: string;
  name: string;
  sortOrder: number;
  note: string | null;
}

export interface ImportPlan {
  categories: ImportedCategory[];
  products: ImportedProduct[];
  /** 商品ごとの選択項目（グループ名 → 選択肢） */
  choices: ImportedChoice[];
  images: { file: string; productCode: string | null; purpose: string | null }[];
  warnings: string[];
}

const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif)$/i;
const isImage = (v: string) => IMAGE_RE.test(v.trim());
const isBlank = (v: string | undefined) => !v || !v.trim();

/**
 * 「584000」「584,000」「¥584,000」「584,000円」→ 584000。
 * セル全体が金額のときだけ数値として扱う。
 * 「奥行650mmの省スペース性…」のような説明文から数字を拾ってしまわないようにする。
 */
function toPrice(v: string | undefined): number | null {
  if (isBlank(v)) return null;
  const t = v!.trim().replace(/\s/g, '');
  if (!/^[¥￥]?-?[\d,]+円?$/.test(t)) return null;
  const n = Number(t.replace(/[^\d-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toInt(v: string | undefined, fallback: number): number {
  const n = toPrice(v);
  return n == null ? fallback : n;
}

/** 見出し行を探す。指定した語をすべて含む行を見出しとみなす */
function findHeader(rows: string[][], must: string[]): { index: number; cols: Map<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const row = rows[i].map((c) => c.replace(/\s/g, ''));
    if (must.every((m) => row.some((c) => c.includes(m)))) {
      const cols = new Map<string, number>();
      row.forEach((c, idx) => {
        if (c) cols.set(c, idx);
      });
      return { index: i, cols };
    }
  }
  return null;
}

const col = (cols: Map<string, number>, ...names: string[]): number => {
  for (const n of names) {
    for (const [key, idx] of cols) if (key.includes(n)) return idx;
  }
  return -1;
};

const at = (row: string[], idx: number): string => (idx >= 0 ? (row[idx] ?? '') : '');

/** 区分の表記を正規化する */
function toKind(v: string): 'standard' | 'option' | 'fixed' {
  const s = v.replace(/\s/g, '');
  if (/固定/.test(s)) return 'fixed';
  if (/標準/.test(s)) return 'standard';
  return 'option';
}

/**
 * よく出る日本語をコードへ置き換えるための表。
 * 日本語のままだとコードが作れず「g1」「c3」のような意味のない値になり、
 * 画面やテストから参照しづらいので、主要な語だけ英字に寄せる。
 */
const TERMS: [RegExp, string][] = [
  [/壁プラン/, 'wall-plan'],
  [/壁色|壁カラー/, 'wall-color'],
  [/扉色|扉カラー/, 'door-color'],
  [/水栓・シャワー/, 'shower-faucet'],
  [/シャワー/, 'shower'],
  [/水栓/, 'faucet'],
  [/照明/, 'light'],
  [/鏡・収納/, 'mirror-storage'],
  [/ミラー|鏡/, 'mirror'],
  [/出入口/, 'entrance'],
  [/浴槽断熱/, 'bath-insulation'],
  [/高断熱|断熱/, 'insulation'],
  [/トイレ本体/, 'toilet-body'],
  [/洗面本体/, 'wash-body'],
  [/本体/, 'body'],
  [/サイズ/, 'size'],
  [/全面/, 'full'],
  [/アクセント/, 'accent'],
  [/ウォールナット/, 'walnut'],
  [/オーク/, 'oak'],
  [/クイーン/, 'queen'],
  [/エンボス/, 'emboss'],
  [/ルナーク/, 'lunaak'],
  [/クリエペール/, 'crie-pale'],
  [/クリエダーク/, 'crie-dark'],
  [/グレージュ/, 'greige'],
  [/ベージュ/, 'beige'],
  [/ホワイト/, 'white'],
  [/グレー/, 'gray'],
  [/低床/, 'low-floor'],
  [/収納/, 'storage'],
  [/ダーク/, 'dark'],
  [/ライト/, 'light'],
  [/標準/, 'standard'],
  [/固定/, 'fixed'],
  [/なし/, 'none'],
  [/カラー|色/, 'color'],
  [/仕様/, 'spec'],
];

/**
 * コード用の識別子を作る（英数字とハイフンだけ）。
 * 日本語は上の表で英字へ寄せる。一致した語は取り除いてから次を見るので、
 * 「オークグレージュ」が oak-greige になり、greige-gray のように重ならない。
 */
export function slugify(input: string, fallback: string): string {
  const direct = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (direct && /[a-z]/.test(direct)) return direct;

  let rest = input;
  const parts: string[] = [];
  for (const [re, code] of TERMS) {
    const m = rest.match(re);
    if (!m) continue;
    rest = rest.replace(re, '');
    if (!parts.includes(code)) parts.push(code);
  }
  // 残った数字（「1216」「1面」など）も識別に使う
  const digits = rest.match(/d+/)?.[0];
  if (digits) parts.push(digits);
  if (parts.length) return parts.slice(0, 3).join('-');
  return direct || fallback;
}

export function buildImportPlan(sheets: Sheet[]): ImportPlan {
  const warnings: string[] = [];
  const find = (...keys: string[]) => sheets.find((s) => keys.some((k) => s.name.replace(/\s/g, '').includes(k)));

  const plan: ImportPlan = { categories: [], products: [], choices: [], images: [], warnings };

  /* ---------- カテゴリー一覧 ---------- */
  const catSheet = find('カテゴリー');
  if (catSheet) {
    const h = findHeader(catSheet.rows, ['カテゴリーID', 'カテゴリー名']);
    if (!h) warnings.push('「カテゴリー一覧」シートの見出し行が見つかりませんでした。');
    else {
      const cId = col(h.cols, 'カテゴリーID');
      const cName = col(h.cols, 'カテゴリー名');
      const cSort = col(h.cols, '表示順');
      const cNote = col(h.cols, '主な内容', '備考');
      for (const row of catSheet.rows.slice(h.index + 1)) {
        const code = at(row, cId).trim();
        const name = at(row, cName).trim();
        if (!code || !name) continue;
        plan.categories.push({
          code: slugify(code, code),
          name,
          sortOrder: toInt(at(row, cSort), plan.categories.length + 1),
          note: at(row, cNote).trim() || null,
        });
      }
    }
  }

  /* ---------- 商品一覧 ---------- */
  const prodSheet = find('商品一覧', '商品マスター');
  if (!prodSheet) warnings.push('「商品一覧」シートが見つかりませんでした。');
  else {
    const h = findHeader(prodSheet.rows, ['商品ID', '商品名']);
    if (!h) warnings.push('「商品一覧」シートの見出し行が見つかりませんでした。');
    else {
      const cCode = col(h.cols, '商品ID');
      const cCat = col(h.cols, 'カテゴリー');
      const cMaker = col(h.cols, 'メーカー');
      const cName = col(h.cols, '商品名');
      const cHighlight = col(h.cols, '位置づけ');
      const cSize = col(h.cols, '主なサイズ', 'サイズ');
      const cList = col(h.cols, 'メーカー参考価格', '参考価格');
      const cPrice = col(h.cols, 'Wing表示価格', '表示価格');
      const cDesc = col(h.cols, '短い説明', '説明');
      const cSort = col(h.cols, '表示順');

      for (const row of prodSheet.rows.slice(h.index + 1)) {
        const code = at(row, cCode).trim();
        if (!code) continue;
        const name = at(row, cName).trim();
        if (!name) {
          warnings.push(`商品「${code}」に商品名がないため取り込みませんでした。`);
          continue;
        }
        // 参考価格と表示価格は列がずれている行があるので、数値かどうかで拾い直す
        const listRaw = at(row, cList);
        const priceRaw = at(row, cPrice);
        let listPrice = toPrice(listRaw);
        let price = toPrice(priceRaw);
        if (listPrice == null && price != null) {
          // 参考価格が空欄で説明文が左へずれた行
          listPrice = price;
          price = null;
        }
        const descCandidates = [at(row, cDesc), priceRaw, listRaw].filter((v) => v && toPrice(v) == null && !isImage(v));

        plan.products.push({
          code,
          categoryName: at(row, cCat).trim(),
          name,
          manufacturer: at(row, cMaker).trim() || null,
          modelNo: name,
          sizeNote: at(row, cSize).trim() || null,
          listPrice,
          price,
          description: descCandidates[0]?.trim() || null,
          highlight: at(row, cHighlight).trim() || null,
          imageFile: null,
          sortOrder: toInt(at(row, cSort), plan.products.length + 1),
        });
        if (price == null) {
          warnings.push(`商品「${name}」に Wing 表示価格が入っていないため「要見積」として登録します。`);
        }
      }
    }
  }

  /* ---------- 画像一覧 ---------- */
  const imgSheet = find('画像一覧', '画像');
  if (imgSheet) {
    const h = findHeader(imgSheet.rows, ['画像ファイル名']);
    if (h) {
      const cFile = col(h.cols, '画像ファイル名');
      const cTarget = col(h.cols, '対象商品ID');
      const cUse = col(h.cols, '用途');
      for (const row of imgSheet.rows.slice(h.index + 1)) {
        const file = at(row, cFile).trim();
        if (!file || !isImage(file)) continue;
        plan.images.push({
          file,
          productCode: at(row, cTarget).trim() || null,
          purpose: at(row, cUse).trim() || null,
        });
      }
    }
  }
  // 商品のメイン画像を画像一覧から引き当てる
  for (const p of plan.products) {
    const main = plan.images.find((i) => i.productCode === p.code && /メイン|main/i.test(i.purpose ?? ''));
    p.imageFile = main?.file ?? null;
  }

  /* ---------- お客様選択項目 ---------- */
  const varSheet = find('お客様選択項目', '選択項目');
  if (!varSheet) warnings.push('「お客様選択項目」シートが見つかりませんでした。');
  else {
    const h = findHeader(varSheet.rows, ['選択項目', '選択肢']);
    if (!h) warnings.push('「お客様選択項目」シートの見出し行が見つかりませんでした。');
    else {
      const cParent = col(h.cols, '親商品ID');
      const cGroup = col(h.cols, '選択項目');
      const cSort = col(h.cols, '表示順');
      const cChoice = col(h.cols, '選択肢');
      const cTarget = col(h.cols, '対象商品ID');
      const cKind = col(h.cols, '区分');
      const cPrice = col(h.cols, '追加価格');
      const cImage = col(h.cols, '画像ファイル名');
      const cCond = col(h.cols, '適用条件');
      const cNote = col(h.cols, '備考');
      const productCodes = new Set(plan.products.map((p) => p.code));

      for (const row of varSheet.rows.slice(h.index + 1)) {
        const choiceName = at(row, cChoice).trim();
        if (!choiceName) continue;

        // 対象商品ID が実在すればそれ、なければ親商品ID を使う
        const target = at(row, cTarget).trim();
        const parent = at(row, cParent).trim();
        const productCode = productCodes.has(target) ? target : productCodes.has(parent) ? parent : '';
        if (!productCode) {
          warnings.push(`選択肢「${choiceName}」の商品が特定できないため取り込みませんでした（対象=${target || '空'} 親=${parent || '空'}）。`);
          continue;
        }

        // 選択項目名。「トイレ本体」のように親商品ID 欄へ入っている行がある
        let groupName = at(row, cGroup).trim();
        if (!groupName) groupName = productCodes.has(parent) ? '仕様' : parent || '仕様';

        // 追加価格・画像は列がずれるので、値の形から拾い直す
        const cells = [at(row, cPrice), at(row, cImage), at(row, cCond), at(row, cNote)];
        const imageFile = cells.find(isImage)?.trim() ?? null;
        const extraPrice = toPrice(at(row, cPrice));
        const priceText = at(row, cPrice).trim();
        const priceOnRequest = extraPrice == null && /仮確定|要見積|未定/.test(priceText);

        plan.choices.push({
          productCode,
          groupName,
          choiceName,
          kind: toKind(at(row, cKind)),
          extraPrice,
          priceOnRequest,
          imageFile,
          note: [at(row, cCond), at(row, cNote)].map((v) => v.trim()).filter((v) => v && !isImage(v) && v !== priceText)[0] ?? null,
          sortOrder: toInt(at(row, cSort), 0),
        });
      }
    }
  }

  if (plan.products.length === 0) warnings.push('取り込める商品が 1 件もありませんでした。シートの見出しをご確認ください。');
  return plan;
}

/** 取り込み結果の要約（画面に出す） */
export function summarize(plan: ImportPlan) {
  const groups = new Set(plan.choices.map((c) => `${c.productCode}/${c.groupName}`));
  return {
    categories: plan.categories.length,
    products: plan.products.length,
    variantGroups: groups.size,
    variantChoices: plan.choices.length,
    images: plan.images.length,
    warnings: plan.warnings.length,
  };
}
