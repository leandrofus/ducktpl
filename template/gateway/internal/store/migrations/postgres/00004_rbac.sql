-- duck:file rbac
-- +goose Up
-- Object grants: a user or every holder of a role gets one permission on
-- one object, on top of what their role grants globally.
CREATE TABLE grants (
    id           TEXT PRIMARY KEY,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'role')),
    subject_id   TEXT NOT NULL,                 -- user id or role name
    object_type  TEXT NOT NULL,                 -- e.g. note
    object_id    TEXT NOT NULL,
    permission   TEXT NOT NULL,                 -- e.g. notes.write
    created_at   TIMESTAMPTZ NOT NULL,
    UNIQUE (subject_type, subject_id, object_type, object_id, permission)
);
CREATE INDEX grants_object ON grants (object_type, object_id);
CREATE INDEX grants_subject ON grants (subject_type, subject_id);

-- +goose Down
DROP TABLE grants;
