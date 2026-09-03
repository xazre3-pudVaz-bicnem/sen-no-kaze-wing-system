/**
 * トップページ（LP）の掲載内容。
 * 先方の STUDIO 版サイト（千の風プロジェクト）の情報・構成に合わせている。
 * 文章はすべて先方サイトの記載を正とし、プレースホルダー（XXXXXXXXX 等）だけ実内容に置き換えた。
 */

export interface NavItem {
  href: string;
  label: string;
}

/** ヘッダー／フッター共通のナビゲーション（2026-09-01 トップ修正案の構成） */
export const LP_NAV: NavItem[] = [
  { href: '/#features', label: '商品のメリット' },
  { href: '/#genten', label: '開発の原点' },
  { href: '/#lineup', label: '商品ラインナップ' },
  { href: '/#plans', label: '組合せプラン' },
  { href: '/#dealer', label: '代理店募集' },
  { href: '/#faq', label: 'よくある質問' },
  { href: '/news', label: 'お知らせ' },
];

/* ---------------- Hero ---------------- */

export const hero = {
  title: '世界初⁉不陸調整、木造コンテナ',
  patent: '（特許出願中）',
  /** 3 商品への導線（トップ内の各商品セクションへ） */
  products: [
    { label: 'Wing', href: '#wing' },
    { label: 'BOX', href: '#box' },
    { label: 'Flat', href: '#flat' },
  ],
  cta: '商品のメリット',
  ctaDealer: '代理店募集',
  /**
   * 3枚をクロスフェードで入れ替える（2026-09-02 先方モックに貼られていた3点）。1枚目が下地。
   * ①昼の湖畔 ②内装4点の組写真（TVの部屋・海の寝室・庭の寝室・洗面） ③夕暮れの黒コンテナ（キービジュアル右側の切出し）
   */
  slides: [
    { src: '/images/cases/box-lakeside-family.jpg', alt: '湖畔のデッキで家族が過ごす木造コンテナ' },
    { src: '/images/hero/interior-collage.jpg', alt: 'テレビのある部屋・海を望む寝室・庭を望む寝室・丸鏡の洗面を並べた Wing の内装' },
    { src: '/images/hero/sunset-dark-wing.jpg', alt: '夕暮れの海を望む丘に建つ黒い外壁の連棟コンテナ' },
  ],
};

/* ---------------- Concept ---------------- */

export const concept = {
  labelEn: 'CONCEPT MOVIE',
  title: 'コンセプト動画',
  badge: '特許出願中！',
  copy: 'コンパクト設計だから狭小地、傾斜地にも対応し、運搬も容易な木造コンテナの決定版',
};

/* ---------------- 商品のメリット（特徴） ---------------- */

export const features = {
  labelEn: 'FEATURES',
  title: '不陸調整折畳み式木造コンテナの特徴',
  lead: '確認申請、住宅ローン対応コンテナ',
  items: [
    '設置場所、最小限の造成（傾斜地に対応）',
    'トラック荷台の約2倍の広さを実現',
    '木造だから軽量で運送が容易',
    '設置後に給排水・給湯、電気、基礎工事の施工が可能で施工性が格段に向上',
    '将来、不要になった時、撤去・移動が容易だから売却に有利',
  ],
};

/* ---------------- 開発の原点 ---------------- */

