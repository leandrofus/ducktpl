-- duck:file audit
-- name: LatestAuditEvent :one
SELECT * FROM audit_events ORDER BY seq DESC LIMIT 1;

-- name: InsertAuditEvent :exec
INSERT INTO audit_events (seq, actor_id, actor_username, actor_ip, action, target_type, target_id, details, prev_hash, hash, created_at)
VALUES (@seq, @actor_id, @actor_username, @actor_ip, @action, @target_type, @target_id, @details, @prev_hash, @hash, @created_at);

-- name: CountAuditEvents :one
SELECT count(*) FROM audit_events;

-- name: ListAuditEventsPage :many
SELECT * FROM audit_events ORDER BY seq DESC LIMIT CAST(@lim_count AS BIGINT) OFFSET CAST(@lim_offset AS BIGINT);

-- name: ListAuditEvents :many
-- Newest first, keyset-paginated by seq (before = 0 for the first page).
SELECT * FROM audit_events
WHERE (CAST(@before AS BIGINT) = 0 OR seq < @before)
ORDER BY seq DESC
LIMIT CAST(@lim AS BIGINT);

-- name: AuditEventsAfter :many
-- Oldest first, for verifying the chain in pages.
SELECT * FROM audit_events WHERE seq > @after ORDER BY seq LIMIT CAST(@lim AS BIGINT);
