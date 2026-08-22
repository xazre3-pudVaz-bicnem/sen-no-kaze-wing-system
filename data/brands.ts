/** 3ブランド（縦長のブランドビジュアル） */
export interface Brand {
  code: 'kirameki' | 'tomoshibi' | 'midori';
  kanji: string;
  roman: string;
  copy: string;
  lead: string;
  image: string;
  alt: string;
  /** 建物が切れないための object-position（PC / SP） */
  position: string;
  positionMobile: string;
  tone: 'light' | 'dark';
}

export const brands: Brand[] = [
  {
    code: 'kirameki',
    kanji: '煌',
    roman: 'KIRAMEKI',
    copy: '海と光を取り込む、開放的な滞在空間。',
    lead: '朝日が昇る海辺の高台に。ウッドデッキから水平線を眺め、光とともに一日が始まる滞在のかたち。',
    image: '/images/brands/kirameki.jpg',
    alt: '朝日に輝く海を見下ろす高台に建つデッキ付きのWing',
    position: '50% 62%',
    positionMobile: '50% 70%',
    tone: 'light',
  },
  {
    code: 'tomoshibi',
    kanji: '灯',
    roman: 'TOMOSHIBI',
    copy: '静かな夜に、人を迎える温かな灯り。',
    lead: '森の中の小道を進むと、窓から漏れる明かりが迎えてくれる。宿泊施設としての Wing が持つ、もうひとつの表情。',
    image: '/images/brands/tomoshibi.jpg',
    alt: '夜の森に建ち、室内の灯りが窓から漏れるWing',
    position: '50% 60%',
    positionMobile: '50% 68%',
    tone: 'dark',
  },
  {
    code: 'midori',
    kanji: '翠',
    roman: 'MIDORI',
    copy: '森と呼吸する、自然に溶け込む空間。',
    lead: '木立の間に置かれた一棟。造成を最小限に抑え、木々の緑と山並みをそのまま借景にする。',
    image: '/images/brands/midori.jpg',
    alt: '新緑の森に囲まれた斜面に建つデッキ付きのWing',
    position: '50% 58%',
    positionMobile: '50% 66%',
    tone: 'light',
  },
];