export const genten = {
  labelEn: 'OUR ORIGIN',
  title: 'Wing 開発の原点',
  story1: {
    title: '災害の経験から生まれた、\n新しい建築のかたち',
    body: '東日本大震災により、私の故郷は大きな被害を受けました。\n多くの人が住まいを失い、親族もまた、仮設住宅が完成するまで、長い時間慣れない場所で過ごさなくてはいけませんでした。\n「落ち着ける場所を早く作ってあげたい。」即断即決で自社工場でBOXを造り、被災地に届けました。\nその時、仮設住宅建築費約500万、解体費約200万でしたが、解体する費用が無駄だと強く感じ、持ち運び出来て、地域の工務店でもできる木造コンテナの技術研究開発を開始しました。',
    /** 先方提供の被災地写真（「wing開発の原点」資料）を指定どおり白黒加工で使用（2026-09-03） */
    image: '/images/cases/quake-damage-bw.jpg',
    alt: '地震で倒壊した家屋が並ぶ被災地の街並み（白黒写真）',
  },
  story2: {
    title: '経験から生まれた\n不陸調整方式採用 折畳み木造コンテナ',
    badge: '特許出願中',
    lead: 'もっと合理的に、もっと将来の不安を無くすために',
    whys: [
      {
        q: '何故・・・不陸調整が必要なのか？',
        a: '建物を建築するためには土地の整備が必要だが、災害時にはコスト削減とスピードが求められる。そこで造成工事を最小限に最速で設置できるという技術を開発しました。',
      },
      {
        q: '何故・・・折畳みなのか？',
        a: '災害時にトレーラーや大型トラックで運ぶのは、数量に制限があり、より多くの仮設住宅を被災地に届けるため、狭い道路にも適応できて、スピーディーに設置できるものとしました。',
      },
      {
        q: '何故・・・木造なのか？',
        a: '普段住んでいる住まいの感覚を大事にしたい。被災者に落ち着ける空間を提供するため、木造に拘りました。',
      },
    ],
  },
  needs: {
    title: '社会のニーズに応える新しい選択肢',
    items: [
      {
        title: '子供や孫の負担を軽減する。',
        body: '将来、相続する子供や孫に有効な資産を残す事が求められています。多機能性と撤去移動が容易だから相続を受けた子供や孫は貸家APは勿論、ホテルや貸事務所など収益性のあるものに、又は故郷に別荘を持つなど・・・それでも負担と感じるなら売却する。色々な選択肢があるから負担にならない。',
      },
      {
        title: '日本社会は観光立国を目指す。',
        body: '観光庁の観光立国推進基本計画では、2030年に訪日外国人旅行者数6000万人、訪日外国人旅行消費額15兆円という目標が掲げられ、地方誘客の促進も重要な方針とされています。近年、訪日外国人観光客数は、回復・増加傾向にあり、地方における宿泊・滞在の受け皿づくりは、今後ますます重要になると考えています。Wing・BOX・Flatがその選択肢の一つとして、地域の新たな滞在拠点となり、地域の活性化に貢献できれば幸いです。',
      },
      {
        title: '度重なる災害対応はスピーディーにコスト削減',
        body: '災害時の土地の確保や造成に迅速に低価格で提供できて、仮設住宅、店舗に対応し、更には仮設から本設のために確認申請取得、住宅ローンの借り入れも可能だから安心して設置できる理想のコンテナの決定版！',
      },
    ],
  },
};

/* ---------------- 品質（Wing・BOX・Flat共通） ---------------- */

export const quality = {
  labelEn: 'PRODUCTS',
  title: '不陸調整折畳み式木造コンテナの商品説明',
  lead: '株式会社技術の杜が提供するWing・BOX・Flat共通の特長',
  items: [
    '全ての商品が不陸調整可能',
    '確認申請取得可能（30年住宅ローン対応）',
    '構造や断熱、耐用年数は木造住宅の品質をそのままに',
    '内外装の自由度も他のコンテナやトレーラーハウスと比較しても高い',
    '多機能、多様性に対応',
  ],
};

/* ---------------- 商品ラインナップ（Wing / BOX / Flat） ---------------- */

export interface ShowcaseTopic {
  tag?: string;
  title: string;
  body: string;
  image: string;
  alt: string;
  caption?: string;
}

export interface ShowcaseProduct {
  /** セクションアンカー（#wing など）と見積導線のモデル slug */
  id: string;
  slug: string;
  catch: string;
  name: string;
  size: string;
  body: string;
  highlight?: string;
  /** 右側のコラージュ（Word のレイアウト準拠。先頭3枚＝上段の小さな外観、4枚目＝大きめの図、以降＝小さめ） */
  images: { src: string; alt: string }[];
  /** テキスト付きの活用トピック（BOX用） */
  topics: ShowcaseTopic[];
  /** 見積ボタンの上に置く基本平面図（Flat用・Word 準拠） */
  basicPlan?: { image: string; alt: string };
  /** 物置Plus の設置例写真（Flat用） */
  storagePhoto?: { image: string; alt: string; caption: string };
  /** ラベル付き組合せ平面図の列（Flat用）。tag/lead はまとめの見出しと本文 */
  plansTag?: string;
  plansLead?: string;
  plans?: { label: string; images: { image: string; alt: string }[] }[];
}

