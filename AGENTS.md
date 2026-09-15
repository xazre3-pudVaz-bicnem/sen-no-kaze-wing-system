<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Wing development rules

## Scope

Start from changed files or the diff and their direct dependencies.

Expand the investigation when impact analysis indicates risk involving:
- shared contracts
- database schema
- auth / RLS / permissions
- pricing or estimates
- migrations
- revisions / snapshots
- transactions / concurrency
- public APIs
- cross-module invariants

Avoid repository-wide or repeated investigation unless there is a concrete reason.

Reuse trustworthy evidence from the exact HEAD.
Do not re-investigate unchanged facts unless the current change can invalidate them.

## Git and changes

- Never commit directly to `main`.
- Use a work branch and pull request.
- Do not commit, push, create/update a PR, merge, or deploy unless explicitly requested.
- Prefer the smallest safe change.
- Do not modify unrelated code or add unnecessary abstractions, dependencies, migrations, or refactors.

## Testing

- During implementation, prefer checks relevant to the changed area.
- Do not repeatedly run the full test/build suite after small edits.
- Reuse successful authoritative CI evidence from the exact HEAD when appropriate.
- Run additional verification only when there is a concrete reason.
- Never claim runtime DB behavior was verified when only static review was possible.

## Database safety

- Use only repository-defined or explicitly authorized DB validation environments.
- Do not start, stop, restart, or reconfigure the Windows system PostgreSQL service.
- Do not create or use ad-hoc PostgreSQL, portable PostgreSQL, PostgREST, gateway, or similar stacks for validation unless explicitly authorized.
- Do not apply migrations or DDL to remote Supabase unless explicitly requested and authorized.
- If runtime DB validation is unavailable, report it as unverified.

## High-risk review

For DB, RLS, SECURITY DEFINER, pricing, estimates, revisions, migrations, and concurrency, verify relevant DB-side invariants, including where applicable:

- RLS / ACL / GRANT / REVOKE
- SECURITY DEFINER and search_path
- FK / UNIQUE / CHECK constraints
- transaction boundaries
- lock ordering / deadlock risk
- stale-data / TOCTOU risk
- revision immutability
- monetary consistency
- migration retry / partial failure behavior
- concurrent execution

Do not rely only on UI or application-side checks.

## Reporting

Do not narrate investigation progress.

Final report should contain only:
- changes or findings
- verification evidence
- remaining unverified items
