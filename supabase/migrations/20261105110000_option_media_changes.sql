-- 登録済み商品の追加画像・メーカー資料PDFの変更をまとめて反映する（PR #563 の正式保存。2026-11-04 の先方回答 C-4）。
-- 2026-10-23 の本番 read-only 監査の推奨どおり、表は変えず関数 1 本にする。
--   * 商品の行と、その商品の追加画像の行をロックし、画面を開いた時点の追加画像（id・URL・説明・表示順）とメーカー資料の URL が
--     今と同じときだけ反映する（option_images には版・更新日時の列が無いので、内容そのものを照合する。違えば CONFLICT）。
--     追加画像の新しい行は、外部キーの確認で商品の行のロックを待つので、反映の途中に割り込めない
--   * 削除・説明と表示順の変更・追加・メーカー資料の差し替えと解除を 1 つのトランザクションで反映する（途中で失敗したら何も変わらない）
--   * 新しいファイルは、アプリが先に Storage の商品のフォルダー（option-<id>/gallery/・option-<id>/manufacturer/）へ置く。
--     この関数は置き場所と、Storage にファイルがあることを確かめてから紐付ける（ほかの商品のファイル・存在しないファイルは紐付けない）
--   * 変更の履歴を audit_logs に残す（write_audit。action は media）
--   * 参照されなくなったファイルの URL を返す。ファイルの削除はアプリが反映の成功後だけ行う（それ以外の未参照のファイルは消さない）
-- 権限は options・option_images の書き込みの決まり（options_admin・option_images_write）と同じ：商品台帳を編集できる人、
-- または旧フリー商品の持ち主の代理店。