export const showcase = {
  labelEn: 'LINE UP',
  title: '商品ラインナップ',
  cta: 'この商品で見積する',
  /** Wing ブロック下の設置の流れ（Word の写真列に忠実：クレーン写真＋彩色立面図＋平面図の4点。立面図・平面図は透過版） */
  steps: [
    { label: '現地で下ろし → 広げ設置後 → 基礎工事', image: '/images/transport/unic-seaside.jpg', alt: '海辺の設置場所で設置足の上に置かれた折り畳み状態のコンテナ' },
    { label: '折畳み屋根面', image: '/images/elevation/wing-roof-face.png', alt: '折り畳み時に屋根面になる木板張りの立面図' },
    { label: '', image: '/images/elevation/wing-entrance-color.png', alt: '木製玄関ドアのある白い外壁の立面図' },
    { label: 'UB・エアコン・ウォッシュレット・洗面／エアコン付き', image: '/images/elevation/wing-equipment-side.png', alt: '給湯器とエアコン室外機、ユニットバスの窓が並ぶ設備側の立面図' },
    { label: '広さ約2倍', image: '/images/plan/wing-hotel-guest.png', alt: '広げるとコンテナ約2倍の広さになる平面図' },
  ],
  products: [
    {
      id: 'wing',
      slug: 'wing-01',
      catch: '高級ホテルのイメージを・・・',
      name: '小さな宝箱 Wing',
      size: '基本 3,900×4,800',
      body: 'トラック一台分でコンテナ2個分の広さを実現しました。\n運送費を削減でき、高級感溢れる内装と、使い勝手の良い間取りだから、お一人様の住宅にも最適で、水回りが無ければ事務所、店舗にも活用出来る丁度いい広さです。',
      highlight: '住居として使って将来はホテルで運用・・・\n高利回りを実現可能',
      images: [
        { src: '/images/plan/wing-isometric.png', alt: 'ベッド・ダイニング・水回り・デッキを収めた Wing のアイソメ図' },
        { src: '/images/cases/box-forest-terrace.jpg', alt: '木立の中にデッキ付きで設置された木造コンテナ' },
        { src: '/images/interior/bedroom-seaview.webp', alt: '海を望む大きな窓とベッドを備えた Wing の室内' },
        { src: '/images/interior/bedroom-garden.jpg', alt: '低窓から緑を望むベッドと小上がりを備えた Wing の室内' },
        { src: '/images/interior/washroom-seaview.jpg', alt: '海を望む洗面と水回りを備えた Wing の室内' },
      ],
      topics: [],
    },
    {
      id: 'box',
      slug: 'box',
      catch: 'よりコンパクトに合理的に・・・',
      name: 'BOX',
      size: '基本 2,100×4,800',
      body: 'コンパクトに纏めたホテル、ワンルーム仕様最小サイズ、重ねが容易で2階建て以上も可能に・・・（各種法律に基づきますので詳しくは代理店に問合せて下さい。）\n水回りキットとWingの組合せで仮設住宅の2LDKに。',
      images: [
        { src: '/images/products/box-white.png', alt: '伸縮可能な設置足の上に建つ白い外壁の BOX' },
        { src: '/images/plan/box-hotel-double.jpg', alt: '玄関・ユニットバス・キッチン・ベッド2台を収めた BOX の内装レイアウト' },
      ],
      topics: [
        {
          tag: '土地活用例',
          title: '駐車場の上にBOX又はFlat',
          body: '土地の有効活用を目的とした活用方法です。コンビニや、都心の駐車場の上にホテルやレンタル事務所を設置できるので、高収入高収益が期待できます。',
          image: '/images/cases/box-garage-top.jpg',
          alt: '住宅の駐車場の上に設置された BOX',
          caption: '駐車場の上に',
        },
        {
          tag: '事務所やワンルーム',
          title: '現場の仮設事務所やワンルームマンションにも活用可能',
          body: 'あなたの遊休地や狭小地にも最適解を提供します。\n※重ねる場合、必ず確認申請が必要になります。ご注意下さい。',
          image: '/images/cases/box-stacked.png',
          alt: '2 階建てに重ねて設置された BOX',
          caption: '重ねて',
        },
      ],
    },
    {
      id: 'flat',
      slug: 'flat',
      catch: 'よりコンパクトに合理的に・・・',
      name: 'Flat',
      size: '基本 2,100×1,800〜4,800',
      body: '平らに折り畳んで、何部屋も平積みで配送、運送費を大幅削減！Wing＋Flatで2LDKも実現、BOX＋Flatの組合せなどプラスαの商品。\nホームセンター等の物置販売にはスペースを取らない平積みとして在庫管理も容易な格安商品の決定版！',
      images: [{ src: '/images/products/flat-gray.png', alt: '片流れ屋根と設置足を備えた Flat の外観' }],
      topics: [],
      /** 左列・見積ボタンの上に置く基本平面図（Word 準拠） */
      basicPlan: { image: '/images/plan/flat-basic.jpg', alt: '物置・居室タイプ フラット 6.8 帖の平面図' },
      plansTag: '物置にもう一部屋Plus',
      plansLead: '物置に、もう一部屋子供部屋に、置くだけで完成（風対策は別途）。Wing又はBOXにもう一部屋欲しいとき。',
      /** 物置Plus の右列：設置例写真＋組合せ平面図（BOX＋Flat は Word と同じく水回りキット＋居室の2枚重ね） */
      /** 右側（住宅玄関部分）はトリミング済み（2026-09-03 赤入れ） */
      storagePhoto: { image: '/images/cases/flat-entrance-trim.jpg', alt: '住宅の玄関先に設置された黒い外壁の Flat', caption: '物置' },
      plans: [
        { label: 'Flat＋Wing', images: [{ image: '/images/plan/flat-wing-2ldk.jpg', alt: 'フラットの食堂・洋室と Wing の LD を組み合わせた 2LDK の平面図' }] },
        {
          label: 'BOX＋Flat',
          /** 水回りキットの下に、先方提供の「正しい向き」の居室図を隙間なく連結（2026-09-03） */
          images: [
            { image: '/images/plan/box-water-kit.jpg', alt: 'キッチン・トイレ・ユニットバスを収めた BOX 水回りキットの平面図' },
            { image: '/images/plan/flat-rooms-under.jpg', alt: 'フラットの食堂 3 帖と洋室 3 帖の平面図（出入口が下側）' },
          ],
        },
      ],
    },
  ] as ShowcaseProduct[],
};

