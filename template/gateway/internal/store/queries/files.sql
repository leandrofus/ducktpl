-- duck:file s3
-- name: ListNoteFiles :many
SELECT * FROM files WHERE note_id = @note_id ORDER BY created_at;

-- name: GetFile :one
SELECT * FROM files WHERE id = @id;

-- name: CreateFile :exec
INSERT INTO files (id, note_id, name, content_type, size, created_at)
VALUES (@id, @note_id, @name, @content_type, @size, @now);

-- name: DeleteFile :execrows
DELETE FROM files WHERE id = @id;
