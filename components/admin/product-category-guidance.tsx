/** Category-specific display guidance used by both draft and published product forms. */
export function productSizeMeta(categoryCode: string): { label: string; placeholder: string } {
  const values: Record<string, { label: string; placeholder: string }> = {
    ub: { label: 'サイズ', placeholder: '例：1216' },
    toilet: { label: '排水・主な仕様', placeholder: '例：床排水／排水芯120mm／手洗いなし' },
    washbasin: { label: '間口・サイズ', placeholder: '例：600mm' },
    kitchen: { label: '間口', placeholder: '例：1200mm' },
    boiler: { label: '号数・ガス種・給湯機能・設置方式', placeholder: '例：16号／LPガス／給湯専用／屋外壁掛型' },
    aircon: { label: '能力クラス・電源', placeholder: '例：2.2kW（6畳程度）／単相100V' },
    roof: { label: '屋根材種類・主な仕様', placeholder: '例：金属屋根／ガルバリウム鋼板／立平葺き' },
    'exterior-wall': { label: '種類・主な仕様', placeholder: '例：窯業系サイディング／16mm／ヨコ張り' },
    floor: { label: '床材種類・主な仕様', placeholder: '例：複合フローリング／12mm／耐水' },
    'wall-ceiling': { label: '内装材種類・主な仕様', placeholder: '例：ビニル壁紙／準不燃' },
    'entrance-door': { label: 'サイズ・開き勝手・防火仕様', placeholder: '例：W900×H2000／右吊元／防火戸' },
    sash: { label: '窓種・サイズ・呼称', placeholder: '例：引違い窓／16520／Low-E複層' },
    'interior-door': { label: '建具種類・主な仕様', placeholder: '例：引戸／木質系／表示錠' },
    lighting: { label: '照明種別・電源', placeholder: '例：ダウンライト／AC100V／電球色' },
    furniture: { label: '寸法・設置方式', placeholder: '例：W1200×D450×H850／壁固定' },
    smartlock: { label: '解錠方式・対応ドア', placeholder: '例：指紋・暗証番号／対応扉厚35〜55mm' },
  };
  return values[categoryCode] ?? { label: 'サイズ・仕様', placeholder: '主なサイズ・仕様を入力' };
}

type ProductRegistrationGuidance = {
  manufacturers: string[];
  sizeCandidates: string[];
  example: string | null;
  fixedInfo: string[];
};

