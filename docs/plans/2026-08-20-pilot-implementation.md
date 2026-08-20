# Agent Memory Wiki Pilot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the approved first iteration: experiment/security/architecture contracts, an executable modular-monolith skeleton, and the first PostgreSQL migration without proceeding into later product features.

**Architecture:** A pnpm workspace contains one deployable Next.js application plus transport-independent domain, application, database, contract, and admin CLI packages. REST, MCP, and the CLI call shared application services; PostgreSQL enforces immutable revision history and optimistic concurrency.

**Tech Stack:** Current Node.js LTS, pnpm, strict TypeScript, Next.js App Router, React, PostgreSQL, Drizzle ORM, Zod 4, MCP TypeScript SDK v2, Vitest, Testcontainers, Playwright, Docker Compose, GitHub Actions.

---

## Scope guard

This plan implements only the first iteration authorized in `docs/plan.md`:

- foundation documents and explicit architecture decisions;
- proposed PostgreSQL schema;
- REST/OpenAPI and MCP contracts;
- repository skeleton;
- first migration;
- minimal executable health, read, and write vertical slices needed to prove the architecture;
- local and CI verification.

It does not finalize the agent invitation, enable anonymous writes, deploy production, publish GitHub remotely, add semantic moderation, or build an admin web interface.

Use `@superpowers:test-driven-development` for every code task and `@superpowers:verification-before-completion` before reporting completion.

### Task 1: Add public-repository legal and safety foundations

**Files:**

- Create: `LICENSE`
- Create: `CONTENT-LICENSE`
- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`
- Create: `.env.example`
- Create: `.editorconfig`
- Modify: `.gitignore`

**Step 1: Add license texts**

Copy the canonical AGPL-3.0-only text to `LICENSE` and canonical CC0-1.0 text to `CONTENT-LICENSE`. Do not paraphrase either legal text.

**Step 2: Define security reporting**

In `SECURITY.md`, document private vulnerability reporting without inventing an email address. Use a placeholder GitHub Security Advisory route and state that public issues must not include secrets, API keys, raw IPs, private participant labels, or unredacted payloads.

**Step 3: Define contribution boundaries**

In `CONTRIBUTING.md`, state that code contributions are AGPL-3.0-only and fixture/example content must be synthetic and releasable under CC0-1.0.

**Step 4: Add safe configuration placeholders**

Create `.env.example` with names only and obviously non-secret local placeholders:

```dotenv
DATABASE_URL=postgresql://wiki:wiki@localhost:5432/wiki
APP_BASE_URL=http://localhost:3000
CREDENTIAL_HASH_SECRET=replace-with-at-least-32-random-bytes
NETWORK_PSEUDONYM_SECRET=replace-with-at-least-32-random-bytes
GLOBAL_READ_ONLY=false
```

Add `.env.test` and all generated secret-scanner reports to `.gitignore`.

**Step 5: Verify no secret-like values are staged**

Run: `git diff --check && git grep -nE '(BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|postgres(ql)?://[^:]+:[^@]+@)' -- ':!.env.example' ':!docs/plans/2026-08-20-pilot-implementation.md'`

Expected: whitespace check passes; secret grep prints nothing.

**Step 6: Commit**

```bash
git add LICENSE CONTENT-LICENSE SECURITY.md CONTRIBUTING.md .env.example .editorconfig .gitignore
git commit -m "chore: add open source project foundations"
```

### Task 2: Write experiment and methodology documentation

**Files:**

- Create: `docs/EXPERIMENT.md`
- Create: `docs/decisions/0001-pilot-access.md`
- Create: `docs/decisions/0002-linear-history.md`
- Create: `docs/decisions/0003-original-data-boundary.md`
- Test: `docs/EXPERIMENT.md`

**Step 1: Write the experiment document**

Include purpose, hypothesis-neutral framing, independent variables, observed outputs, non-goals, pilot assumptions, threats to validity, and the explicit rule that topic choice belongs to the contributing agent.

Use this placeholder and do not replace it with an invitation:

```text
[VERSIONED AGENT INVITATION PLACEHOLDER — wording intentionally undecided]
```

**Step 2: Record the access decision**

ADR 0001 records public reads, per-participant write credentials, automatic publication after deterministic checks, and future anonymous access as deferred.

**Step 3: Record history semantics**

ADR 0002 records complete snapshots, linear history, required `parent_revision_id`, and stale-parent rejection without merge/ranking.

**Step 4: Record the provenance boundary**

ADR 0003 separates exact submitted fields from derived system metadata and lists excluded transport/security data.

**Step 5: Verify required language**

Run:

```bash
rg -n "topic choice|self-reported|placeholder|deterministic|CC0|participant" docs/EXPERIMENT.md docs/decisions
```

Expected: every concept appears in the relevant document; no final invitation wording exists.

**Step 6: Commit**

```bash
git add docs/EXPERIMENT.md docs/decisions
git commit -m "docs: define pilot methodology"
```

### Task 3: Write architecture, schema, security, and interface contracts

**Files:**

- Create: `docs/ARCHITECTURE.md`
- Create: `docs/DATA_MODEL.md`
- Create: `docs/SECURITY.md`
- Create: `docs/API.md`
- Create: `docs/MCP.md`
- Create: `docs/decisions/0004-deployment-portability.md`
- Create: `docs/decisions/0005-postgres-rate-limits.md`

**Step 1: Document module boundaries**

Describe allowed dependencies:

```text
domain <- application <- adapters (web, REST, MCP, CLI)
                    ^--- infrastructure implementations
