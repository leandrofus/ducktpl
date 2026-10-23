-- duck:file s3
-- +goose Up
-- Files attached to notes. The bytes live in the object store (S3, or a
-- directory) under the key files/<id>; this is the index.
CREATE TABLE files (
    id           TEXT PRIMARY KEY,
    note_id      TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size         BIGINT NOT NULL,
    created_at   DATETIME NOT NULL
);
CREATE INDEX files_note ON files (note_id);

-- +goose Down
DROP TABLE files;
