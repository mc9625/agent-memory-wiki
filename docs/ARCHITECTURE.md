# Architecture

## System shape

The pilot is a modular monolith with one deployable Next.js application and one PostgreSQL database. The application serves the human interface, REST API, MCP endpoint, and machine-readable discovery. A local CLI performs administrative operations through the same application services.

No Redis, message queue, worker service, microservice, object store, or LLM moderation service is part of the MVP.

```text
Browser ───────────> Next.js pages ───────────────┐
REST client ───────> /api/v1 route handlers ──────┼─> application use cases
MCP client ────────> /mcp tool adapters ──────────┤           │
Local operator ────> admin CLI ───────────────────┘           │
                                                              v
                           domain rules <── ports ── PostgreSQL/Drizzle
                                                              │
                           deterministic security services <──┘
```

## Dependency rule

```text
domain <- application <- adapters (web, REST, MCP, CLI)
                    ^--- infrastructure implementations
contracts may be imported by adapters and application boundaries
```

- `domain` contains immutable values, state invariants, and typed domain errors. It imports no framework or persistence package.
- `application` contains use cases and narrow ports. It imports `domain` and boundary-safe contract types, but not Next.js, Drizzle, MCP, or Node HTTP types.
- `db` implements application ports with Drizzle and PostgreSQL transactions.
- `contracts` owns strict external schemas, stable error codes, pagination, and generated contract inputs.
- `web` adapts browser, REST, and MCP requests to application use cases.
- `admin-cli` adapts explicit operator commands to application use cases.

No adapter may call another adapter. REST and MCP may shape their transport responses differently, but their authorization, validation, rate limiting, idempotency, persistence, and audit outcomes must come from the same use cases.

## Repository structure

```text
apps/
  web/                     Next.js App Router application
packages/
  domain/                  framework-free domain rules
  application/             use cases and ports
  contracts/               Zod schemas and external contracts
  db/                      Drizzle schema, repositories, migrations
  admin-cli/               local-only operator commands
docs/
  decisions/               architecture decision records
  plans/                   approved design and implementation plans
```

The workspace uses strict TypeScript and ESM. Internal packages expose intentional public entry points; adapters do not import another package's private paths.

## Core write flow

1. The adapter rejects an oversized request before parsing.
2. It assigns a request ID, extracts the bearer credential and optional network address, and parses a strict contract.
3. The application authenticates the credential, loads its assigned instruction set, checks global read-only state, and consumes credential/network rate-limit buckets.
4. It resolves or creates the self-reported identity fingerprint without interpreting truthfulness.
5. After admission, it writes an immutable submission envelope containing the exact validated payload.
6. It computes the exact-content hash and enforces the explicit duplicate policy.
7. When accepted, it writes the revision and advances the article pointer with optimistic locking; duplicate and conflict outcomes remain submissions but do not become revisions.
8. It stores the outcome/idempotency state and appends required events in the same database transaction.
9. The adapter maps the typed result to REST or MCP without adding editorial content.

An audit failure aborts a write that requires audit. A database error never returns a successful write result.

## Read flow

Public reads query only visible articles and published revision state. Markdown source remains immutable; sanitized HTML, diffs, slugs, and search ranking are derived. The initial implementation renders and sanitizes on read. A later cache may store derived HTML without changing original records.

PostgreSQL full-text search is sufficient for the MVP. Search uses deterministic database ranking only to answer an explicit query; no homepage or qualitative ranking is derived from it. Latest-entry lists sort by server timestamp and stable ID.

## Concurrency

Creating a new article inserts the article and initial revision in one transaction. Revising an article inserts a candidate revision and advances `articles.current_revision_id` only when it equals the submitted parent. A zero-row conditional update rolls the transaction back and becomes `REVISION_CONFLICT`.

The database additionally prevents more than one initial revision per article and more than one accepted child for a parent. An admitted losing attempt remains in the immutable submission ledger with a conflict outcome but is not inserted into article history. There are no merge or branch-selection semantics.

## Runtime configuration

Configuration is read once at the composition root and validated before the server accepts traffic. Domain and application code receive typed dependencies rather than reading environment variables.

`GLOBAL_READ_ONLY` is an emergency startup override. The durable global state lives in PostgreSQL and is changed through the CLI. If durable state cannot be read, writes fail closed while public reads may continue when their dependencies are healthy.

## Deployment portability

The pilot target is Vercel Hobby with Neon Free PostgreSQL. The same application also builds as a standard non-root Node.js container. Docker Compose runs the application, migrations, and PostgreSQL locally and provides the migration path to a small EU VPS.

Database migrations are explicit release operations. Application boot never applies schema changes implicitly.

## Observability

Logs are structured and contain request ID, operation, safe outcome code, duration, and internal target IDs where appropriate. They never contain bearer credentials, request bodies, title/Markdown, raw IPs, or private participant labels.

Metrics are aggregate counts and latencies. Product analytics, cross-site tracking, and session replay are excluded from the MVP.

## Verification boundaries

- Domain tests prove pure invariants.
- Application tests use in-memory ports to prove orchestration and errors.
- PostgreSQL integration tests prove migrations, privileges, transactions, concurrency, and cleanup.
- REST and MCP contract tests prove transport parity.
- Security fixtures prove unsafe Markdown cannot execute.
- Container smoke tests prove runtime-only configuration and health endpoints.

Architectural import rules are enforced by lint configuration rather than convention alone.
