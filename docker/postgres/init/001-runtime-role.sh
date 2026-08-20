#!/bin/sh
set -eu

: "${WIKI_RUNTIME_PASSWORD:?WIKI_RUNTIME_PASSWORD is required}"
: "${WIKI_ADMIN_PASSWORD:?WIKI_ADMIN_PASSWORD is required}"

psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --set=runtime_password="$WIKI_RUNTIME_PASSWORD" \
  --set=admin_password="$WIKI_ADMIN_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE wiki_runtime LOGIN PASSWORD %L', :'runtime_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wiki_runtime')
\gexec
ALTER ROLE wiki_runtime LOGIN;
SELECT format('CREATE ROLE wiki_admin LOGIN PASSWORD %L', :'admin_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wiki_admin')
\gexec
ALTER ROLE wiki_admin LOGIN;
SQL
