-- =============================================================
-- Unified manual Quote authoring
--
-- 案件管理の「見積書を作成」から、案件情報とExcel型見積明細を
-- 同一画面で入力し、初回下書き保存時に quote_request + Draft +
-- Draft明細を1 transactionで作成する。
-- =============================================================

begin;

alter table public.quote_requests
  add column if not exists case_name text;

do $case_name_constraint$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.quote_requests'::regclass
       and conname = 'quote_requests_case_name_length'
  ) then
    alter table public.quote_requests
      add constraint quote_requests_case_name_length
      check (
        case_name is null
        or (
          length(btrim(case_name)) between 1 and 120
          and case_name = btrim(case_name)
        )
      );
  end if;
end;
$case_name_constraint$;

comment on column public.quote_requests.case_name is
  '案件管理で使う案件名。顧客名・会社名とは別の業務上の案件タイトル。';

create or replace function public.create_manual_quote_draft_with_items(
  p_case_name text,
  p_contact jsonb,
  p_message text,
  p_base_model_id uuid,
  p_spec_code text,
  p_finish_level text,
  p_base_master_revision_id uuid,
  p_items jsonb,
  p_adjustment integer,
  p_adjustment_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $unified_manual_quote$
declare
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  v_case_name text := nullif(btrim(coalesce(p_case_name, '')), '');
  v_draft_id uuid;
  v_request_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if v_rank < 1 then
    raise exception 'FORBIDDEN: 見積書を作成できるのは代理店以上です'
      using errcode = '42501';
  end if;

  if v_case_name is not null and length(v_case_name) > 120 then
    raise exception 'VALIDATION: 案件名は120文字以内で入力してください'
      using errcode = 'P0001';
  end if;

  -- 同じDB transaction内で既存の案件作成RPCとDraft保存RPCを呼ぶ。
  -- 後段の明細検証・金額再計算に失敗した場合、案件作成もまとめてrollbackされる。
  v_draft_id := public.create_manual_quote_case(
    p_contact,
    p_message,
    p_base_model_id,
    p_spec_code,
    p_finish_level
  );

  select d.quote_request_id
    into v_request_id
    from public.quote_drafts d
   where d.id = v_draft_id;

  if not found then
    raise exception 'INTERNAL: 作成したDraftの案件を取得できません'
      using errcode = 'P0001';
  end if;

  update public.quote_requests
     set case_name = v_case_name
   where id = v_request_id;

  perform public.save_quote_draft(
    v_draft_id,
    0,
    p_base_master_revision_id,
    p_items,
    p_adjustment,
    p_adjustment_reason,
    null,
    p_message
  );

  return v_draft_id;
end;
$unified_manual_quote$;

alter function public.create_manual_quote_draft_with_items(
  text, jsonb, text, uuid, text, text, uuid, jsonb, integer, text
) owner to postgres;

do $owner_check$
begin
  if pg_catalog.pg_get_userbyid(
       (
         select p.proowner
           from pg_catalog.pg_proc p
          where p.oid =
            'public.create_manual_quote_draft_with_items(text,jsonb,text,uuid,text,text,uuid,jsonb,integer,text)'::regprocedure
       )
     ) <> 'postgres'
  then
    raise exception 'UNIFIED_MANUAL_QUOTE_OWNER_INVALID: RPC owner must be postgres'
      using errcode = 'P0001';
  end if;
end;
$owner_check$;

revoke execute on function public.create_manual_quote_draft_with_items(
  text, jsonb, text, uuid, text, text, uuid, jsonb, integer, text
) from public, anon, authenticated, service_role;

grant execute on function public.create_manual_quote_draft_with_items(
  text, jsonb, text, uuid, text, text, uuid, jsonb, integer, text
) to authenticated;

comment on function public.create_manual_quote_draft_with_items(
  text, jsonb, text, uuid, text, text, uuid, jsonb, integer, text
) is
  '案件情報と見積Draft明細を初回下書き保存時に同一transactionで作成する。正式Quote Revisionは発行しない。';

commit;