/* ---------------- 組合せプラン ---------------- */

export const combos = {
  labelEn: 'COMBINATION PLANS',
  title: '不陸調整折畳み式木造コンテナの組合せプラン',
  note: 'Wing、BOX、Flatともに、本体とは、折畳み式で水回りや内外装の仕上げの無い状態を言います。お客様ご自身で、現場配送後に内外装工事をDIYできるので、ご自身の使い道、好みにあわせて、使用してください。但し保証や各種関係法令に適合しているかについては責任の範囲外となります。',
  caution: '※全ての画像はイメージで実際の商品と異なる場合があります。',
  legal: '※BOX及びFlatは、単体で10㎡以内となる商品は確認申請が不要となります。',
  /** グループ構成（2026-09-02 赤入れ：基本本体を先頭に、給湯器付き水回り図は BOX 水回りキット例へ） */
  groups: [
    {
      label: '各コンテナの基本本体',
      items: [
        { image: '/images/plan/wing-office.jpg', alt: 'Wing 事務所（物置）11.3 帖の平面図' },
        { image: '/images/plan/flat-basic.jpg', alt: 'フラット 6.8 帖の平面図' },
      ],
    },
    {
      label: 'Wingホテル用',
      items: [
        { image: '/images/plan/wing-hotel-ld.jpg', alt: 'シャワー・トイレと LD7 帖を収めた Wing ホテル用の平面図' },
        { image: '/images/plan/wing-hotel-guest.jpg', alt: '客室（居室）7.4 帖とユニットバスを収めた Wing ホテル用の平面図' },
      ],
    },
    {
      label: 'Wing居住用',
      items: [{ image: '/images/plan/wing-two-rooms.jpg', alt: '洋室 4.9 帖×2 とウォークインクローゼットを収めた Wing 居住用の平面図' }],
    },
    {
      label: 'BOX水回りキット例',
      items: [
        { image: '/images/plan/box-water-kit-basic.jpg', alt: 'ガス給湯器・エアコン室外機付き BOX 水回りキットの平面図' },
        { image: '/images/plan/box-water-kit.jpg', alt: 'キッチン 3.9 帖・トイレ・ユニットバスを収めた BOX 水回りキットの平面図' },
      ],
    },
    {
      label: 'Flatプラス居室例',
      items: [{ image: '/images/plan/flat-two-rooms.jpg', alt: 'フラットの食堂 3 帖と洋室 3 帖の平面図' }],
    },
    {
      /** 2026-09-03 赤入れ：Wing居室プラン例の図はこのグループへ移動 */
      label: 'Wing＋BOXまたはFlatの組合せ例',
      items: [
        { image: '/images/plan/wing-box-combo.jpg', alt: 'BOX 水回りキットと Wing 8.7 帖を組み合わせた平面図' },
        { image: '/images/plan/flat-wing-2ldk.jpg', alt: 'フラットと Wing を組み合わせた 2LDK の平面図' },
        { image: '/images/plan/wing-living.jpg', alt: 'リビング 5.7 帖と洋室 4.9 帖を収めた Wing 居室プランの平面図' },
      ],
    },
  ],
};

