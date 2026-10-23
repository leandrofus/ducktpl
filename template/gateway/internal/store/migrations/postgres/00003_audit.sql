-- duck:file audit
-- +goose Up
-- Tamper-evident log: each row's hash is HMAC(key, prev_hash || canonical
-- row), so editing, deleting or reordering rows breaks the chain.
CREATE TABLE audit_events (
    seq            BIGINT PRIMARY KEY,
    actor_id       TEXT NOT NULL DEFAULT '',
    actor_username TEXT NOT NULL DEFAULT '',
    actor_ip       TEXT NOT NULL DEFAULT '',
    action         TEXT NOT NULL,
    target_type    TEXT NOT NULL DEFAULT '',
    target_id      TEXT NOT NULL DEFAULT '',
    details        TEXT NOT NULL DEFAULT '{}',
    prev_hash      TEXT NOT NULL,
    hash           TEXT NOT NULL UNIQUE,
    created_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX audit_events_target ON audit_events (target_type, target_id);

-- +goose StatementBegin
CREATE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
-- +goose StatementEnd
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION audit_append_only();

-- +goose Down
DROP TABLE audit_events;
DROP FUNCTION audit_append_only();
