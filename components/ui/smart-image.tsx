import Image, { type ImageProps } from 'next/image';

/**
 * 画像の出どころで最適化の有無を切り替える。
 * - /images/ 配下（リポジトリ同梱）: next/image で最適化
 * - それ以外（Supabase Storage・ローカルアップロード・外部 URL）: そのまま配信
 */
export function SmartImage(props: ImageProps) {
  const src = typeof props.src === 'string' ? props.src : '';
  const optimized = src.startsWith('/images/');
  return <Image {...props} unoptimized={!optimized || props.unoptimized} alt={props.alt ?? ''} />;
}