/* ---------------- 見積シミュレーション導線 ---------------- */

export const estimate = {
  labelEn: 'SIMULATOR',
  title: '見積シミュレーション',
  lead: 'あなたは、どんな事業やお住まいに、どの商品を活用しますか？\n見積シミュレーションで概算を確認し、あなたの希望にあった商品を見つけましょう。',
  buttons: [
    { label: 'Wingで見積', slug: 'wing-01', image: '/images/exterior/wing-night-fireworks.jpg', alt: '花火の上がる湖畔に建つ夜の Wing', contain: false },
    { label: 'BOXで見積', slug: 'box', image: '/images/products/box-white.png', alt: '白い外壁の BOX', contain: true },
    { label: 'Flatで見積', slug: 'flat', image: '/images/products/flat-navy.png', alt: '紺色の外壁の Flat', contain: true },
  ],
};

/* ---------------- 代理店募集 ---------------- */

export const dealerRecruit = {
  labelEn: 'PARTNERS',
  title: '代理店募集',
  body: 'この木造コンテナは新しい選択肢を提供し、災害時にも迅速に行動できるように、地域の代理店を募集しています。',
  image: '/images/cases/box-lakeside-family.jpg',
  alt: '湖畔のデッキで家族が過ごす木造コンテナ BOX',
  cta: '加盟について問い合わせる',
};

/* ---------------- 木造コンテナについて ---------------- */

export interface ContainerBlock {
  no: string;
  labelEn: string;
  title: string;
  body: string;
  note?: string;
  image: string;
  alt: string;
  caption?: string;
}

