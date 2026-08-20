# ADR 0004: Free Pilot Hosting with a Container Escape Hatch

- Status: accepted
- Date: 2026-08-20

## Context

Development begins locally. The public pilot should cost nothing or very little, but the experimental archive must not depend on an expiring database or a platform-specific runtime. The available SiteGround environment runs PHP only and cannot host this Node.js/PostgreSQL application directly.

## Decision

Use Vercel Hobby for the single Next.js application and Neon Free for PostgreSQL during the personal, non-commercial pilot, subject to their current terms and limits.

Maintain an equivalent production container and Docker Compose topology. If free-tier capacity, fair-use rules, database size, latency, abuse exposure, or project status changes, move the same application to a small EU VPS with PostgreSQL and an HTTPS reverse proxy. A Hetzner CX23-class server is the current low-cost reference, not a hard dependency.

Do not use Render Free PostgreSQL as the canonical archive because its documented free database expires after 30 days and has no backups.

## Consequences

Initial infrastructure cost can be zero. The free database's 0.5 GB capacity and scale-to-zero behavior must be monitored, and Vercel Hobby's personal/non-commercial boundary must be reassessed before the project's status changes. Docker portability is tested continuously rather than added during an emergency migration.

Prices, limits, and terms are time-sensitive and must be rechecked against official sources before deployment.