export function productRegistrationGuidance(categoryCode: string): ProductRegistrationGuidance {
  const values: Record<string, ProductRegistrationGuidance> = {
    ub: {
      manufacturers: ['TOTO', 'LIXIL', 'Panasonic', 'タカラスタンダード', 'クリナップ', 'トクラス'],
      sizeCandidates: ['1014', '1116', '1216'],
      example: 'TOTO / サザナ / HTシリーズ / Sタイプ / 1216 / HTV1216USX1',
      fixedInfo: ['浴槽材質', 'ドア種類', '換気設備', '設置方式'],
    },
    toilet: {
      manufacturers: ['TOTO', 'LIXIL', 'Panasonic'],
      sizeCandidates: ['床排水／排水芯120mm', '床排水／排水芯200mm'],
      example: 'LIXIL / プレアス LSタイプ / CL6A / YBC-CL10SU + DT-CL116AU',
      fixedInfo: ['排水方式', '排水芯', '手洗い', '洗浄方式'],
    },
    washbasin: {
      manufacturers: ['TOTO', 'LIXIL', 'Panasonic', 'タカラスタンダード', 'クリナップ', 'KVK', 'SANEI', 'カクダイ'],
      sizeCandidates: ['450mm', '500mm', '600mm', '750mm', '900mm', '1000mm', '1200mm'],
      example: 'LIXIL / 洗面化粧台 / ピアラ / 600mm / 扉タイプ / 代表品番',
      fixedInfo: ['ボウル材質', '水栓タイプ', '間口', 'ミラー構成'],
    },
    kitchen: {
      manufacturers: ['LIXIL', 'Panasonic', 'タカラスタンダード', 'クリナップ', 'トクラス', 'TOTO'],
      sizeCandidates: ['900mm', '1050mm', '1200mm', '1500mm', '1800mm'],
      example: 'LIXIL / ミニキッチン / DMKシリーズ / 1200mm / I型 / 代表品番',
      fixedInfo: ['間口', '天板材質', '水栓タイプ', '加熱機器'],
    },
    boiler: {
      manufacturers: ['リンナイ', 'ノーリツ', 'パロマ'],
      sizeCandidates: ['16号', '20号', '24号'],
      example: 'リンナイ / RUX-Eシリーズ / 16号 / LPガス / 給湯専用 / 屋外壁掛型 / RUX-E1616W',
      fixedInfo: ['号数', 'ガス種', '給湯機能', '設置方式'],
    },
    aircon: {
      manufacturers: ['ダイキン', '三菱電機', 'Panasonic', '日立', 'シャープ', '富士通ゼネラル', '東芝'],
      sizeCandidates: [
        '2.2kW（6畳程度）',
        '2.5kW（8畳程度）',
        '2.8kW（10畳程度）',
        '3.6kW（12畳程度）',
        '4.0kW（14畳程度）',
        '5.6kW（18畳程度）',
        '6.3kW（20畳程度）',
        '7.1kW（23畳程度）',
        '8.0kW（26畳程度）',
        '9.0kW（29畳程度）',
      ],
      example: 'ダイキン / ルームエアコン / Eシリーズ / 2.2kW（6畳程度） / 単相100V / S225ATES-W',
      fixedInfo: ['能力クラス', '電源', '室内機・室外機', '寒冷地対応（必要な場合）'],
    },
    roof: {
      manufacturers: ['ケイミュー', 'アイジー工業', 'セキノ興産', '稲垣商事'],
      sizeCandidates: ['金属屋根', 'ガルバリウム鋼板', '立平葺き', 'スレート系'],
      example: 'アイジー工業 / 屋根材シリーズ / 金属屋根 / ガルバリウム鋼板 / 代表品番',
      fixedInfo: ['材質', '板厚', '葺き方', '表面処理', '防火性能', '寒冷地域対応'],
    },
    'exterior-wall': {
      manufacturers: ['ニチハ', 'ケイミュー', 'アイジー工業', '旭トステム外装'],
      sizeCandidates: ['窯業系サイディング', '金属サイディング', 'ガルバリウム鋼板'],
      example: 'ニチハ / 外壁シリーズ / 窯業系 / 16mm / ヨコ張り / 代表品番',
      fixedInfo: ['材質', '柄分類', '厚み', '張り方', '防火・耐火性能', '寒冷地域対応'],
    },
    floor: {
      manufacturers: ['DAIKEN', '朝日ウッドテック', 'Panasonic', 'LIXIL', 'EIDAI', 'ウッドワン'],
      sizeCandidates: ['複合フローリング', '無垢フローリング', 'クッションフロア', 'フロアタイル', 'シート床材'],
      example: 'DAIKEN / 床材シリーズ / 複合フローリング / 12mm / 代表品番',
      fixedInfo: ['材質', '厚み', '表面仕上げ', '耐水性'],
    },
    'wall-ceiling': {
      manufacturers: ['サンゲツ', 'リリカラ', 'シンコール', 'トキワ', 'ルノン', 'DAIKEN'],
      sizeCandidates: ['ビニル壁紙', '織物壁紙', 'パネル', '化粧板'],
      example: 'サンゲツ / 壁紙シリーズ / ビニル壁紙 / 準不燃 / 代表品番',
      fixedInfo: ['材質', '厚み', '防火性能', '表面仕上げ'],
    },
    'entrance-door': {
      manufacturers: ['LIXIL', 'YKK AP', '三協アルミ'],
      sizeCandidates: ['片開き', '親子ドア', '引戸', 'ガラス框ドア'],
      example: 'LIXIL / 玄関ドアシリーズ / 片開き / W900×H2000 / 防火戸 / 代表品番',
      fixedInfo: ['本体寸法', '開き勝手', '防火性能', '断熱性能', 'ハンドル・錠'],
    },
    sash: {
      manufacturers: ['LIXIL', 'YKK AP', '三協アルミ'],
      sizeCandidates: ['引違い窓', 'FIX窓', '縦すべり出し窓', '横すべり出し窓', '上げ下げ窓'],
      example: 'YKK AP / サッシシリーズ / 引違い窓 / Low-E複層ガラス / 代表品番',
      fixedInfo: ['窓種', 'ガラス仕様', '枠材質', '断熱性能', '呼称・サイズ'],
    },
    'interior-door': {
      manufacturers: ['LIXIL', 'Panasonic', 'DAIKEN', 'EIDAI', 'ウッドワン'],
      sizeCandidates: ['開き戸', '引戸', '折戸'],
      example: 'Panasonic / 室内建具シリーズ / 引戸 / 木質系 / 代表品番',
      fixedInfo: ['建具種類', '材質', '表面仕上げ', '錠', '開き勝手'],
    },
    lighting: {
      manufacturers: ['Panasonic', 'オーデリック', 'コイズミ照明', '大光電機', '東芝ライテック'],
      sizeCandidates: ['ダウンライト', 'シーリングライト', 'ブラケット', 'ポーチライト', '外灯'],
      example: 'Panasonic / LED玄関外灯 / AC100V / 電球色・人感センサー / 代表品番',
      fixedInfo: ['取付場所', '電源', '消費電力', '光色', '防水性能', 'センサー'],
    },
    furniture: {
      manufacturers: ['Panasonic', 'DAIKEN', 'LIXIL', 'EIDAI', 'ウッドワン', '南海プライウッド'],
      sizeCandidates: ['幅600mm', '幅750mm', '幅900mm', '幅1200mm'],
      example: 'Panasonic / シューズボックス / 幅900mm / 壁固定 / 代表品番',
      fixedInfo: ['本体寸法', '材質', '耐荷重', '設置方式', '扉・収納仕様'],
    },
    smartlock: {
      manufacturers: ['LIXIL', 'YKK AP', '美和ロック', 'GOAL', 'SwitchBot'],
      sizeCandidates: ['対応扉厚30〜45mm', '対応扉厚35〜55mm', '対応扉厚40〜60mm'],
      example: 'メーカー / スマートロック / 指紋・暗証番号・ICカード / 対応扉厚35〜55mm / 代表品番',
      fixedInfo: ['解錠方式', '対応扉厚', '電源', '通信方式', '取付方式'],
    },
  };
  return values[categoryCode] ?? { manufacturers: [], sizeCandidates: [], example: null, fixedInfo: [] };
}