export const wooden = {
  labelEn: 'WOODEN CONTAINER',
  title: '木造コンテナについて',
  lead: '株式会社技術の杜では、自社独自の折り畳み式木造コンテナを製造・販売しています。遊休地での宿泊事業、既存施設への増設、事務所・店舗・地域拠点としての活用など、土地や事業の目的に合わせた使い方をご提案します。',
  blocks: [
    {
      no: '01',
      labelEn: 'NOTO MODEL',
      title: '能登仕様モデル\n「能登の夢」',
      body: '能登の夢は、折り畳み式木造コンテナ・Wingをベースに、能登ヒバや輪島塗を取り入れた、特別仕様モデルです。',
      note: '能登の夢は、立地や用途に合わせた特別仕様としての対応となります。仕様・価格は個別にご相談ください。',
      image: '/images/interior/wing-room-aircon.jpg',
      alt: '能登ヒバの木目を活かした Wing の室内',
    },
    {
      no: '02',
      labelEn: 'STAY IMAGE',
      title: '宿泊利用を想定した\n空間イメージ',
      body: 'ベッド、デスク、洗面、シャワー、トイレなどをコンパクトに収め、短期滞在に必要な設備を備えた宿泊空間を想定しています。土地の眺望や周辺環境を活かしながら、設置場所や用途に合わせた仕様調整を行います。',
      image: '/images/products/wing-lakeside-deck.jpg',
      alt: '湖を望む高台に建つウッドデッキ付きの Wing',
      caption: 'デッキ付き外観イメージ',
    },
    {
      no: '03',
      labelEn: 'LAYOUT PLAN',
      title: '宿泊仕様のレイアウト例',
      body: '宿泊利用を想定したレイアウト例です。実際の間取り・設備配置は、設置場所、用途、法令確認、オーナー様のご要望に応じて調整します。',
      image: '/images/floorplan/wing01-plan-full.jpg',
      alt: 'ベッド、リビング・ダイニング、水回り、収納を収めた宿泊仕様の平面図',
      caption: '＜ 宿泊仕様レイアウト例 ＞ ベッド、リビング・ダイニング、水回り、収納などを収めた平面図の一例です。',
    },
    {
      no: '04',
      labelEn: 'MAIN MODEL',
      title: '折り畳み式木造\nコンテナ・ウィング',
      body: '折り畳み式の構造により、運送しやすさと室内の広さを両立した主力モデルです。主にホテル仕様での活用を想定しています。',
      image: '/images/products/wing-lakeside.jpg',
      alt: '湖を望む高台に建つ折り畳み式木造コンテナ Wing',
    },
  ] as ContainerBlock[],
};

/* ---------------- 活用アイディア ---------------- */

export interface UseCase {
  no: number;
  category: string;
  title: string;
  body: string;
  image: string;
  alt: string;
}

export const idea = {
  labelEn: 'USE CASES',
  title: '活用アイディア',
  lead: 'Wingは、外装も内装も自由自在。\n無限の可能性を秘めた「空間」として、お客様の用途、ビジネスや事業にフィットします。',
  cases: [
    { no: 1, category: 'ホテル', title: '一棟貸しの宿', body: '眺望のよい土地に1棟から。客室・水回り・空調を備え、小さく始められる宿泊事業に。', image: '/images/brands/kirameki.jpg', alt: '海を望む高台に建つ宿泊利用の Wing' },
    { no: 2, category: 'ホテル', title: '既存施設の客室増設', body: '旅館・キャンプ場・ゴルフ場などの敷地に増設。造成を抑えて客室数を増やせます。', image: '/images/interior/wing-room-aircon.jpg', alt: 'ベッドとデスクを備えた客室仕様の室内' },
    { no: 3, category: '住宅', title: '離れ・セカンドハウス', body: '母屋の隣に離れとして。将来は別の土地へ移設して使い続けられます。', image: '/images/interior/unit-bath-3point.jpg', alt: '3点ユニットバスを備えた住宅仕様の水回り' },
    { no: 4, category: '事務所', title: '現場事務所・サテライト', body: '4t車で運び、必要な期間だけ設置。撤収後は別の現場で再利用できます。', image: '/images/products/flat-office-lake.jpg', alt: '湖畔に設置された事務所仕様のフラットタイプ' },
    { no: 5, category: '店舗', title: '店舗・地域拠点', body: 'カフェ、ショップ、地域の交流拠点に。外装・内装は用途に合わせて設計します。', image: '/images/products/box-forest-lake.jpg', alt: '木立の中に設置された店舗利用を想定した BOX' },
  ] as UseCase[],
};

/* ---------------- 費用・比較 ---------------- */

export const price = {
  labelEn: 'COST',
  title: '費用・比較',
  headline: '低コストで導入が可能',
  lead: '工場で内外装まで仕上げてから運ぶため、現場工期を大きく短縮できます。造成を最小限に抑えられることも、総額を抑えられる理由です。',
  compare: [
    { label: '在来工法の小規模宿泊施設', cost: '目安 1,200万円〜', period: '設計〜引渡し 8〜12ヶ月', note: '基礎・造成・現場施工が中心' },
    { label: 'Wing（折り畳み式木造コンテナ）', cost: '本体 247万円〜（税別）', period: '設置は現地で約30分', note: '工場生産＋別途工事（運送・基礎・設備）', highlight: true },
  ],
  notes: [
    '金額は本体価格計（本体一式＋諸費用・税別）です。オプション・別途工事（運送費・基礎工事・電気・給排水など）は含みません。',
    '在来工法の目安は一般的な小規模宿泊施設の参考値で、条件により大きく変動します。',
  ],
};

