-- Preserve a manually-created production index only when it has the intended shape.
DO $migration$
BEGIN
  IF to_regclass('public."User_googleId_key"') IS NULL THEN
    CREATE UNIQUE INDEX "User_googleId_key"
      ON public."User" USING btree ("googleId");
  ELSIF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_relation
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_relation.relnamespace
    JOIN pg_catalog.pg_index AS index_definition
      ON index_definition.indexrelid = index_relation.oid
    JOIN pg_catalog.pg_class AS table_relation
      ON table_relation.oid = index_definition.indrelid
    JOIN pg_catalog.pg_namespace AS table_namespace
      ON table_namespace.oid = table_relation.relnamespace
    JOIN pg_catalog.pg_am AS access_method
      ON access_method.oid = index_relation.relam
    JOIN pg_catalog.pg_opclass AS key_operator_class
      ON key_operator_class.oid = index_definition.indclass[0]
    JOIN pg_catalog.pg_attribute AS key_column
      ON key_column.attrelid = table_relation.oid
      AND key_column.attnum = index_definition.indkey[0]
    WHERE index_namespace.nspname = 'public'
      AND index_relation.relname = 'User_googleId_key'
      AND index_relation.relkind = 'i'
      AND table_namespace.nspname = 'public'
      AND table_relation.relname = 'User'
      AND access_method.amname = 'btree'
      AND key_operator_class.opcdefault
      AND index_definition.indisunique
      AND NOT index_definition.indisexclusion
      AND index_definition.indisvalid
      AND index_definition.indisready
      AND index_definition.indislive
      AND index_definition.indnkeyatts = 1
      AND index_definition.indnatts = 1
      AND index_definition.indoption[0] = 0
      AND index_definition.indcollation[0] = key_column.attcollation
      AND index_definition.indpred IS NULL
      AND index_definition.indexprs IS NULL
      AND key_column.attname = 'googleId'
      AND NOT key_column.attisdropped
  ) THEN
    RAISE EXCEPTION
      'Index public."User_googleId_key" exists but is not the expected unique btree index on public."User"("googleId")';
  END IF;
END
$migration$;

-- Canonical account lookups use LOWER(TRIM(email)); validate any existing
-- same-name index before accepting it as the migration-owned index.
DO $migration$
BEGIN
  IF to_regclass('public."User_canonical_email_idx"') IS NULL THEN
    CREATE INDEX "User_canonical_email_idx"
      ON public."User" USING btree (LOWER(TRIM("email")));
  ELSIF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_relation
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_relation.relnamespace
    JOIN pg_catalog.pg_index AS index_definition
      ON index_definition.indexrelid = index_relation.oid
    JOIN pg_catalog.pg_class AS table_relation
      ON table_relation.oid = index_definition.indrelid
    JOIN pg_catalog.pg_namespace AS table_namespace
      ON table_namespace.oid = table_relation.relnamespace
    JOIN pg_catalog.pg_am AS access_method
      ON access_method.oid = index_relation.relam
    JOIN pg_catalog.pg_opclass AS key_operator_class
      ON key_operator_class.oid = index_definition.indclass[0]
    JOIN pg_catalog.pg_attribute AS email_column
      ON email_column.attrelid = table_relation.oid
      AND email_column.attname = 'email'
      AND NOT email_column.attisdropped
    WHERE index_namespace.nspname = 'public'
      AND index_relation.relname = 'User_canonical_email_idx'
      AND index_relation.relkind = 'i'
      AND table_namespace.nspname = 'public'
      AND table_relation.relname = 'User'
      AND access_method.amname = 'btree'
      AND key_operator_class.opcdefault
      AND NOT index_definition.indisunique
      AND NOT index_definition.indisexclusion
      AND index_definition.indisvalid
      AND index_definition.indisready
      AND index_definition.indislive
      AND index_definition.indnkeyatts = 1
      AND index_definition.indnatts = 1
      AND index_definition.indkey[0] = 0
      AND index_definition.indoption[0] = 0
      AND index_definition.indcollation[0] = email_column.attcollation
      AND index_definition.indpred IS NULL
      AND pg_catalog.pg_get_expr(
        index_definition.indexprs,
        index_definition.indrelid
      ) = 'lower(btrim(email))'
  ) THEN
    RAISE EXCEPTION
      'Index public."User_canonical_email_idx" exists but is not the expected non-unique btree expression index on LOWER(TRIM(public."User"."email"))';
  END IF;
END
$migration$;
