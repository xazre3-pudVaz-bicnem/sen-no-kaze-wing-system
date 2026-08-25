-- =============================================================
-- 通知メールから、その見積の入力画面へ直接入れるようにする
--
-- 先方の要望：
--   「自分に届いたメールの別途工事の明細作成が可能にする。
--     尚、エンドユーザーIDと違いがそこになります。」
--
-- 通知のリンクに #quote-editor を付け、開いた瞬間に入力表まで飛ぶようにする。
-- 未ログインなら /login?next=... を経由して、ログイン後にそのまま入力画面へ戻る。
-- =============================================================

create or replace function public.trg_quote_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.revision = 1 then
      perform public.notify(null, 'admin', 'quote_requested',
        '新しい見積依頼：' || new.quote_no,
        new.customer_name || ' 様から見積依頼が届きました。担当代理店を割り当ててください。',
        '/admin/quotes/' || new.id);
    else
      perform public.notify(new.user_id, 'customer', 'quote_revised',
        '確定見積が届きました：' || new.quote_no,
        '代理店が別途工事を確認し、第' || new.revision || '版の確定見積を発行しました。',
        '/mypage/quotes/' || new.id);
    end if;
    return new;
  end if;

  if new.dealer_id is distinct from old.dealer_id and new.dealer_id is not null then
    perform public.notify(new.dealer_id, 'dealer', 'quote_assigned',
      '別途工事の入力をお願いします：' || new.quote_no,
      new.customer_name || ' 様の見積です。下のリンクを開くと、そのまま別途工事とフリー商品を入力できます。',
      -- メールから 1 回で入力表まで飛べるようにする
      '/admin/quotes/' || new.id || '?from=mail#quote-editor');
  end if;

  if new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    perform public.notify(null, 'admin', 'quote_' || new.status,
      '見積が' || (case new.status when 'accepted' then '承諾' else '辞退' end) || 'されました：' || new.quote_no,
      new.customer_name || ' 様が回答しました。',
      '/admin/quotes/' || new.id);
    if new.dealer_id is not null then
      perform public.notify(new.dealer_id, 'dealer', 'quote_' || new.status,
        '担当見積が' || (case new.status when 'accepted' then '承諾' else '辞退' end) || 'されました：' || new.quote_no,
        new.customer_name || ' 様が回答しました。',
        '/admin/quotes/' || new.id);
    end if;
  end if;
  return new;
end $$;