/* ---------------- 導入のご相談 ---------------- */

export const consultation = {
  labelEn: 'CONSULTATION',
  title: '導入のご相談',
  lead: 'Wingは、外装も内装も自由自在。\n無限の可能性を秘めた「空間」として、お客様の用途、ビジネスや事業にフィットします。',
  landTitle: 'こんな土地、お持ちではありませんか？',
  landBody: '造成費用をかけずに、様々な土地に対応して設置、宿泊事業を展開できます。',
  landTypes: ['傾斜地', '山間部', '海沿い', 'リゾート地', '遊休地', '空き地'],
  wishTitle: '変化する時代に応える、はじめやすいホテル',
  wishLead: 'こんな想いにお応えできます。',
  wishes: ['土地を価値ある資産として有効活用したい', '地域の景観や資源を活かしたい', '宿泊事業を始めたいがリスクは抑えたい', '客層を増やし収益機会を広げたい', '店舗や事務所の再整備を進めたい'],
  merits: [
    { title: '遊休地を収益化', body: '使われていない土地に1棟から設置し、宿泊事業として活用できます。造成を最小限に抑えられるため、初期投資を抑えたスタートが可能です。' },
    { title: '宿泊事業に新規参入', body: '設備を内蔵した1室完結型のため、大規模な施設を建てずに宿泊事業を始められます。運営のご相談にも対応します。' },
    { title: '別の土地へ移設可能', body: '折り畳んで4t車で運べる構造のため、事業計画の変更や土地の返還時にも、別の場所へ移して使い続けられます。' },
    { title: '将来の下取りにも対応', body: '不要になった場合の下取りについてもご相談いただけます。使い終えた後の選択肢があることも、Wing の特長です。' },
  ],
};

/* ---------------- プロジェクト参加 ---------------- */

export const owners = {
  labelEn: 'OWNERS・PARTNERS',
  title: 'プロジェクトの参加',
  blocks: [
    {
      title: 'ホテルオーナー様募集は現在準備中です。',
      body: '現在、穴水町で1棟目のホテル開業に向けた準備を進めています。',
      image: '/images/interior/room-white-aircon.jpg',
      alt: '海を望む窓辺にベッドとデスクを配した客室',
    },
    {
      title: 'パートナー募集について',
      body: '製作・施工パートナーおよび販売パートナーの募集に向けて、現在制度や募集条件の準備を進めています。',
      image: '/images/products/box-forest-lake.jpg',
      alt: '草地に建つ木造コンテナ BOX',
    },
  ],
};

/* ---------------- お知らせ ---------------- */

export interface NewsItem {
  slug: string;
  date: string;
  category: 'NEWS' | 'COLUMN' | 'CAMPAIGN';
  title: string;
  lead: string;
  body: string[];
  image?: string;
}

