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

-- Draft再表示でも案件名を同じ編集画面に返す。
create or replace function public.get_quote_draft(p_draft_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $get_draft$
declare
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  d public.quote_drafts;
  parent public.quotes;
  r public.quote_requests;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if v_rank < 1 then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into d
    from public.quote_drafts
   where id = p_draft_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if d.parent_quote_id is null then
    if v_rank < 3 and d.created_by is distinct from v_uid then
      raise exception 'FORBIDDEN: このDraftを編集できません' using errcode = '42501';
    end if;
  else
    select * into parent
      from public.quotes
     where id = d.parent_quote_id
       and quote_request_id = d.quote_request_id;

    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_rank < 3 and parent.dealer_id is distinct from v_uid then
      raise exception 'FORBIDDEN: このDraftを編集できません' using errcode = '42501';
    end if;
  end if;

  select * into r
    from public.quote_requests
   where id = d.quote_request_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'draft', to_jsonb(d),
    'request', jsonb_build_object(
      'id', r.id,
      'case_name', r.case_name,
      'status', r.status,
      'message', r.message,
      'contact', r.contact,
      'created_by', r.created_by,
      'created_at', r.created_at,
      'updated_at', r.updated_at
    ),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.sort_order, i.id)
        from public.quote_draft_items i
       where i.draft_id = d.id
    ), '[]'::jsonb),
    'base_revisions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', rev.id,
          'base_master_id', master.id,
          'master_name', master.name,
          'fire_spec_code', master.fire_spec_code,
          'version', rev.version,
          'total', rev.total
        )
        order by
          case master.fire_spec_code when 'non_fire' then 0 else 1 end,
          master.name,
          rev.version desc
      )
        from public.base_masters master
        join public.base_master_revisions rev
          on rev.base_master_id = master.id
       where master.base_model_id = d.base_model_id
         and rev.status in ('published', 'superseded')
         and (
           rev.id = d.base_master_revision_id
           or (
             master.status = 'active'
             and rev.id = master.current_published_revision_id
             and public.can_use_base_master(master.id)
           )
         )
    ), '[]'::jsonb)
  );
end;
$get_draft$;

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
