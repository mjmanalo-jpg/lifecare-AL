#!/usr/bin/env bash
# =====================================================================
# Dump the LIVE database's DATA for cloning into a new Supabase project.
# Read-only against the live DB. Produces two files consumed by the
# load step in README.md (schema -> auth data -> public data -> RLS).
#
# Prereq: PostgreSQL client tools whose major version >= the live server
#   (Supabase is currently PG15/PG17). `pg_dump --version` must be >= server.
#   Windows: install "PostgreSQL" (client only) or `choco install postgresql`.
#
# Usage:
#   OLD_DIRECT_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" \
#     bash prisma/supabase-bootstrap/dump-live.sh
#   (use the DIRECT / 5432 connection, NOT the 6543 pooler)
# =====================================================================
set -euo pipefail

: "${OLD_DIRECT_URL:?Set OLD_DIRECT_URL to the live DIRECT (5432) connection string}"
OUT_DIR="$(dirname "$0")"

echo ">> Dumping public application data (excluding _prisma_migrations)..."
pg_dump "$OLD_DIRECT_URL" \
  --data-only --no-owner --no-privileges --disable-triggers \
  --schema=public \
  --exclude-table-data='public._prisma_migrations' \
  -f "$OUT_DIR/live_data_public.sql"

echo ">> Dumping Supabase Auth users + identities (so existing logins keep working)..."
pg_dump "$OLD_DIRECT_URL" \
  --data-only --no-owner --no-privileges \
  --table='auth.users' --table='auth.identities' \
  -f "$OUT_DIR/live_data_auth.sql"

echo ">> Done."
echo "   $OUT_DIR/live_data_auth.sql   (load 2nd, after 01_schema.sql)"
echo "   $OUT_DIR/live_data_public.sql (load 3rd, before 02_tenant_rls.sql)"
echo
echo "NOTE: these files contain resident PHI + auth hashes. Do NOT commit them."
