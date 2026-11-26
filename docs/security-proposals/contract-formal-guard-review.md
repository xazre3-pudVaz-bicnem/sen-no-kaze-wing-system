# Electronic contract formal-quote guard — independent review package (A)

Basis: GitHub main `d7a600c27277fa5cc2498e58e9f053581e48c8bf`, production Supabase `ljgbpbymdkrjcnezaqno` inspected read-only on 2026-11-10. **No production DDL/DML, no contract sending.**

## Confirmed
- Live `begin_electronic_contract(uuid,text,text)`: postgres-owned SECURITY DEFINER, empty search_path, authenticated-only EXECUTE, checks auth, HQ role, accepted, current quote, duplicate active contract; no explicit `quote_kind='formal'` guard.
- Production: 10 quotes, all legacy `quote_kind IS NULL` and revision 1 without parent. Three are accepted/current/customer-owned; no electronic contracts exist.
- Existing workflow: `create_formal_quote_from_accepted_preliminary` explicitly issues `quote_kind='formal'`; v2.5 formal later revisions use pinned revision and server pricing.

## Intended change
1. Keep privilege-first validation and Quote -> QuoteRequest row-lock order.
2. After acceptance check, **fail closed** unless `q.quote_kind='formal'`. Never infer formal from NULL/accepted/revision number.
3. Verify `req.user_id=q.user_id`; revision 1 must have no parent, later revisions must have same-request previous revision. For v2.5 require revision >=2, parent and all version pins.
4. Preserve existing unique active-contract-per-request index, and function owner, SECURITY DEFINER, empty search_path, EXECUTE ACL.
5. Do not modify issued quotes, contracts, request current pointers, or any existing migration.

`contract-formal-guard.sql` is a **review-only migration proposal**, deliberately outside `supabase/migrations`. A vendor should use the Supabase CLI `migration new`, move the reviewed SQL to the generated file, verify the exact replacement marker against the pinned current DB state and re-run full rehearsals before merging. Do not directly apply this SQL to production.

## Test matrix (must be verified on disposable Postgres)
- Anonymous/customer/dealer denied before state exposure; HQ only.
- Accepted + preliminary denied; accepted + NULL legacy denied, including existing 3 eligible rows.
- Formal issued but not accepted denied; formal accepted but not current denied.
- Formal accepted current and valid chain permitted; v2.5 first revision denied; pinned v2.5 formal second revision permitted.
- Forged/broken parent, mismatched customer, cross-request parent denied.
- Two concurrent HQ calls: exactly one active contract; failing/retry status keeps existing behavior.
- No changes to quote, quote_items, request pointers, money or published snapshots.
- Function ACL/owner/search_path unchanged; anon and service_role may not execute.

## Deployment stop conditions
- Any unexpected migration version/history, patch marker mismatch, ownership/EXECUTE difference, current HEAD drift, unreviewed conflict with #502-#506, or failed runtime test.
- Backups, actual pending migration sequence, dry-run, independent reviewer approval and production pre/postflight are required.
- Treat existing 3 accepted legacy quotes as **not contract eligible** until an explicitly issued/accepted formal revision exists. No implicit backfill.

## Residual risks
- Starting a contract inserts `sending` in a DB transaction, whereas external GMO sending is a separate network operation. Crash handling/reconciliation remains operationally necessary.
- LocalStore mirror and tests are updated in this branch; the real DB guard is **not active** until a vetted migration is applied.
- This is a review candidate, **not independent review approval**. Decision: **MERGE NOT ALLOWED** until independent security/DB review and runtime tests.
