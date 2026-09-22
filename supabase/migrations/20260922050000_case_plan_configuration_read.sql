-- =============================================================
-- 案件プランボード用の保存Configuration読み取り
--
-- 通常の configurations / configuration_items RLS は広げない。
-- 管理者、またはそのQuoteに割り当て済みの代理店以上だけが、
-- 案件プランボード表示に必要な保存仕様をQuote経由で読み取れる。
-- =============================================================

begin;

create or replace function public.get_case_plan_configuration(p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  v_quote public.quotes;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  if v_rank < 1 then
    raise exception 'FORBIDDEN: 案件プランボードを確認できるのは担当者以上です'
      using errcode = '42501';
  end if;

  select *
    into v_quote
    from public.quotes
   where id = p_quote_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if not (v_rank >= 2 or (v_rank >= 1 and v_quote.dealer_id = v_uid)) then
    raise exception 'FORBIDDEN: この見積の担当者ではありません'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
           'configuration', to_jsonb(c),
           'items', coalesce(
             (
               select jsonb_agg(to_jsonb(ci) order by ci.id)
                 from public.configuration_items ci
                where ci.configuration_id = c.id
             ),
             '[]'::jsonb
           ),
           'exterior_faces', coalesce(c.exterior_faces, '[]'::jsonb)
         )
    into v_result
    from public.configurations c
   where c.id = v_quote.configuration_id;

  if v_result is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

revoke execute on function public.get_case_plan_configuration(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_case_plan_configuration(uuid) to authenticated;

commit;