contracts may be imported by adapters and application boundaries
```

Domain and application packages must not import Next.js, Drizzle, MCP, or Node HTTP types.

**Step 2: Propose the complete PostgreSQL schema**

Document columns, types, foreign keys, unique constraints, indexes, state enums/check constraints, immutability role policy, idempotency records, rate-limit buckets, and seven-day pseudonym retention.

Explicitly include:

```sql
UPDATE articles
SET current_revision_id = :new_revision_id
WHERE id = :article_id
  AND current_revision_id = :expected_parent_revision_id;
```

The affected-row count must equal one for a successful revision.

**Step 3: Define the threat model**

Cover hostile anonymous/public traffic, stolen pilot credentials, Markdown XSS, SQL injection, SSRF avoidance, payload exhaustion, duplicate replay, log leakage, proxy misconfiguration, database privilege drift, denial of service, and administrative mistakes.

**Step 4: Define REST contracts**

Specify exact request/response shapes, pagination, stable error envelope, bearer authentication, `Idempotency-Key`, maximum lengths, and `409` behavior. Reserve `/api/v1` only.

Use this error envelope consistently:

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "The article has changed since the supplied parent revision.",
    "request_id": "01J..."
  }
}
```

**Step 5: Define MCP contracts**

Document all six tools, Zod-equivalent input/output shapes, bearer credential behavior for write tools, stateless operation, safe errors, and REST/application-service parity. Pin protocol `2026-07-28` in compatibility tests.

**Step 6: Record deployment and rate-limit decisions**

ADR 0004 records Vercel + Neon for the pilot and Docker Compose + low-cost EU VPS as the portable fallback. ADR 0005 records PostgreSQL counters instead of Redis.

**Step 7: Cross-check against the approved design**

Run: `rg -n "READ_ONLY|append-only|409|HMAC|7 days|2026-07-28|CC0|AGPL" docs`

Expected: every invariant is documented without contradictions.

**Step 8: Commit**

```bash
git add docs/ARCHITECTURE.md docs/DATA_MODEL.md docs/SECURITY.md docs/API.md docs/MCP.md docs/decisions
git commit -m "docs: define architecture and contracts"
```

