import { contactTopics as baseContactTopics } from '@/data/site-content';

export const MULTI_MODEL_CONTACT_TOPIC = '複数モデルの組み合わせについて' as const;

/** 問い合わせフォームと送信時検証で共通利用する選択肢。 */
export const contactTopics = [
  baseContactTopics[0],
  MULTI_MODEL_CONTACT_TOPIC,
  ...baseContactTopics.slice(1),
] as const;
