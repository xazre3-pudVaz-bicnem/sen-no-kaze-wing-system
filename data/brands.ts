/** Wing 煌／灯／翠（土地の性格に合わせた活用モデル。先方サイトの定義に準拠） */
export interface Brand {
  code: 'kirameki' | 'tomoshibi' | 'midori';
  kanji: string;
  kana: string;
  roman: string;
  scene: string;
  copy: string;
  image: string;
  alt: string;
  tone: 'light' | 'dark';
}

export const brands: Brand[] = [
  {
    code: 'kirameki',
    kanji: '煌',
    kana: 'きらめき',
    roman: 'KIRAMEKI',
    scene: '海沿い向け',
    copy: '海沿いや眺望のよい土地での宿泊施設づくりを想定したモデルです。',
    image: '/images/brands/kirameki.jpg',
    alt: '海を望む高台に建つデッキ付きの Wing 煌',
    tone: 'light',
  },
  {
    code: 'tomoshibi',
    kanji: '灯',
    kana: 'ともしび',
    roman: 'TOMOSHIBI',
    scene: '町中向け',
    copy: '町中や既存施設の近くでの活用を想定したモデルです。',
    image: '/images/brands/tomoshibi.jpg',
    alt: '夜、室内の灯りが窓から漏れる Wing 灯',
    tone: 'dark',
  },
  {
    code: 'midori',
    kanji: '翠',
    kana: 'みどり',
    roman: 'MIDORI',
    scene: '里山向け',
    copy: '里山や自然に囲まれた土地での活用を想定したモデルです。',
    image: '/images/brands/midori.jpg',
    alt: '新緑の木立に囲まれて建つ Wing 翠',
    tone: 'light',
  },
];
