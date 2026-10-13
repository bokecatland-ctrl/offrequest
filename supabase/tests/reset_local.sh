#!/usr/bin/env bash
# ローカル DB を作り直してマイグレーションを流す
#   使い方: PGHOST=... PGPORT=... supabase/tests/reset_local.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${PGDATABASE:-offrequest}
psql -U postgres -d postgres -qc "drop database if exists $DB" -c "create database $DB"
psql -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 -f supabase/tests/local_bootstrap.sql
for f in supabase/migrations/*.sql; do
  psql -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f"
done
echo "reset: $DB"
