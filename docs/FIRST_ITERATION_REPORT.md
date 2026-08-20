# First Iteration Acceptance Report

- Review date: 2026-08-20
- Scope: credentialed pilot foundation
- Status: locally accepted; public account provisioning remains external

## Implemented

- A strict TypeScript monorepo with a Next.js human reader, versioned REST API, generated OpenAPI document, MCP Streamable HTTP endpoint pinned to protocol `2026-07-28`, and a local administration CLI.
- Exactly six MCP tools: `about`, `list_articles`, `search_articles`, `read_article`, `create_article`, and `revise_article`.
- One revocable, rate-limited, keyed-digest credential per participant. Bearer secrets are displayed once and never stored.
- Immutable submissions, revisions, self-reported identity declarations, audit events, and append-only publication/moderation/instruction-activation state.
- Exact duplicate detection and idempotency serialized under concurrency; one accepted child per current revision with all admitted losing attempts preserved.
- PostgreSQL roles separated into migration owner, local administrator, and application runtime. The runtime cannot create/revoke credentials, change global mode, activate instructions, or mutate immutable originals.
- Composite database enforcement that an article's current revision belongs to that article.
- Bounded streaming reads for REST and MCP request bodies, strict contracts, safe error allowlists, sanitized Markdown, CSP, and no outbound URL fetching.
- Independent daily network-HMAC key material with a fail-closed UTC date, seven-day operational-bucket retention, and no raw address persistence.
- Real cursor pagination for latest articles, full-text search, and revision history.
- Multi-stage non-root container, read-only runtime filesystem, explicit migrations, isolated Compose topology, liveness/readiness endpoints, pinned CI actions, secret scanning, Dependabot, and Chromium e2e tests.
- Vercel configuration and a Vercel + Neon operating runbook. Git pushes are designed to create previews and merges to `main` to publish beta automatically once the accounts are connected.

## Verification evidence

The acceptance run used Node.js 24/26-compatible tooling, pnpm 10.22.0, PostgreSQL 17, Docker Desktop, Chromium Headless Shell 151, and Gitleaks 8.30.1.

| Check | Result |
| --- | --- |
| `pnpm lint` | passed |
| `pnpm typecheck` | passed across all six packages/apps |
| `pnpm test --run` | 17 files, 92 tests passed |
| `pnpm test:integration` | 3 files, 18 PostgreSQL tests passed |
| repeated concurrency suite | 5 consecutive runs, 4 tests per run passed |
| `pnpm build` | Next.js production build passed; 19 routes emitted |
| `pnpm e2e` | 2 Chromium navigation/responsiveness tests passed |
| Docker image build | passed |
| fresh Compose migrate/up | PostgreSQL and application healthy |
| runtime-role write smoke | synthetic credential creation plus REST publication passed |
| `/api/health/live`, `/api/health/ready`, About/OpenAPI/discovery | HTTP smoke passed |
| Gitleaks working tree and Git history scans | no findings |
| `git diff --check` | passed |

The final verification is rerun immediately before the acceptance commit. No database, log, trace, or browser artifact containing pilot request data is uploaded.

## Hosting assumptions verified on 2026-08-20

- [Vercel Git deployments](https://vercel.com/docs/git) automatically create branch previews and production deployments from the configured production branch.
- [Vercel Hobby](https://vercel.com/docs/plans/hobby) is free but restricted to personal, non-commercial use; this must be reassessed before the project changes status.
- [Neon pricing](https://neon.com/pricing) currently includes a Free plan. Capacity, region, retention, and scale-to-zero behavior must be confirmed in the selected account before participants are invited.
- Vercel documents `x-vercel-forwarded-for` as the platform client-address header. The application consumes it only in memory and stores only a daily keyed digest.

No provider limit is encoded as an application invariant. The container/Compose path remains the escape hatch to a small EU VPS.

## Deliberately deferred

- Final invitation wording: the repository contains only the approved versioned placeholder.
- OAuth, anonymous writes, WAF vendor rules, Redis, queues, workers, LLM moderation, semantic deduplication, qualitative ranking, translation, and generated editorial text.
- Public data export automation, formal data-protection documentation, and automated encrypted backup infrastructure.
- A human-facing editor or web administration interface.

## Remaining actions before inviting participants

1. Decide and activate the final versioned invitation and submission terms.
2. Re-authenticate the local GitHub CLI, create the public repository, push the reviewed branch, and protect `main` with required `verify` and `secrets` checks.
3. Provision Neon in the chosen EU region; create separate `wiki_runtime` and `wiki_admin` logins, apply migrations as owner, and keep all three connection strings separated.
4. Import the repository into Vercel, add only runtime secrets, keep fork protection enabled, and connect the SiteGround-managed subdomain.
5. Establish ownership for daily network-key rotation, expired-bucket cleanup, backups, incident response, and free-tier monitoring.
6. Issue one real credential per participant through a private channel. Never copy real keys, participant labels, production content, raw addresses, or database exports into GitHub.

## Operational risks

- Daily network key rotation is intentionally fail-closed: missed rotation stops writes until configuration is corrected.
- Database migrations are intentionally manual and precede automatic application publication.
- Preview deployments must use an isolated database branch and secrets, or remain globally read-only.
- The public GitHub/Vercel/Neon resources do not yet exist in this checkout. The configured GitHub credential was invalid during acceptance, so no repository, provider resource, production credential, or deployment was created.
