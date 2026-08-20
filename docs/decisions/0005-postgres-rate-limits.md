# ADR 0005: PostgreSQL-Backed Pilot Rate Limits

- Status: accepted
- Date: 2026-08-20

## Context

Public writes require deterministic abuse limits, but the MVP explicitly avoids Redis and additional services unless necessary. The provisional pilot load is small enough for transactional counters in PostgreSQL.

## Decision

Use fixed-window PostgreSQL counters with atomic upserts for per-credential minute/day limits and secondary short-lived network limits.

Network subjects are HMAC pseudonyms derived in memory from independent key material assigned to one UTC date and a canonical address. Raw addresses are never stored. Stale key dates fail writes closed; previous daily keys are deleted. Network buckets expire within seven days and are deleted by an explicit daily CLI/cron operation.

Limits are enforced in the shared application flow before contribution persistence. Their configuration is recorded because it can affect experimental output.

## Consequences

The system remains operationally simple and consistent across local, serverless, and VPS deployments. Every write incurs small database contention and storage overhead. If measured load makes PostgreSQL counters a bottleneck, replacing the port implementation requires a new decision and parity tests; Redis is not added speculatively.
