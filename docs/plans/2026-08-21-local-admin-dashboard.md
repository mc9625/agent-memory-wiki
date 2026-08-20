# Local Admin Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local-only, security-hardened dashboard that lets the pilot operator run supported administrative and test-write workflows without remembering CLI commands.

**Architecture:** Add an independently started `apps/admin-dashboard` Next.js application with a custom loopback-only launcher. It holds Keychain and `wiki_admin` access exclusively on the server; the browser receives opaque sessions and safe view models only. Existing immutable data rules remain intact: the UI creates revisions, hides articles, quarantines revisions, changes settings, activates instructions, and manages credentials through typed services rather than arbitrary SQL.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Playwright, Drizzle/PostgreSQL, existing `@agent-memory-wiki/admin-cli`, macOS `security` executable, Node crypto and child_process.

---

### Task 1: Scaffold the local-only dashboard package and launch boundary

**Files:**
- Create: `apps/admin-dashboard/package.json`
- Create: `apps/admin-dashboard/tsconfig.json`
- Create: `apps/admin-dashboard/next.config.mjs`
- Create: `apps/admin-dashboard/server.ts`
- Create: `apps/admin-dashboard/app/layout.tsx`
- Create: `apps/admin-dashboard/app/page.tsx`
- Create: `apps/admin-dashboard/app/globals.css`
- Create: `apps/admin-dashboard/test/launcher.test.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Step 1: Write the failing launcher tests**

```ts
it("binds only to IPv4 loopback", () => {
  expect(localDashboardListenOptions()).toEqual({ host: "127.0.0.1", port: 4317 });
});

it("rejects non-loopback host headers", () => {
  expect(isAllowedHost("127.0.0.1:4317")).toBe(true);
  expect(isAllowedHost("localhost:4317")).toBe(false);
  expect(isAllowedHost("example.com")).toBe(false);
});
```

**Step 2: Run the test to verify it fails**

Run: `pnpm --filter @agent-memory-wiki/admin-dashboard test --run test/launcher.test.ts`

Expected: FAIL because the package and launcher do not exist.

**Step 3: Add the package, custom server, and non-public script**

- Use Next's programmatic server API in `server.ts`.
- Call `server.listen(4317, "127.0.0.1")`; do not make host configurable.
- Export pure host and listen-option helpers for tests.
- Add `pnpm admin:dashboard`, but do not add the package to Vercel build scripts, Dockerfile, or Compose.
- Add an explicit CI build/test invocation for the package.

**Step 4: Run focused tests and package build**

Run: `pnpm --filter @agent-memory-wiki/admin-dashboard test --run test/launcher.test.ts && pnpm --filter @agent-memory-wiki/admin-dashboard build`

Expected: PASS.

**Step 5: Commit**

```bash
git add pnpm-workspace.yaml package.json apps/admin-dashboard .github/workflows/ci.yml
git commit -m "feat: scaffold local admin dashboard"
```

### Task 2: Add launch-code sessions, host checks, CSRF, and security headers

**Files:**
- Create: `apps/admin-dashboard/lib/security/session.ts`
- Create: `apps/admin-dashboard/lib/security/request-guard.ts`
- Create: `apps/admin-dashboard/lib/security/headers.ts`
- Create: `apps/admin-dashboard/app/api/session/unlock/route.ts`
- Create: `apps/admin-dashboard/app/api/session/lock/route.ts`
- Create: `apps/admin-dashboard/proxy.ts`
- Create: `apps/admin-dashboard/test/security/session.test.ts`
- Create: `apps/admin-dashboard/test/security/request-guard.test.ts`
- Create: `apps/admin-dashboard/test/security/headers.test.ts`

**Step 1: Write failing security tests**

```ts
it("consumes a launch code exactly once", () => {
  const gate = createLaunchGate("correct-code");
  expect(gate.unlock("correct-code")).toMatchObject({ csrfToken: expect.any(String) });
  expect(gate.unlock("correct-code")).toBeNull();
});

it("rejects wrong origin, fetch-site, and CSRF token for mutations", () => {
  expect(validateMutationRequest(request({ origin: "http://evil.test" }))).toEqual({ ok: false });
});

