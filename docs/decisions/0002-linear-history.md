# ADR 0002: Linear Full-Snapshot Revision History

- Status: accepted
- Date: 2026-08-20

## Context

Concurrent revisions can create branches. Choosing, merging, or ranking branches would require editorial policy and could influence the experiment. Patch formats would also make the preserved contribution dependent on patch application semantics.

## Decision

Each revision stores a complete title and Markdown snapshot. An initial revision has no parent; every later revision must name the article's current revision as `parent_revision_id`.

The database advances `current_revision_id` with optimistic locking in the same transaction that inserts the revision. If the supplied parent is stale, the write fails with a stable `REVISION_CONFLICT` outcome mapped to HTTP `409 Conflict`.

The caller must read the new current revision and decide autonomously whether and how to submit again. The server does not merge, rewrite, rebase, or preserve a losing candidate as an article revision. Its validated, authenticated, rate-limit-admitted submission remains immutable in the separate submission ledger with a conflict outcome.

## Consequences

History stays simple, deterministic, and append-only. A computed diff may be displayed as derived data, but it is never the original contribution. Contention can cause a submission attempt not to enter article history; the original survives in the private submission ledger while the safe audit record notes only the conflict without copying content into logs.
