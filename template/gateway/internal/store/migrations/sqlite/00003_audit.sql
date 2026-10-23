-- duck:file audit
-- +goose Up
-- Tamper-evident log: each row's hash is HMAC(key, prev_hash || canonical
-- row), so editing, deleting or reordering rows breaks the chain.
CREATE TABLE audit_events (
    seq            INTEGER PRIMARY KEY,
    actor_id       TEXT NOT NULL DEFAULT '',
    actor_username TEXT NOT NULL DEFAULT '',
    actor_ip       TEXT NOT NULL DEFAULT '',
    action         TEXT NOT NULL,
    target_type    TEXT NOT NULL DEFAULT '',
    target_id      TEXT NOT NULL DEFAULT '',
    details        TEXT NOT NULL DEFAULT '{}',
    prev_hash      TEXT NOT NULL,
    hash           TEXT NOT NULL UNIQUE,
    created_at     DATETIME NOT NULL
);
CREATE INDEX audit_events_target ON audit_events (target_type, target_id);

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

-- +goose Down
DROP TABLE audit_events;