export const news: NewsItem[] = [
  {
    slug: 'noto-model-house',
    date: '2026-06-06',
    category: 'NEWS',
    title: '石川県穴水駅にモデルハウスを開設予定です',
    lead: '能登の拠点として、穴水駅前にモデルハウスを開設する準備を進めています。',
    body: [
      '石川県穴水駅に、折り畳み式木造コンテナ Wing のモデルハウスを開設する準備を進めています。実際の広さ、天井の高さ、木の質感、水回りの使い勝手を体感いただける場所になります。',
      '開設予定日は7月15日です。ご来場の方にはもれなく粗品を贈呈いたします。日程が確定しましたら、改めてお知らせいたします。',
    ],
    image: '/images/products/wing-lakeside-deck.jpg',
  },
  {
    slug: 'noto-no-yume',
    date: '2026-06-03',
    category: 'CAMPAIGN',
    title: '成約者様に能登仕様モデル「能登の夢」をご用意します',
    lead: '能登ヒバや輪島塗を取り入れた特別仕様モデルのご案内です。',
    body: [
      '能登の夢は、折り畳み式木造コンテナ Wing をベースに、能登ヒバや輪島塗を取り入れた特別仕様モデルです。',
      '立地や用途に合わせた特別仕様としての対応となります。仕様・価格は個別にご相談ください。',
    ],
    image: '/images/interior/wing-room-aircon.jpg',
  },
  {
    slug: 'estimate-simulator',
    date: '2026-06-03',
    category: 'COLUMN',
    title: '見積シミュレーターを公開しました',
    lead: '設備を選ぶと完成イメージと概算金額がその場で確認できます。',
    body: [
      'ベースモデルを選び、ユニットバス・トイレ・キッチン・エアコン・デッキなどの設備を選ぶだけで、完成イメージと概算金額がその場で確認できる見積シミュレーターを公開しました。',
      '作成した仕様はマイページに保存でき、後から編集・複製できます。そのまま見積依頼を送ると、見積番号付きの概算見積書（PDF）が発行されます。',
    ],
    image: '/images/products/wing-lakeside.jpg',
  },
  {
    slug: 'patent-pending',
    date: '2026-06-02',
    category: 'NEWS',
    title: '折り畳み機構について特許を出願しました',
    lead: 'コンパクトに運び、現地で広げる独自構造です。',
    body: [
      '屋根を上げ、両脇の壁を広げ、床を下ろして正面の壁を建てる Wing の折り畳み機構について、特許を出願しました。',
      '狭小地・傾斜地にも対応し、運搬も容易な木造コンテナとして、引き続き改良を進めてまいります。',
    ],
    image: '/images/transport/unic-crane-lift.jpg',
  },
];

/* ---------------- FAQ ---------------- */

export const faqItems = [
  {
    q: '相談や見積もりは無料ですか？',
    a: 'はい、ご相談や初回のお見積もりは無料で承っております。土地やご要望の内容が固まっていなくても大丈夫ですので、お気軽にお問い合わせください。お話を伺いながら、どのような形で進めるのが最適かをご提案いたします。',
  },
  {
    q: '住宅以外の用途でも依頼できますか？',
    a: 'もちろん可能です。宿泊施設のほか、小規模店舗、事務所、離れ客室、既存施設の増設など、さまざまな用途に対応しています。用途や規模にかかわらず、お客様の目的や世界観に合わせた空間をご提案します。',
  },
  {
    q: '遠方からの依頼やオンラインでの打ち合わせは可能ですか？',
    a: 'はい、可能です。遠方にお住まいの方やスケジュールの都合がつきにくい方にも対応できるよう、Zoomなどを用いたオンラインでの打ち合わせも行っております。必要に応じて現地調査や対面でのご訪問も調整いたします。',
  },
  {
    q: '設計から設置完了までどのくらいの期間がかかりますか？',
    a: '規模や内容にもよりますが、ご相談から仕様の確定までに約1〜2ヶ月、製作に約2〜3ヶ月を想定しています。現地での設置・展開は約30分、その後に基礎工事を行います。建築確認申請が必要な場合は別途期間を要しますので、個別にご説明いたします。',
  },
  {
    q: '傾斜地や高低差のある土地にも設置できますか？',
    a: '独自開発の伸縮可能な設置足により、高低差のある土地にも造成なしで設置が可能です。搬入路や地盤の状況は、現地確認のうえでご案内します。',
  },
  {
    q: '建築確認申請は取得できますか？',
    a: 'Wing は建築確認申請の取得に対応した木造建築です。申請の要否や条件は設置場所の用途地域等により異なりますので、お見積り時にご相談ください。',
  },
];

/* ---------------- お問い合わせ ---------------- */

export const contactTopics = ['折り畳み式木造コンテナについて', '加盟店制度について', '土地活用について', '資料請求・説明希望', 'その他'] as const;

export const contact = {
  labelEn: 'CONTACT',
  title: 'お問い合わせ',
  lead: '折り畳み式木造コンテナや宿泊施設づくりに関するご相談は、下記フォームよりお問い合わせください。内容を確認のうえ、担当者よりご連絡いたします。',
};