create function public.apply_option_media_changes(p_option_id uuid, p_expected jsonb, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_image_marker constant text := '/storage/v1/object/public/product-images/';
  c_document_marker constant text := '/storage/v1/object/public/product-documents/';
  c_gallery_max constant integer := 30;
  v_option public.options%rowtype;
  v_before jsonb;
  v_expected jsonb;
  v_after jsonb;
  v_delete uuid[] := '{}';
  v_update_ids uuid[] := '{}';
  v_item jsonb;
  v_id uuid;
  v_url text;
  v_path text;
  v_meta jsonb;
  v_caption text;
  v_sort integer;
  v_action text;
  v_unreferenced text[] := '{}';
  v_deleted integer := 0;
  v_updated integer := 0;
  v_added integer := 0;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: ログインが必要です';
  end if;
  if p_option_id is null
     or jsonb_typeof(p_expected) is distinct from 'object'
     or jsonb_typeof(p_expected -> 'gallery') is distinct from 'array'
     or jsonb_typeof(p_changes) is distinct from 'object' then
    raise exception 'VALIDATION: 追加画像・メーカー資料の変更の内容が正しくありません';
  end if;

  select * into v_option from public.options where id = p_option_id for update;
  if not found then
    raise exception 'NOT_FOUND: 商品が見つかりません';
  end if;
  if not (
    public.can_edit_catalog()
    or (
      public.is_dealer()
      and v_option.owner_id = auth.uid()
      and exists (select 1 from public.option_categories c where c.id = v_option.category_id and c.code = 'free-product')
    )
  ) then
    raise exception 'FORBIDDEN: この商品の追加画像・メーカー資料は編集できません';
  end if;
  perform 1 from public.option_images i where i.option_id = p_option_id for update;

  -- ---------- 画面を開いた時点の状態と、今の状態を照合する（追加画像は id の順。説明の空は NULL とみなす） ----------
  select jsonb_build_object(
           'gallery', coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'caption', nullif(i.caption, ''), 'sort_order', i.sort_order) order by i.id), '[]'::jsonb),
           'manufacturer_document_url', v_option.manufacturer_document_url)
    into v_before
    from public.option_images i
   where i.option_id = p_option_id;
  begin
    select jsonb_build_object(
             'gallery', coalesce(jsonb_agg(jsonb_build_object('id', (e ->> 'id')::uuid, 'url', e ->> 'url', 'caption', nullif(e ->> 'caption', ''), 'sort_order', (e ->> 'sort_order')::integer) order by (e ->> 'id')::uuid), '[]'::jsonb),
             'manufacturer_document_url', nullif(p_expected ->> 'manufacturer_document_url', ''))
      into v_expected
      from jsonb_array_elements(p_expected -> 'gallery') e;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'VALIDATION: 追加画像・メーカー資料の変更の内容が正しくありません';
  end;
  if v_before is distinct from v_expected then
    raise exception 'CONFLICT: 追加画像・メーカー資料が、画面を開いた後にほかの操作で変わりました。画面を開き直してから、もう一度変更してください';
  end if;

  -- ---------- 削除 ----------
  if p_changes ? 'delete' then
    if jsonb_typeof(p_changes -> 'delete') is distinct from 'array' then
      raise exception 'VALIDATION: 削除する追加画像の指定が正しくありません';
    end if;
    begin
      select coalesce(array_agg(x::uuid), '{}') into v_delete from jsonb_array_elements_text(p_changes -> 'delete') x;
    exception when invalid_text_representation then
      raise exception 'VALIDATION: 削除する追加画像の指定が正しくありません';
    end;
    if cardinality(v_delete) <> (select count(distinct d) from unnest(v_delete) d) then
      raise exception 'VALIDATION: 削除する追加画像が重なっています';
    end if;
    if exists (select 1 from unnest(v_delete) d where not exists (select 1 from public.option_images i where i.id = d and i.option_id = p_option_id)) then
      raise exception 'VALIDATION: 削除する追加画像が見つかりません';
    end if;
    select coalesce(array_agg(i.url order by i.sort_order, i.id), '{}') into v_unreferenced
      from public.option_images i where i.option_id = p_option_id and i.id = any (v_delete);
    delete from public.option_images i where i.option_id = p_option_id and i.id = any (v_delete);
    get diagnostics v_deleted = row_count;
  end if;

  -- ---------- 説明・表示順の変更 ----------
  if p_changes ? 'update' and jsonb_typeof(p_changes -> 'update') is distinct from 'array' then
    raise exception 'VALIDATION: 変更する追加画像の指定が正しくありません';
  end if;
  for v_item in select e from jsonb_array_elements(coalesce(p_changes -> 'update', '[]'::jsonb)) e loop
    begin
      v_id := (v_item ->> 'id')::uuid;
      v_sort := (v_item ->> 'sort_order')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'VALIDATION: 変更する追加画像の指定が正しくありません';
    end;
    v_caption := nullif(btrim(v_item ->> 'caption'), '');
    if v_id is null or v_id = any (v_update_ids) or v_id = any (v_delete) then
      raise exception 'VALIDATION: 変更する追加画像の指定が正しくありません';
    end if;
    if v_sort is null or v_sort < 0 or v_sort > 100000 then
      raise exception 'VALIDATION: 追加画像の表示順は 0 以上 100000 以下で入力してください';
    end if;
    if char_length(v_caption) > 200 then
      raise exception 'VALIDATION: 追加画像の説明は 200 文字以内で入力してください';
    end if;
    update public.option_images i set caption = v_caption, sort_order = v_sort where i.id = v_id and i.option_id = p_option_id;
    if not found then
      raise exception 'VALIDATION: 変更する追加画像が見つかりません';
    end if;
    v_update_ids := v_update_ids || v_id;
    v_updated := v_updated + 1;
  end loop;

  -- ---------- 追加（Storage の商品のフォルダーに置いたファイルだけ） ----------
  if p_changes ? 'add' and jsonb_typeof(p_changes -> 'add') is distinct from 'array' then
    raise exception 'VALIDATION: 追加する画像の指定が正しくありません';
  end if;
  for v_item in select e from jsonb_array_elements(coalesce(p_changes -> 'add', '[]'::jsonb)) e loop
    v_url := v_item ->> 'url';
    -- 置き場所：Supabase の公開 URL（https://<プロジェクト>.supabase.co/storage/v1/object/public/product-images/）の、
    -- この商品の追加画像のフォルダーだけ（ほかのホストの URL は紐付けない。独自ドメインにするときはここも変える）
    if v_url is null or char_length(v_url) > 1000
       or v_url !~ ('^https://[a-z0-9-]+\.supabase\.co' || c_image_marker || 'option-' || p_option_id::text || '/gallery/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$') then
      raise exception 'VALIDATION: 追加画像の置き場所が正しくありません';
    end if;
    v_path := substr(v_url, position(c_image_marker in v_url) + char_length(c_image_marker));
    select o.metadata into v_meta from storage.objects o where o.bucket_id = 'product-images' and o.name = v_path;
    if not found then
      raise exception 'VALIDATION: 追加画像のファイルが見つかりません。画像を選び直してください';
    end if;
    -- Storage が記録したファイルの種類と大きさ（ブラウザから直接置いたファイルも、バケットの決まりと同じ範囲だけ）
    if coalesce(v_meta ->> 'mimetype', '') not in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')
       or (case when v_meta ->> 'size' ~ '^[0-9]{1,12}$' then (v_meta ->> 'size')::bigint else 0 end) not between 1 and 10485760 then
      raise exception 'VALIDATION: 追加画像は JPEG・PNG・WebP・AVIF、1 枚 10MB 以下のファイルだけ紐付けられます';
    end if;
    -- 同じファイルかは Storage の置き場所で比べる（URL のホストの書き方が違っても、同じファイルを 2 行に紐付けない）
    if exists (select 1 from public.option_images i where split_part(i.url, c_image_marker, 2) = v_path) then
      raise exception 'VALIDATION: 同じ画像ファイルが既に登録されています';
    end if;
    begin
      v_sort := (v_item ->> 'sort_order')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'VALIDATION: 追加画像の表示順は 0 以上 100000 以下で入力してください';
    end;
    if v_sort is null or v_sort < 0 or v_sort > 100000 then
      raise exception 'VALIDATION: 追加画像の表示順は 0 以上 100000 以下で入力してください';
    end if;
    v_caption := nullif(btrim(v_item ->> 'caption'), '');
    if char_length(v_caption) > 200 then
      raise exception 'VALIDATION: 追加画像の説明は 200 文字以内で入力してください';
    end if;
    insert into public.option_images (option_id, url, alt, caption, sort_order)
    values (p_option_id, v_url, left(coalesce(nullif(btrim(v_item ->> 'alt'), ''), v_option.name), 200), v_caption, v_sort);
    v_added := v_added + 1;
  end loop;

  -- 上限は枚数を増やすときだけ（上限を超えている既存の商品でも、説明・表示順・削除はできる）
  select count(*) into v_count from public.option_images i where i.option_id = p_option_id;
  if v_count > c_gallery_max and v_count > jsonb_array_length(v_before -> 'gallery') then
    raise exception 'VALIDATION: 追加画像は 1 商品 % 枚までです', c_gallery_max;
  end if;

  -- ---------- メーカー資料PDF（差し替え・解除） ----------
  v_action := coalesce(p_changes -> 'document' ->> 'action', 'keep');
  if v_action not in ('keep', 'replace', 'remove') then
    raise exception 'VALIDATION: メーカー資料の変更の指定が正しくありません';
  end if;
  if v_action = 'replace' then
    v_url := p_changes -> 'document' ->> 'url';
    -- 置き場所：Supabase の公開 URL の、この商品のメーカー資料のフォルダーの PDF だけ（追加画像と同じ）
    if v_url is null or char_length(v_url) > 1000
       or v_url !~ ('^https://[a-z0-9-]+\.supabase\.co' || c_document_marker || 'option-' || p_option_id::text || '/manufacturer/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.pdf$') then
      raise exception 'VALIDATION: メーカー資料の置き場所が正しくありません';
    end if;
    v_path := substr(v_url, position(c_document_marker in v_url) + char_length(c_document_marker));
    select o.metadata into v_meta from storage.objects o where o.bucket_id = 'product-documents' and o.name = v_path;
    if not found then
      raise exception 'VALIDATION: メーカー資料のファイルが見つかりません。PDF を選び直してください';
    end if;
    if coalesce(v_meta ->> 'mimetype', '') <> 'application/pdf'
       or (case when v_meta ->> 'size' ~ '^[0-9]{1,12}$' then (v_meta ->> 'size')::bigint else 0 end) not between 1 and 20971520 then
      raise exception 'VALIDATION: メーカー資料は 20MB 以下の PDF だけ紐付けられます';
    end if;
    if split_part(coalesce(v_option.manufacturer_document_url, ''), c_document_marker, 2) = v_path then
      raise exception 'VALIDATION: 今と同じメーカー資料です';
    end if;
    if v_option.manufacturer_document_url is not null then
      v_unreferenced := v_unreferenced || v_option.manufacturer_document_url;
    end if;
    update public.options o set manufacturer_document_url = v_url where o.id = p_option_id;
  elsif v_action = 'remove' then
    if v_option.manufacturer_document_url is null then
      raise exception 'VALIDATION: メーカー資料は登録されていません';
    end if;
    v_unreferenced := v_unreferenced || v_option.manufacturer_document_url;
    update public.options o set manufacturer_document_url = null where o.id = p_option_id;
  end if;

  -- ---------- 履歴 ----------
  select jsonb_build_object(
           'gallery', coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'caption', nullif(i.caption, ''), 'sort_order', i.sort_order) order by i.id), '[]'::jsonb),
           'manufacturer_document_url', (select o.manufacturer_document_url from public.options o where o.id = p_option_id))
    into v_after
    from public.option_images i
   where i.option_id = p_option_id;
  if v_after is distinct from v_before then
    perform public.write_audit(
      'media', 'option', p_option_id,
      format('追加画像・メーカー資料を変更：%s（追加画像 削除 %s・変更 %s・追加 %s／メーカー資料 %s）',
             v_option.name, v_deleted, v_updated, v_added,
             case v_action when 'replace' then '差し替え' when 'remove' then '解除' else '変更なし' end),
      v_before, v_after);
  end if;

  -- 参照されなくなったファイル：ほかの行（追加画像・メイン画像・メーカー資料・選択肢の画像・発行済みの見積の明細）が使っていないものだけ返す。
  -- 使っているかは Storage の置き場所（バケットとパス）で比べる（URL のホストの書き方が違っても、使われているファイルを消さない）
  select coalesce(array_agg(t.u order by t.n), '{}') into v_unreferenced
    from (select x.u, min(x.n) as n, split_part(x.u, '/storage/v1/object/public/', 2) as p
            from unnest(v_unreferenced) with ordinality as x(u, n) group by x.u) t
   where t.p <> ''
     and not exists (select 1 from public.option_images i where split_part(i.url, '/storage/v1/object/public/', 2) = t.p)
     and not exists (select 1 from public.options o
                      where split_part(coalesce(o.image_url, ''), '/storage/v1/object/public/', 2) = t.p
                         or split_part(coalesce(o.manufacturer_document_url, ''), '/storage/v1/object/public/', 2) = t.p)
     and not exists (select 1 from public.option_variant_choices c where split_part(coalesce(c.image_url, ''), '/storage/v1/object/public/', 2) = t.p)
     and not exists (select 1 from public.quote_items qi where split_part(coalesce(qi.image_url, ''), '/storage/v1/object/public/', 2) = t.p);

  return jsonb_build_object(
    'gallery', (select coalesce(jsonb_agg(to_jsonb(i) order by i.sort_order, i.id), '[]'::jsonb) from public.option_images i where i.option_id = p_option_id),
    'manufacturer_document_url', (select o.manufacturer_document_url from public.options o where o.id = p_option_id),
    'unreferenced_urls', to_jsonb(v_unreferenced));
end;
$fn$;

comment on function public.apply_option_media_changes(uuid, jsonb, jsonb) is
  '登録済み商品の追加画像・メーカー資料PDFの変更をまとめて反映する（行ロック・画面を開いた時点の状態の照合・Storage の置き場所の確認・履歴）。PR #563';

revoke all on function public.apply_option_media_changes(uuid, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.apply_option_media_changes(uuid, jsonb, jsonb) to authenticated;
