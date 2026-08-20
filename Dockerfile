FROM node:26-alpine AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/admin-cli/package.json packages/admin-cli/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS tools
COPY . .

FROM dependencies AS builder
COPY . .
RUN pnpm build \
  && source_path="$(readlink -f node_modules/.pnpm/node_modules/@swc/helpers)" \
  && target_path="$(readlink -f apps/web/.next/standalone/node_modules/.pnpm/node_modules/@swc/helpers)" \
  && cp -R "$source_path"/. "$target_path"/

FROM node:26-alpine AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /workspace/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --chown=nextjs:nodejs docker/entrypoint.sh /usr/local/bin/agent-memory-wiki
USER nextjs
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/agent-memory-wiki"]
