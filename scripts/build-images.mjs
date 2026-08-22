/**
 * OGP 画像とアイコンを素材から生成する。
 *   node scripts/build-images.mjs
 */
import sharp from 'sharp';

await sharp('public/images/hero/sunset-sea-4k.webp').resize(1200, 630, { fit: 'cover', position: 'east' }).jpeg({ quality: 82 }).toFile('public/og-image.jpg');
await sharp('public/images/brand/sennokaze-logo.png').resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile('public/icon.png');
console.log('public/og-image.jpg, public/icon.png を生成しました');
