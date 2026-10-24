-- +goose Up
-- PostgreSQL schema: the same tables as migrations/sqlite, with native types.
-- sqlc reads the types from these files, so they are the source of truth for
-- package db; keep both engines in step.

-- julianday() exists so queries compare timestamps the same way on SQLite
-- (where they are text) and here.
-- +goose StatementBegin
CREATE FUNCTION julianday(t timestamptz) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT extract(epoch FROM t) / 86400.0 + 2440587.5 $$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE FUNCTION julianday(t text) RETURNS double precision
LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT extract(epoch FROM t::timestamptz) / 86400.0 + 2440587.5 $$;
-- +goose StatementEnd

-- notes: the example resource. Replace it with your own.
CREATE TABLE notes (
    id         TEXT PRIMARY KEY,
-- duck:if multitenant
--     tenant_id  TEXT NOT NULL DEFAULT '',
-- duck:end
    title      TEXT NOT NULL UNIQUE,
    body       TEXT NOT NULL DEFAULT '',
    pinned     BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
-- duck:if multitenant
-- ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY notes_tenant_isolation ON notes
--     USING (tenant_id = current_setting('app.current_tenant', true))
--     WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
-- CREATE INDEX notes_tenant_id ON notes (tenant_id);
-- duck:end

-- +goose Down
-- duck:if multitenant
-- DROP POLICY IF EXISTS notes_tenant_isolation ON notes;
-- duck:end
DROP TABLE notes;
DROP FUNCTION julianday(timestamptz), julianday(text);