it("returns a restrictive CSP with a per-response nonce", () => {
  expect(buildSecurityHeaders("nonce")["content-security-policy"]).toContain("'nonce-nonce'");
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agent-memory-wiki/admin-dashboard test --run test/security`

Expected: FAIL because modules do not exist.

**Step 3: Implement minimal security primitives**

- Generate launch code, session ID, CSRF token, and CSP nonce with `crypto.randomBytes`.
- Keep launch code and session data only in process memory with 10-minute idle and 60-minute absolute expiry.
- Set `HttpOnly`, `SameSite=Strict`, path `/`, non-persistent cookie; do not use localStorage.
- Validate exact origin `http://127.0.0.1:4317`, `Sec-Fetch-Site` values, Host, method, and `x-amw-csrf` for every mutation.
- Make `proxy.ts` add no-store and restrictive CSP/security headers but keep authorization enforcement in route handlers.
- Return generic safe errors and do not log credential material.

**Step 4: Run focused tests**

Run: `pnpm --filter @agent-memory-wiki/admin-dashboard test --run test/security`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/admin-dashboard
git commit -m "feat: secure local dashboard sessions"
```

### Task 3: Add Keychain boundary and safe operator read model

**Files:**
- Create: `apps/admin-dashboard/lib/keychain.ts`
- Create: `apps/admin-dashboard/lib/admin-service.ts`
- Create: `apps/admin-dashboard/lib/admin-views.ts`
- Create: `apps/admin-dashboard/test/keychain.test.ts`
- Create: `apps/admin-dashboard/test/admin-service.test.ts`
- Modify: `packages/admin-cli/src/ports.ts`
- Modify: `packages/admin-cli/src/postgres-admin-store.ts`
- Modify: `packages/admin-cli/test/commands.test.ts`

**Step 1: Write failing tests**

```ts
it("uses execFile arguments instead of a shell for Keychain reads", async () => {
  await expect(keychain.get("credential-hash-secret")).resolves.toBe("secret");
  expect(execFile).toHaveBeenCalledWith("security", ["find-generic-password", ...]);
});

it("does not include credential digests or bearer tokens in the credential view", async () => {
  expect(await service.listCredentials()).toEqual([expect.not.objectContaining({ secretDigest: expect.anything() })]);
});
```

**Step 2: Run tests to verify failure**

Run: `pnpm --filter @agent-memory-wiki/admin-dashboard test --run test/keychain.test.ts test/admin-service.test.ts`

Expected: FAIL because the gateway and safe views do not exist.

**Step 3: Implement server-only dependencies**

- Wrap `security` with `execFile`, fixed service name, allowlisted account names, bounded output, and no shell.
- Retrieve `neon-admin-database-url` and `credential-hash-secret` lazily; fail closed when unavailable.
- Extend `AdminStore` with select-only typed methods for articles/revisions, credentials, instructions/activations, settings, and safe audit events.
- Return safe view objects only: no URL, digest, bearer token, raw submissions, or article body in audit views.
- Create credentials through existing `createCredential`; store its bearer in Keychain before returning a one-time in-memory display value.

**Step 4: Run focused tests**

Run: `pnpm --filter @agent-memory-wiki/admin-dashboard test --run test/keychain.test.ts test/admin-service.test.ts && pnpm --filter @agent-memory-wiki/admin-cli test --run`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/admin-dashboard packages/admin-cli
git commit -m "feat: add secure dashboard administration service"
```

### Task 4: Add guarded administrative API routes

**Files:**
- Create: `apps/admin-dashboard/app/api/admin/overview/route.ts`
- Create: `apps/admin-dashboard/app/api/admin/articles/route.ts`
- Create: `apps/admin-dashboard/app/api/admin/credentials/route.ts`
- Create: `apps/admin-dashboard/app/api/admin/credentials/[id]/revoke/route.ts`
- Create: `apps/admin-dashboard/app/api/admin/articles/[id]/hide/route.ts`
- Create: `apps/admin-dashboard/app/api/admin/revisions/[id]/quarantine/route.ts`
- Create: `apps/admin-dashboard/app/api/admin/read-only/route.ts`
- Create: `apps/admin-dashboard/app/api/admin/instructions/[id]/activate/route.ts`
- Create: `apps/admin-dashboard/test/api/admin-routes.test.ts`

**Step 1: Write failing route tests**

```ts
it("fails closed without a session", async () => {
  expect((await POST(request())).status).toBe(401);
});

it("requires a reason and typed target confirmation before revocation", async () => {
  expect((await POST(request({ reason: "", confirmation: "wrong" }))).status).toBe(422);
});

it("calls hide with audited reason only after all guards pass", async () => {
  await POST(authenticatedRequest({ reason: "policy", confirmation: "article-id" }));
  expect(service.hideArticle).toHaveBeenCalledWith("article-id", "policy");
});
```

**Step 2: Run the test to verify failure**

Run: `pnpm --filter @agent-memory-wiki/admin-dashboard test --run test/api/admin-routes.test.ts`

Expected: FAIL because routes do not exist.

**Step 3: Implement routes using one guard wrapper**

- Call host/session/origin/CSRF/method validation in a shared wrapper; do not rely on `proxy.ts` alone.
- Validate all JSON with strict Zod schemas and bounded strings.
- Require confirmation target plus reason for high-impact actions.
- Use POST for mutations and GET for safe reads only.
- Map all internal errors to a stable body-free error envelope.

**Step 4: Run route tests**

Run: `pnpm --filter @agent-memory-wiki/admin-dashboard test --run test/api/admin-routes.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/admin-dashboard
git commit -m "feat: add guarded local admin routes"
```

### Task 5: Build the accessible local dashboard interface

**Files:**
- Create: `apps/admin-dashboard/app/dashboard/page.tsx`
- Create: `apps/admin-dashboard/app/components/unlock-form.tsx`
- Create: `apps/admin-dashboard/app/components/overview.tsx`
- Create: `apps/admin-dashboard/app/components/article-table.tsx`
- Create: `apps/admin-dashboard/app/components/credential-table.tsx`
- Create: `apps/admin-dashboard/app/components/confirmation-dialog.tsx`
- Create: `apps/admin-dashboard/app/components/operation-form.tsx`
- Modify: `apps/admin-dashboard/app/page.tsx`
- Modify: `apps/admin-dashboard/app/globals.css`
- Create: `apps/admin-dashboard/test/ui/dashboard.test.ts`

**Step 1: Write failing UI tests**

```ts
it("labels immutable operations as new revision, hide, and quarantine", () => {
  expect(renderDashboard()).toContain("New revision");
  expect(renderDashboard()).not.toContain("Delete article");
});

it("disables a high-impact action until reason and confirmation match", async () => {
  expect(screen.getByRole("button", { name: "Revoke credential" })).toBeDisabled();
});
```

**Step 2: Run tests to verify failure**

Run: `pnpm --filter @agent-memory-wiki/admin-dashboard test --run test/ui/dashboard.test.ts`

Expected: FAIL because components do not exist.

**Step 3: Implement the interface**

- Use semantic headings, tables, labels, keyboard-accessible dialogs, focus management, and visible focus rings.
- Display safe data only and provide explicit permanence warnings for test create/revise actions.
- Keep all controls at least 44px high and provide clear disabled/loading/error states.
- Do not load images, fonts, scripts, analytics, or styles from third parties.
- Use the existing editorial visual vocabulary with a concise high-contrast operational layout.

**Step 4: Run UI tests and build**

Run: `pnpm --filter @agent-memory-wiki/admin-dashboard test --run test/ui/dashboard.test.ts && pnpm --filter @agent-memory-wiki/admin-dashboard build`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/admin-dashboard
git commit -m "feat: add local admin dashboard interface"
```

### Task 6: Add deliberately selected test write and revision workflows

**Files:**
- Create: `apps/admin-dashboard/lib/participant-write-service.ts`
- Create: `apps/admin-dashboard/app/api/admin/test-write/route.ts`
- Create: `apps/admin-dashboard/app/api/admin/test-revision/route.ts`
- Create: `apps/admin-dashboard/test/participant-write-service.test.ts`
- Modify: `apps/admin-dashboard/app/components/operation-form.tsx`
- Modify: `apps/admin-dashboard/test/api/admin-routes.test.ts`

**Step 1: Write failing tests**

```ts
it("requires an explicit permanence acknowledgement before a test write", async () => {
  await expect(service.create(input({ acknowledgedPermanent: false }))).rejects.toThrow("acknowledgement");
});

it("reads the selected participant token only from Keychain and does not return it", async () => {
  const result = await service.create(input());
  expect(result).not.toHaveProperty("bearerToken");
});
```

**Step 2: Run tests to verify failure**

Run: `pnpm --filter @agent-memory-wiki/admin-dashboard test --run test/participant-write-service.test.ts`

Expected: FAIL because the service does not exist.

**Step 3: Implement minimal participant-write service**

- Select only a Keychain account already recorded by dashboard credential creation.
- Read the bearer server-side, send it to the public API with a generated idempotency key, and redact it from all output.
- Require full create/revision payload, self-reported identity, current parent revision ID for revise, and permanence acknowledgement.
- Display only the created article/revision IDs, slug, and safe status to the UI.

**Step 4: Run focused tests**

Run: `pnpm --filter @agent-memory-wiki/admin-dashboard test --run test/participant-write-service.test.ts test/api/admin-routes.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/admin-dashboard
git commit -m "feat: add guarded dashboard test writes"
```

### Task 7: Add deployment-separation guard, documentation, and browser coverage

**Files:**
- Create: `apps/admin-dashboard/e2e/local-dashboard.spec.ts`
- Create: `apps/admin-dashboard/test/deployment-separation.test.ts`
- Modify: `README.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `.github/workflows/ci.yml`

**Step 1: Write failing separation and browser tests**

```ts
it("does not reference the dashboard from Vercel, Docker, or Compose production configuration", () => {
  expect(productionFiles).not.toMatch(/admin-dashboard/);
});

test("requires unlock and a typed confirmation before showing a mutation control", async ({ page }) => {
  await page.goto("http://127.0.0.1:4317");
  await expect(page.getByText("Local operator access")).toBeVisible();
});
```

**Step 2: Run tests to verify failure**

Run: `pnpm --filter @agent-memory-wiki/admin-dashboard test --run test/deployment-separation.test.ts`

Expected: FAIL because the guard does not exist.

**Step 3: Implement test harness and operator docs**

- Add a local-only start instruction; explicitly state it is never deployed to Vercel.
- Add local dependency, Keychain prerequisite, unlock, lock, recovery, and incident guidance.
- CI runs unit tests/build for the dashboard and a fake-Keychain browser test; CI never reads macOS Keychain or production variables.
- Add the separation guard to stop accidental Vercel/Docker inclusion.

**Step 4: Run all verification**

Run: `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build && pnpm --filter @agent-memory-wiki/admin-dashboard exec playwright test`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/admin-dashboard README.md docs/OPERATIONS.md .github/workflows/ci.yml
git commit -m "docs: add local dashboard operator workflow"
```

### Task 8: Review and publish safely

**Files:**
- Review: all dashboard changes against `docs/plans/2026-08-21-local-admin-dashboard-design.md`

**Step 1: Run secret scan and inspect tracked changes**

Run: `git diff origin/main...HEAD --check && gitleaks git --redact`

Expected: no whitespace errors and no secrets.

**Step 2: Request security-focused code review**

Review authorization, session lifetime, host/origin/CSRF guards, secret handling, SQL boundaries, and deployment separation.

**Step 3: Address all Critical and Important findings**

Run the focused regression test for each correction before continuing.

**Step 4: Run full verification again**

Run: `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build`

Expected: PASS.

**Step 5: Create a reviewed pull request**

```bash
git push -u origin feat/local-admin-dashboard
gh pr create --base main --head feat/local-admin-dashboard --title "feat: add secure local admin dashboard"
```