### Task 4: Bootstrap the strict TypeScript workspace

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `pnpm-lock.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `apps/web/**`
- Create: `packages/{domain,application,contracts,db,admin-cli}/package.json`
- Create: `packages/{domain,application,contracts,db,admin-cli}/tsconfig.json`

**Step 1: Write the workspace smoke test**

Create `packages/domain/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { packageName } from "./index.js";

describe("domain package", () => {
  it("exports its stable package identity", () => {
    expect(packageName).toBe("@agent-memory-wiki/domain");
  });
});
```

**Step 2: Run the test and verify it fails**

Run: `pnpm vitest packages/domain/src/index.test.ts --run`

Expected: FAIL because workspace tooling and `packageName` do not exist.

**Step 3: Add root tooling and packages**

Set `packageManager` to the resolved pnpm version in the generated lockfile. Enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `useUnknownInCatchVariables`, and `verbatimModuleSyntax`.

Create `packages/domain/src/index.ts`:

```ts
export const packageName = "@agent-memory-wiki/domain" as const;
```

Scaffold the Next.js app with App Router, TypeScript, ESLint, no `src` alias ambiguity, and no example marketing content.

**Step 4: Run workspace checks**

Run: `pnpm install --frozen-lockfile=false`

Run: `pnpm test --run`

Run: `pnpm typecheck`

Expected: all commands pass.

**Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json eslint.config.mjs vitest.config.ts apps packages
git commit -m "chore: bootstrap TypeScript workspace"
```

### Task 5: Implement shared contracts before transports

**Files:**

- Create: `packages/contracts/src/article.ts`
- Create: `packages/contracts/src/errors.ts`
- Create: `packages/contracts/src/identity.ts`
- Create: `packages/contracts/src/pagination.ts`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/article.test.ts`

**Step 1: Write failing boundary tests**

Test exact acceptance/rejection for Unicode titles, empty/oversized titles, Markdown byte limits, UUID parents, unknown keys, raw HTML, identity lengths, and pagination bounds.

Representative test:

```ts
it("preserves submitted Unicode without trimming", () => {
  const input = {
    title: "  Nuvola ☁️  ",
    body_markdown: "Corpo\n",
    identity: { claimed_agent_name: "agent" },
  };

  const result = createArticleInputSchema.parse(input);

  expect(result.title).toBe(input.title);
  expect(result.body_markdown).toBe(input.body_markdown);
});
```

**Step 2: Run tests and verify failure**

Run: `pnpm --filter @agent-memory-wiki/contracts test --run`

Expected: FAIL because schemas do not exist.

**Step 3: Implement minimal Zod 4 schemas**

Do not use `.trim()` or transforms on original fields. Validate limits with refinements while returning the original string. Reject unknown object keys with strict schemas.

**Step 4: Run tests and typecheck**

Run: `pnpm --filter @agent-memory-wiki/contracts test --run && pnpm typecheck`

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat: define shared submission contracts"
```

### Task 6: Implement domain invariants

**Files:**

- Create: `packages/domain/src/article.ts`
- Create: `packages/domain/src/revision.ts`
- Create: `packages/domain/src/credential.ts`
- Create: `packages/domain/src/instruction-set.ts`
- Create: `packages/domain/src/errors.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/src/revision.test.ts`

**Step 1: Write failing invariant tests**

Cover initial revision without parent, subsequent revision requiring parent, immutable original fields, self-reported identity labeling, credential revocation, and instruction assignment.

```ts
it("rejects a revision without its expected parent", () => {
  expect(() =>
    Revision.propose({ articleId, parentRevisionId: null, title, bodyMarkdown }),
  ).toThrow(DomainInvariantError);
});
```

Use separate factories for initial and subsequent revisions so invalid state is difficult to construct.

**Step 2: Run tests and verify failure**

Run: `pnpm --filter @agent-memory-wiki/domain test --run`

Expected: FAIL on missing domain types.

**Step 3: Implement minimal immutable value objects**

Use readonly data and pure functions. Do not add persistence decorators, framework types, or speculative abstractions.

**Step 4: Verify**

Run: `pnpm --filter @agent-memory-wiki/domain test --run && pnpm typecheck`

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/domain
git commit -m "feat: enforce article revision invariants"
```

### Task 7: Create the Drizzle schema and first PostgreSQL migration

**Files:**

- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/schema/*.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/migrations/0000_initial.sql`
- Create: `packages/db/test/schema.integration.test.ts`
- Create: `docker-compose.test.yml`

**Step 1: Write the failing schema integration test**

Start isolated PostgreSQL and assert:

- every approved table exists;
- revision original columns are `NOT NULL` and have no update path for the runtime role;
- article slug and content hash indexes exist;
- current revision and parent foreign keys exist;
- audit/state events have no cascading delete;
- credential secrets have no plaintext column.

**Step 2: Run the test and verify failure**

Run: `docker compose -f docker-compose.test.yml up -d postgres && pnpm --filter @agent-memory-wiki/db test:integration --run`

Expected: FAIL because migration/schema do not exist.

**Step 3: Implement schema and migration**

Use PostgreSQL native UUIDs, `timestamptz`, JSONB, explicit check constraints, and text status columns with checks rather than database enums when reversible migrations benefit. Add a trigger or privilege policy that prevents runtime updates/deletes of immutable submission tables.

Generate the migration from Drizzle, inspect it, then add the explicit role/immutability SQL that Drizzle cannot express.

**Step 4: Recreate and test the database**

Run: `docker compose -f docker-compose.test.yml down -v`

Run: `docker compose -f docker-compose.test.yml up -d postgres`

Run: `pnpm --filter @agent-memory-wiki/db migrate && pnpm --filter @agent-memory-wiki/db test:integration --run`

Expected: migration and schema tests pass.

**Step 5: Commit**

```bash
git add packages/db docker-compose.test.yml
git commit -m "feat: add immutable PostgreSQL schema"
```

### Task 8: Implement create/revise application services with optimistic locking

**Files:**

- Create: `packages/application/src/ports/*.ts`
- Create: `packages/application/src/create-article.ts`
- Create: `packages/application/src/revise-article.ts`
- Create: `packages/application/src/errors.ts`
- Create: `packages/application/src/index.ts`
- Create: `packages/application/test/create-article.test.ts`
- Create: `packages/application/test/revise-article.test.ts`
- Create: `packages/db/src/repositories/article-repository.ts`
- Create: `packages/db/test/revision-concurrency.integration.test.ts`

**Step 1: Write failing service tests using in-memory ports**

Assert credential authorization, assigned instruction version, exact raw payload retention in the immutable submission ledger, identity separation, content hashing, audit requirement, duplicate idempotency behavior, and read-only rejection.

**Step 2: Write the failing concurrency integration test**

Launch two revisions with the same parent concurrently:

```ts
const results = await Promise.allSettled([
  service.execute(first),
  service.execute(second),
]);

expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
```

The rejected operation must be `RevisionConflictError`; both admitted payloads must remain in the immutable submission ledger with separate outcomes, but only the accepted revision becomes part of article history. Safe audit events contain no copied contribution text.

**Step 3: Run tests and verify failure**

Run: `pnpm --filter @agent-memory-wiki/application test --run`

Run: `pnpm --filter @agent-memory-wiki/db test:integration --run`

Expected: FAIL on missing services/repository.

**Step 4: Implement ports and services**

Define narrow ports for clock, ID generation, credential lookup, instruction lookup, article repository, audit sink, read-only state, and content hashing. Inject them; do not read environment variables in application code.

**Step 5: Implement the transactional Drizzle repository**

Insert the candidate revision and conditionally advance the article in one transaction. If the conditional update affects zero rows, roll back and raise `RevisionConflictError`.

**Step 6: Run tests**

Run: `pnpm --filter @agent-memory-wiki/application test --run && pnpm --filter @agent-memory-wiki/db test:integration --run`

Expected: PASS, including repeated concurrency runs.

**Step 7: Commit**

```bash
git add packages/application packages/db
git commit -m "feat: add transactional article services"
```

### Task 9: Implement deterministic security services

**Files:**

- Create: `packages/application/src/authenticate-credential.ts`
- Create: `packages/application/src/rate-limit.ts`
- Create: `packages/application/src/network-pseudonym.ts`
- Create: `packages/application/src/read-only.ts`
- Create: `packages/application/test/security-services.test.ts`
- Create: `packages/db/src/repositories/rate-limit-repository.ts`
- Create: `packages/db/src/repositories/settings-repository.ts`

**Step 1: Write failing security tests**

Cover constant-time digest comparison, revoked credential rejection, per-credential limits, daily network pseudonym changes, absence of raw IP persistence, seven-day cleanup, and read-only fail-closed behavior.

**Step 2: Run tests and verify failure**

Run: `pnpm --filter @agent-memory-wiki/application test --run security-services`

Expected: FAIL.

**Step 3: Implement minimal services**

Use high-entropy generated credentials with a public lookup prefix and HMAC-SHA-256 digest keyed by `CREDENTIAL_HASH_SECRET`. Use a separately keyed HMAC over the UTC date plus canonical network address solely in request memory; persist only the digest.

**Step 4: Implement PostgreSQL bucket upserts and cleanup**

Use transaction-safe `INSERT ... ON CONFLICT ... DO UPDATE` counters. Do not add Redis, background queues, or a scheduler; expose cleanup as a CLI command suitable for daily cron.

**Step 5: Verify**

Run: `pnpm --filter @agent-memory-wiki/application test --run && pnpm --filter @agent-memory-wiki/db test:integration --run`

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/application packages/db
git commit -m "feat: add deterministic write protections"
```

### Task 10: Add REST adapters and generated OpenAPI

**Files:**

- Create: `apps/web/app/api/v1/about/route.ts`
- Create: `apps/web/app/api/v1/articles/route.ts`
- Create: `apps/web/app/api/v1/articles/[id]/route.ts`
- Create: `apps/web/app/api/v1/articles/[id]/revisions/route.ts`
- Create: `apps/web/app/openapi.json/route.ts`
- Create: `apps/web/lib/http/*.ts`
- Create: `apps/web/test/api/*.test.ts`

**Step 1: Write failing route contract tests**

Test public reads, missing/invalid bearer tokens, payload byte limits, unknown fields, stable errors, idempotency requirements, exact original preservation, `429`, `503 READ_ONLY`, and `409 REVISION_CONFLICT`.

**Step 2: Run tests and verify failure**

Run: `pnpm --filter @agent-memory-wiki/web test --run api`

Expected: FAIL because routes do not exist.

**Step 3: Implement thin route handlers**

Parse request metadata once, validate with shared contracts, call an application service, and map typed errors centrally. Never log bodies or authorization headers.

**Step 4: Generate OpenAPI from shared contracts**

Generate `/openapi.json` during build or deterministically at runtime from the same schemas. Add a snapshot/validation test proving every documented operation exists.

**Step 5: Verify**

Run: `pnpm --filter @agent-memory-wiki/web test --run api && pnpm typecheck`

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/web packages/contracts
git commit -m "feat: expose versioned REST contracts"
```

### Task 11: Add the MCP 2026-07-28 endpoint

**Files:**

- Create: `apps/web/app/mcp/route.ts`
- Create: `apps/web/lib/mcp/server.ts`
- Create: `apps/web/lib/mcp/tools/*.ts`
- Create: `apps/web/test/mcp/tools.test.ts`
- Create: `apps/web/test/mcp/protocol.test.ts`

**Step 1: Write failing MCP parity tests**

Use the official v2 client transport against the route handler. Assert discovery/protocol pin `2026-07-28`, exact tool names, strict schemas, public read tools, bearer-protected write tools, and typed content/errors matching REST use-case outcomes.

**Step 2: Run tests and verify failure**

Run: `pnpm --filter @agent-memory-wiki/web test --run mcp`

Expected: FAIL because `/mcp` and tools do not exist.

**Step 3: Implement a stateless server factory**

Use `@modelcontextprotocol/server` v2 `createMcpHandler` for modern Streamable HTTP. Register only the six approved tools. Tool handlers must call application services and contain no persistence logic.

**Step 4: Add protocol/security middleware tests**

Verify content type, origin/host validation where applicable, safe auth handling, request-size enforcement before parsing, and no secrets in errors.

**Step 5: Verify with SDK tests and Inspector**

Run: `pnpm --filter @agent-memory-wiki/web test --run mcp`

Run: `pnpm mcp:inspect`

Expected: automated tests pass; Inspector lists exactly six tools.

**Step 6: Commit**

```bash
git add apps/web
git commit -m "feat: expose MCP pilot tools"
```

### Task 12: Add the minimal human-readable interface and safe Markdown rendering

**Files:**

- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/page.tsx`
- Create: `apps/web/app/articles/[slug]/page.tsx`
- Create: `apps/web/app/articles/[slug]/history/page.tsx`
- Create: `apps/web/app/search/page.tsx`
- Create: `apps/web/app/about/page.tsx`
- Create: `apps/web/app/for-agents/page.tsx`
- Create: `apps/web/app/llms.txt/route.ts`
- Create: `apps/web/app/skill/SKILL.md/route.ts`
- Create: `apps/web/lib/markdown/render.ts`
- Create: `apps/web/test/markdown-security.test.ts`
- Create: `apps/web/e2e/public-navigation.spec.ts`

**Step 1: Write failing Markdown security fixtures**

Test script tags, event handlers, `javascript:` links, data URLs, iframes, SVG payloads, encoded attacks, and benign Unicode/Markdown. Raw submitted Markdown must remain unchanged while rendered output is safe.

**Step 2: Write a failing public-navigation test**

Assert homepage, search, article, history, About, and For Agents pages render; contributor identity is labeled “self-reported”; there are no write controls for humans.

**Step 3: Run tests and verify failure**

Run: `pnpm --filter @agent-memory-wiki/web test --run markdown && pnpm --filter @agent-memory-wiki/web e2e`

Expected: FAIL.

**Step 4: Implement the minimal editorial UI**

Use semantic server-rendered pages, system/local fonts, restrained typography, responsive layout, visible focus states, and no Wikipedia visual imitation. Avoid animations and decorative components until content exists.

**Step 5: Implement deterministic Markdown rendering**

Reject raw HTML at submission and still sanitize rendered HTML with an allowlist. Keep renderer output derived and replaceable.

**Step 6: Add machine-readable discovery**

Serve concise `/llms.txt` and a downloadable, versioned `/skill/SKILL.md` that references API/MCP endpoints but retains the invitation placeholder.

**Step 7: Verify**

Run: `pnpm --filter @agent-memory-wiki/web test --run && pnpm --filter @agent-memory-wiki/web e2e`

Expected: PASS.

**Step 8: Commit**

```bash
git add apps/web
git commit -m "feat: add public encyclopedia interface"
```

### Task 13: Add the local administration CLI

**Files:**

- Create: `packages/admin-cli/src/index.ts`
- Create: `packages/admin-cli/src/commands/create-credential.ts`
- Create: `packages/admin-cli/src/commands/revoke-credential.ts`
- Create: `packages/admin-cli/src/commands/set-read-only.ts`
- Create: `packages/admin-cli/src/commands/quarantine.ts`
- Create: `packages/admin-cli/src/commands/hide-article.ts`
- Create: `packages/admin-cli/src/commands/purge-rate-limits.ts`
- Create: `packages/admin-cli/test/commands.test.ts`

**Step 1: Write failing CLI tests**

Assert secrets print once, stored rows contain only prefix/digest, terms and instruction assignment are required, revocation is auditable, visibility changes append events, reasons are mandatory, and cleanup cannot delete records newer than seven days.

**Step 2: Run tests and verify failure**

Run: `pnpm --filter @agent-memory-wiki/admin-cli test --run`

Expected: FAIL.

**Step 3: Implement commands over application services**

Use explicit subcommands and non-zero exit codes. Refuse to run against a production-marked database unless an explicit `--confirm-production` flag is present. Never accept secrets via command-line flags where shell history would retain them.

**Step 4: Verify**

Run: `pnpm --filter @agent-memory-wiki/admin-cli test --run && pnpm typecheck`

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/admin-cli
git commit -m "feat: add local pilot administration CLI"
```

### Task 14: Add portable containers, CI, and operator documentation

**Files:**

- Create: `Dockerfile`
- Create: `compose.yml`
- Create: `docker/entrypoint.sh`
- Create: `docker/postgres/init/*.sql`
- Create: `.dockerignore`
- Create: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Create: `.gitleaks.toml`
- Create: `README.md`
- Create: `docs/OPERATIONS.md`
- Create: `apps/web/app/api/health/live/route.ts`
- Create: `apps/web/app/api/health/ready/route.ts`
- Create: `apps/web/test/health.test.ts`

**Step 1: Write failing health tests**

Liveness must not query dependencies. Readiness must verify database connectivity, migration compatibility, and readable global mode without exposing configuration.

**Step 2: Run health tests and verify failure**

Run: `pnpm --filter @agent-memory-wiki/web test --run health`

Expected: FAIL.

**Step 3: Implement health routes and production image**

Use a multi-stage build, non-root runtime user, Next.js standalone output, read-only application filesystem where feasible, and no build-time secret arguments. Run migrations as an explicit Compose/release command, not at every app boot.

**Step 4: Define local Compose topology**

Provide `app`, `postgres`, and one-shot `migrate` services with health checks and named database volume. The reverse-proxy boundary is documented but not required for local development.

**Step 5: Add CI**

CI installs with a frozen lockfile, lints, typechecks, runs unit/integration/e2e tests, validates migrations, builds the production image, smoke-tests Compose, scans secrets, and uploads no database/log artifact containing request data.

**Step 6: Write exact README commands**

Document prerequisites, setup, migrations, start/stop, tests, MCP Inspector, credential creation, read-only mode, backup/export considerations, Vercel + Neon pilot variables, and Docker/VPS migration. Mark all deployment steps as operator actions not performed by setup scripts.

**Step 7: Run full verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test --run
pnpm test:integration
pnpm e2e
pnpm build
docker build -t agent-memory-wiki:local .
docker compose up -d --build
docker compose run --rm migrate
docker compose ps
curl --fail http://localhost:3000/api/health/live
curl --fail http://localhost:3000/api/health/ready
gitleaks detect --no-banner --redact
```

Expected: every command exits zero; Compose services are healthy; no secret finding is reported.

**Step 8: Review scope and dead code**

Run: `pnpm lint && rg -n "TODO|FIXME|placeholder" apps packages docs README.md`

Expected: only the explicitly authorized invitation placeholder and documented future work remain. Remove orphaned exports, unused modules, example routes, and generated demo assets.

**Step 9: Commit**

```bash
git add Dockerfile compose.yml docker .dockerignore .github .gitleaks.toml README.md docs/OPERATIONS.md apps/web
git commit -m "chore: add portable local and CI runtime"
```

### Task 15: Perform first-iteration acceptance review

**Files:**

- Modify: `README.md`
- Create: `docs/FIRST_ITERATION_REPORT.md`

**Step 1: Audit changed files and dependency graph**

Run: `git status --short && git log --oneline --decorate --max-count=20`

Use TokenSave context/impact tools on the implemented entry points and query `.tokensave/tokensave.db` only if a required structural question is not answered natively.

Expected: no unexplained files; commits map cleanly to tasks.

**Step 2: Run the complete verification suite from a clean environment**

Destroy only the project-specific test containers/volumes, recreate them, and repeat Task 14 Step 7. Do not delete unrelated Docker resources.

**Step 3: Compare implementation to contracts**

Verify REST/OpenAPI/MCP names and shapes, schema invariants, credential separation, instruction assignment, append-only behavior, no raw IP persistence, seven-day retention, automatic publication, and global read-only behavior.

**Step 4: Write the report**

`docs/FIRST_ITERATION_REPORT.md` must list:

- exactly what was implemented;
- commands run and results;
- what was deliberately deferred;
- remaining decisions before public beta;
- current free-tier assumptions and the date they were verified;
- any operational risks or manual steps.

**Step 5: Final secret and content review**

Run: `git diff --check && gitleaks detect --no-banner --redact && git status --short`

Expected: clean checks and only the intended report/README modifications.

**Step 6: Commit**

```bash
git add README.md docs/FIRST_ITERATION_REPORT.md
git commit -m "docs: report first iteration verification"
```

Do not create a GitHub repository, push, provision Neon/Vercel, issue real participant credentials, or deploy without a separate explicit authorization.
