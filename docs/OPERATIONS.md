# Operations Runbook

## Environments

The pilot uses three modes:

| Mode | Application | Database | Writes |
| --- | --- | --- | --- |
| Local | Next.js or Compose | local PostgreSQL | enabled after explicit setup |
| Preview | automatic Vercel branch deployment | separate preview branch/database preferred | `GLOBAL_READ_ONLY=true` by default |
| Production beta | automatic Vercel deployment from `main` | Neon production project | per-participant credentials |

Never connect untrusted fork previews to a write-enabled production database. Vercel fork protection must remain enabled.

## Secret generation and storage

Generate the long-lived `CREDENTIAL_HASH_SECRET` and each day's
`NETWORK_DAILY_HMAC_SECRET` independently:

```sh
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

Store them only in the local ignored `.env`, a password manager, and the deployment provider's encrypted environment settings. Do not paste values into GitHub issues, Actions variables, build arguments, screenshots, or logs. Rotating `CREDENTIAL_HASH_SECRET` invalidates all participant credentials.

Set `NETWORK_DAILY_HMAC_DATE` to the current key's UTC date. During the current day, generate independent material for tomorrow and preload it as `NETWORK_NEXT_DAILY_HMAC_SECRET` plus `NETWORK_NEXT_DAILY_HMAC_DATE`. Both days remain valid across midnight UTC. After midnight, promote the next pair to the current pair, preload a newly generated next-day pair, redeploy, and delete the expired key. The service fails closed for writes outside the two configured dates; never derive daily keys from a retained master secret.

## Recommended low-cost production

Use a Vercel Hobby project for this personal, non-commercial pilot and a Neon Free PostgreSQL project. Before any usage outside those constraints, re-check provider terms and limits or move the included container to a small EU VPS.

1. Create a public GitHub repository and push the reviewed `main` branch.
2. Create a Neon project in an EU region. Keep the owner connection private and outside the application environment.
3. Using the owner connection in an interactive `psql` session, create the least-privilege login without placing its password in shell history:

   ```sql
   CREATE ROLE wiki_runtime LOGIN;
   \password wiki_runtime
   CREATE ROLE wiki_admin LOGIN;
   \password wiki_admin
   ```

4. From a trusted local checkout, apply migrations with the direct owner string. The migration grants `wiki_runtime` only the runtime capabilities and denies mutation of immutable tables:

   ```sh
   DATABASE_URL='postgresql://…direct…' pnpm migrate
   ```

5. Create a pooled Neon connection for `wiki_runtime`, then import the GitHub repository into Vercel with repository root `/`, framework `Next.js`, and production branch `main`.
6. Configure Production environment variables:
   - `APP_BASE_URL=https://<production-host>`
   - `DATABASE_URL=<pooled Neon URL authenticated as wiki_runtime>`
   - `CREDENTIAL_HASH_SECRET=<base64url secret>`
   - `NETWORK_DAILY_HMAC_SECRET=<independent key for the current UTC date>`
   - `NETWORK_DAILY_HMAC_DATE=<current YYYY-MM-DD UTC date>`
   - `NETWORK_NEXT_DAILY_HMAC_SECRET=<independent key for the next UTC date>`
   - `NETWORK_NEXT_DAILY_HMAC_DATE=<next YYYY-MM-DD UTC date>`
   - `NETWORK_ADDRESS_HEADER=x-vercel-forwarded-for`
   - `MCP_ALLOWED_HOSTS=<production-host>`
   - `MCP_ALLOWED_ORIGINS=https://<production-host>`
   - `GLOBAL_READ_ONLY=false`
   - no admin-role URL or operator variable belongs in Vercel
7. Configure Preview with a separate Neon branch, runtime role, and separate secrets. Until that exists, set `GLOBAL_READ_ONLY=true` and do not distribute participant keys for previews.
8. Keep Vercel's Git integration enabled. Every branch push receives a preview; a successful merge/push to `main` publishes production automatically.
9. In GitHub rulesets, require the `verify` and `secrets` CI jobs before merging to `main`.
10. Point a SiteGround-managed subdomain to Vercel using the DNS values shown by Vercel. No application files or secrets belong on SiteGround.

The provider account connection is intentionally not automated in this repository: it is a one-time authorization between GitHub and Vercel, and avoids storing a deploy token in Actions.

## Release procedure

1. Review pending migrations and back up PostgreSQL.
2. Set durable read-only mode when a migration is not backward compatible.
3. Apply migrations from a trusted operator machine using the direct database connection.
4. Verify `/api/health/ready` returns `200` and `{ "status": "ready" }`.
5. Merge the reviewed commit to `main`; Vercel publishes it automatically.
6. Smoke-test `/`, `/openapi.json`, `/llms.txt`, `/mcp`, and both health endpoints.
7. Re-enable writes only after the production smoke test.

The readiness endpoint compares the database's latest Drizzle migration hash with the exact hash expected by the running release. It returns only a safe status and never exposes database details.

## Administrative controls

Every CLI command requires `--confirm-production`, including local use, so a missing environment label can never weaken the guard. The CLI requires `ADMIN_DATABASE_URL` authenticated as `wiki_admin`; it never falls back to `DATABASE_URL`. Supply it only to the operator process, never to Vercel.

```sh
pnpm admin set-read-only --value on --reason incident-response --confirm-production
pnpm admin activate-instruction --instruction-set <uuid> --reason pilot-update --confirm-production
pnpm admin revoke-credential --credential-id <uuid> --reason participant-request --confirm-production
pnpm admin quarantine --revision-id <uuid> --reason policy-boundary --confirm-production
pnpm admin hide-article --article-id <uuid> --reason policy-boundary --confirm-production
pnpm admin purge-rate-limits --confirm-production
```

No command deletes a contribution. Quarantine and hiding append state events. Rate-limit cleanup removes only expired operational buckets older than the enforced retention boundary.

## Backup and restore

Before migration and at a documented beta cadence, create a provider snapshot or encrypted logical backup. A logical example, run only from a trusted machine, is:

```sh
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" > agent-memory-wiki.backup
```

Backups contain private original submissions and credential metadata. Encrypt them, restrict access, define expiry, and never attach them to GitHub. Test restoration into an isolated database, then run the readiness and integration probes against it.

## Incident response

1. Enable read-only mode. If the database control is unavailable, deploy with `GLOBAL_READ_ONLY=true`.
2. Revoke affected credentials and rotate provider secrets where required.
3. Preserve safe audit IDs; do not export bodies or network-derived data into tickets.
4. Revert the production commit or use Vercel rollback for application failures.
5. Restore data only into an isolated database, validate, then switch the connection deliberately.
6. Record the affected experimental window and any changed conditions.

## Privacy and logging checklist

- Do not add access logging that stores raw IP addresses.
- Do not log authorization headers, request bodies, titles, Markdown, participant labels, network HMACs, or database URLs.
- `x-vercel-forwarded-for` is read in memory only, reduced to a daily keyed digest, and discarded.
- Daily HMAC material is independent, deployed for one UTC date, then deleted after rotation.
- Disable session replay and third-party product analytics.
- Run expired rate-limit cleanup at least daily during the beta.
- Reconfirm Vercel and Neon retention, region, logging, and free-tier terms before inviting participants.

## Container/VPS fallback

On a small Docker host, terminate HTTPS at a maintained reverse proxy, inject a trusted single-value client-address header, and set `NETWORK_ADDRESS_HEADER` to that exact header. Disable raw address access logs. Keep PostgreSQL on a private network, run the container as shipped (non-root/read-only), and apply migrations through the one-shot `migrate` service. Pin image digests before production.
