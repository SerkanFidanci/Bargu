#!/usr/bin/env bash
# Tests for scripts/check-migrations.mjs on made-up migration folders:
#   bash scripts/check-migrations.test.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
pass=0
fail=0

# check <name> <expected exit> <expected text> <file name> <sql>
check() {
  local name="$1" expect_code="$2" expect_text="$3" file="$4" sql="$5"
  rm -rf "$work/m" && mkdir "$work/m"
  printf '%s\n' '-- old' 'DROP TABLE app.gone;' > "$work/m/0039_old.sql"
  printf '%s\n' "$sql" > "$work/m/$file"
  out="$(node "$here/check-migrations.mjs" "$work/m" 2>&1)"; code=$?
  if [ "$code" = "$expect_code" ] && printf '%s' "$out" | grep -qF -- "$expect_text"; then
    pass=$((pass + 1)); echo "ok   $name"
  else
    fail=$((fail + 1)); echo "FAIL $name: exit $code"; printf '%s\n' "$out"
  fi
}

check 'an older migration may drop (before the rule)' 0 'every new one only adds' \
  0040_add.sql 'ALTER TABLE app.circles ADD COLUMN note text;'
check 'adding a table and a column passes' 0 'only adds' 0040_add.sql \
  'CREATE TABLE app.x (id uuid PRIMARY KEY); ALTER TABLE app.x ADD COLUMN y int;'
check 'dropping a column fails' 1 '0040_drop.sql: drops something' 0040_drop.sql \
  'ALTER TABLE app.circles DROP COLUMN note;'
check 'renaming fails' 1 'renames something' 0040_rename.sql \
  'ALTER TABLE app.circles RENAME COLUMN a TO b;'
check 'narrowing a column fails' 1 'narrows a column' 0040_narrow.sql \
  'ALTER TABLE app.circles ALTER COLUMN note SET NOT NULL;'
check 'deleting rows fails' 1 'deletes data' 0040_delete.sql 'DELETE FROM app.circles WHERE true;'
check 'a delete inside a function body is code, not a change now' 0 'only adds' 0040_fn.sql \
  'CREATE FUNCTION app.sweep() RETURNS void LANGUAGE sql AS $$ DELETE FROM app.x $$;'
check 'a word in a comment or a string is not a change' 0 'only adds' 0040_words.sql \
  "-- we never drop table here
COMMENT ON TABLE app.circles IS 'rename later';"
check 'a contract line lets it through' 0 'only adds' 0040_contract.sql \
  '-- contract: completes 0040_add (note moved to notes); not read since app 0.10
ALTER TABLE app.circles DROP COLUMN note;'

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
