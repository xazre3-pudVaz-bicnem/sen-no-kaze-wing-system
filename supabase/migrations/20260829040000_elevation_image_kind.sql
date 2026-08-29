-- =============================================================
-- 商品画像の種類に「立面図」を追加
--
-- 先方要望（2026-08-29）：間取り・パース・立面図などを商品台帳から登録したい。
-- これまで立面図はコード内の固定データ（Wing の4面のみ）だったため、
-- product_images.kind に 'elevation' を追加して管理画面から登録できるようにする。
-- シミュレーターの立面図欄は、登録された画像（caption がラベル）を使う。
-- =============================================================

alter table public.product_images drop constraint if exists product_images_kind_check;
alter table public.product_images add constraint product_images_kind_check
  check (kind in ('hero', 'exterior', 'interior', 'floorplan', 'elevation', 'transport', 'case'));