export function categoryRegistrationHint(categoryCode: string): string | null {
  const values: Record<string, string> = {
    ub: '浴室サイズなど固定情報はここで入力し、壁色・浴槽色などお客様が選ぶ内容は下の「お客様選択」で登録します。',
    toilet: '排水方式・排水芯など商品固有の固定情報を入力し、お客様が選べる色や機能だけを下の「お客様選択」で登録します。',
    washbasin: '間口など固定情報はここで入力し、扉色・水栓など選択できる内容は下の「お客様選択」で登録します。',
    kitchen: '間口など固定情報はここで入力し、扉色・ワークトップなど選択できる内容は下の「お客様選択」で登録します。',
    boiler: '号数・ガス種・給湯機能・設置方式を確認し、この欄には商品を判別できる主要仕様をまとめて入力します。',
    aircon: '能力クラスと電源を確認します。お客様が比較するときに必要な仕様を優先して入力します。',
    roof: '屋根材は外壁と分けて登録します。材質・板厚・葺き方など固定情報を入力し、色などを選べる場合だけ下の「お客様選択」で登録します。',
    'exterior-wall': '材質・厚み・張り方など施工判断に必要な固定情報を入力し、色・柄はお客様が選べる場合だけ下の「お客様選択」で登録します。',
    floor: '床材種類・厚みなど固定情報を入力し、色・柄など選択できる内容は下の「お客様選択」で登録します。',
    'wall-ceiling': '材質・防火性能など固定情報を入力し、色・柄など選択できる内容は下の「お客様選択」で登録します。',
    'entrance-door': '玄関ドアはサッシ・室内建具と分けて登録します。色・ハンドルなどを選べる場合は下の「お客様選択」で登録し、スマートキーは別オプションとして扱います。',
    sash: '窓種・呼称・ガラス仕様など固定情報を入力します。現在のサッシカテゴリーはお客様画面非表示のため、台帳・見積用の情報を優先します。',
    'interior-door': '建具種類・材質・錠など固定情報を入力し、建具カラーやハンドルを選べる場合だけ下の「お客様選択」で登録します。',
    lighting: '照明種別・電源・取付場所を確認します。屋外照明は防水性能やセンサー有無も確認します。',
    furniture: '寸法・設置方式・耐荷重など、設置可否に関わる固定情報を優先して入力します。',
    smartlock: '対応扉厚・取付方式・電源・通信方式を確認し、解錠方法の選択肢がある場合は下の「お客様選択」で登録します。',
  };
  return values[categoryCode] ?? null;
}


export function ProductCategoryGuidance({ categoryCode, readOnlyChoices = false }: { categoryCode: string; readOnlyChoices?: boolean }) {
  const registrationHint = categoryRegistrationHint(categoryCode);
  const guidance = productRegistrationGuidance(categoryCode);
  return (
    <>
      {readOnlyChoices && <p className="text-xs text-muted">カテゴリー別の入力目安です。お客様選択の追加・編集はこの画面ではできません。</p>}
              {(registrationHint || guidance.example || guidance.fixedInfo.length > 0) && (
                <div className="rounded-xl border border-line bg-ivory/45 px-4 py-3 text-xs leading-5 text-ink-soft" data-testid="category-registration-guidance">
                  {registrationHint && (
                    <p><span className="font-semibold">このカテゴリーの入力目安：</span>{registrationHint}</p>
                  )}
                  {guidance.example && (
                    <p className={registrationHint ? 'mt-1' : undefined}>
                      <span className="font-semibold">入力例：</span>{guidance.example}
                    </p>
                  )}
                  {guidance.fixedInfo.length > 0 && (
                    <p className="mt-1">
                      <span className="font-semibold">確認ポイント：</span>{guidance.fixedInfo.join('・')}
                    </p>
                  )}
                </div>
              )}
    </>
  );
}
