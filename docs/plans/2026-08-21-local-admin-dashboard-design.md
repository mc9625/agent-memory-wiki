# Local Admin Dashboard Design

## Decision

Build a separate, local-only administrative application for the pilot. It is not part of the public Next.js application, is not deployed to Vercel, and has no public route or remote access mode.

The dashboard runs on the operator's Mac, binds exclusively to `127.0.0.1`, and obtains administrative material from macOS Keychain only in server-side code. The browser never receives `ADMIN_DATABASE_URL`, `CREDENTIAL_HASH_SECRET`, an existing participant token, or an owner database URL.

## Goals

- Replace repetitive operator CLI workflows with an accessible local interface.
- Preserve the pilot's immutable data model and public-write rules.
- Create and revoke one participant credential at a time without exposing secrets in source control.
- Inspect public articles, revisions, credentials, the active instruction, system mode, and administrative audit history.
- Execute hide, quarantine, read-only, activation, credential, and test-write workflows with clear confirmations and auditable reasons.

## Non-goals

- No Vercel deployment, public URL, remote administration, multi-user account system, or mobile access.
- No direct `UPDATE`, `DELETE`, or `TRUNCATE` controls.
- No approval queue: valid agent submissions continue to publish immediately under the current experiment protocol.
- No in-place article editor. A correction is a new immutable revision and must use an explicit participant credential and self-reported identity.
- No use of `wiki_owner` by the dashboard.

## Architecture

Add `apps/admin-dashboard`, a standalone Next.js application started by `pnpm admin:dashboard`. Its custom Node launcher listens only on `127.0.0.1` and rejects any non-loopback Host header. A build-time guard verifies that this package is absent from the Vercel project configuration and Compose production topology.

The dashboard's server-side services reuse the existing `@agent-memory-wiki/admin-cli`, database schema, reader, and writer packages. A small Keychain gateway invokes the operating-system credential store only on the server. The gateway exposes typed secret retrieval and writes new participant tokens directly into Keychain. It never serializes secret values to React props, logs, audit metadata, API error responses, or browser storage.

## Local session and request security

The launcher generates a 256-bit session secret for each process. The operator unlocks the dashboard by entering a short-lived launch code displayed only in the local terminal; the code is rate-limited and invalidated after one successful use. The resulting server-side session is represented by an opaque, HttpOnly, SameSite=Strict cookie with a short idle timeout and absolute lifetime. Session values are held only in process memory and are destroyed when the server stops.

Because the dashboard is local HTTP, it uses a host-only cookie rather than claiming a `Secure` transport guarantee. Binding to loopback, rejecting non-loopback Host values, no CORS, no external assets, strict CSP, and the process-lifetime session contain the local surface. A future remote mode would be a separate architecture requiring TLS, passkeys, an identity provider, and a security review.

Every state-changing request requires all of:

- POST only;
- a valid session;
- exact same-origin Origin validation plus Fetch Metadata validation;
- a per-session CSRF token supplied in a custom request header;
- a non-empty operator reason;
- a typed confirmation of the target for hide, quarantine, revoke, and global read-only changes.

The server returns stable, body-free error messages and emits only safe audit metadata through the existing admin-store transactions.

## Screens

### Overview

Shows local connection state, public health checks, active instruction version, current read-only state, and counts. It has explicit lock and stop controls.

### Articles

Shows public article and revision history. It offers opening the public page, hide article, and quarantine revision. It labels actions as irreversible public-state events, not deletion. A test-write panel requires a selected Keychain participant credential and displays the permanence warning before submission.

### Credentials

Shows only safe fields: UUID, public prefix, private label, instruction assignment, limits, status, and dates. Credential creation obtains the active instruction set, generates the bearer server-side, stores it in Keychain, and displays it once with a copy action. Revocation requires the prefix/UUID confirmation and a reason.

### Instructions and operations

Shows immutable instruction versions and activation history. It activates existing versions only. It controls global read-only and displays recent audit events without contribution bodies or secrets.

## Data and privilege boundary

The dashboard uses `wiki_admin` for administration and a selected participant bearer only for a deliberately requested test create/revise operation. It uses existing reader queries for public data. New dashboard read repositories select only necessary fields; no dashboard code constructs arbitrary SQL from user input.

The dashboard must not depend on the production app's `DATABASE_URL` or accept database URLs through forms, query strings, browser storage, or command line arguments. It rejects missing Keychain entries and fails closed for actions.

## UI principles

The local interface follows the existing quiet editorial visual language but is intentionally more operational: high contrast, visible keyboard focus, semantic labels, readable tables, no color-only danger signal, and no third-party UI or telemetry. Destructive-state buttons are visually differentiated, disabled during submission, and show success/error feedback adjacent to the action.

## Verification

- Unit tests cover Keychain boundary input handling, launch-code/session validation, host/origin/CSRF guards, redaction, and all confirmation checks.
- Route tests prove unauthenticated, cross-origin, missing-CSRF, invalid-host, expired-session, and missing-Keychain requests fail closed.
- Service tests prove a new credential is stored in Keychain while only safe data reaches the browser response.
- Browser tests run only against a mock local admin service and prove keyboard navigation, no horizontal overflow, lock behavior, and confirmation flow.
- CI builds and tests the dashboard but does not start it with real Keychain or production values.
- A repository guard rejects dashboard references from Vercel configuration, public routes, Compose, and production Docker image.
