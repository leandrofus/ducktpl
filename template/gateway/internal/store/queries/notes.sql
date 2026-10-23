-- Queries run unchanged on SQLite and PostgreSQL: @name parameters (sqlc
-- turns them into $N, which SQLite accepts) and julianday() for time
-- comparisons.

-- name: ListNotes :many
SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC;

-- name: GetNote :one
SELECT * FROM notes WHERE id = @id;

-- name: CreateNote :exec
INSERT INTO notes (id, title, body, pinned, created_at, updated_at)
VALUES (@id, @title, @body, @pinned, @now, @now);

-- name: UpdateNote :exec
UPDATE notes SET title = @title, body = @body, pinned = @pinned, updated_at = @now WHERE id = @id;

-- name: DeleteNote :execrows
DELETE FROM notes WHERE id = @id;
