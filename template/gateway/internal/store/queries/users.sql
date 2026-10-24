-- duck:file auth
-- name: CreateUser :exec
INSERT INTO users (id, username, display_name, password_hash, role, created_at, updated_at)
VALUES (@id, @username, @display_name, @password_hash, @role, @now, @now);

-- name: GetUser :one
SELECT * FROM users WHERE id = @id;

-- name: GetUserByUsername :one
SELECT * FROM users WHERE username = @username;

-- name: ListUsers :many
SELECT * FROM users ORDER BY username LIMIT CAST(@lim_count AS BIGINT) OFFSET CAST(@lim_offset AS BIGINT);

-- name: CountUsers :one
SELECT count(*) FROM users;

-- name: CountActiveAdmins :one
SELECT count(*) FROM users WHERE role = 'admin' AND NOT disabled;

-- name: UpdateUser :exec
UPDATE users SET display_name = @display_name, role = @role, disabled = @disabled, updated_at = @now WHERE id = @id;

-- name: SetUserPassword :exec
UPDATE users SET password_hash = @password_hash, updated_at = @now WHERE id = @id;

-- name: TouchUserLogin :exec
UPDATE users SET last_login_at = @now WHERE id = @id;

-- name: DeleteUser :execrows
DELETE FROM users WHERE id = @id;

-- name: CreateWebSession :exec
INSERT INTO web_sessions (id_hash, user_id, ip, user_agent, created_at, last_seen_at, expires_at)
VALUES (@id_hash, @user_id, @ip, @user_agent, @now, @now, @expires_at);

-- name: GetWebSession :one
SELECT * FROM web_sessions WHERE id_hash = @id_hash;

-- name: TouchWebSession :exec
UPDATE web_sessions SET last_seen_at = @now WHERE id_hash = @id_hash;

-- name: DeleteWebSession :exec
DELETE FROM web_sessions WHERE id_hash = @id_hash;

-- name: DeleteUserWebSessions :exec
DELETE FROM web_sessions WHERE user_id = @user_id;

-- name: DeleteExpiredWebSessions :execrows
DELETE FROM web_sessions
WHERE julianday(expires_at) <= julianday(CAST(@now AS TEXT))
   OR julianday(last_seen_at) <= julianday(CAST(@idle_before AS TEXT));

-- duck:if pam
-- name: CreatePAMUser :exec
INSERT INTO users (id, username, display_name, source, role, created_at, updated_at)
VALUES (@id, @username, @username, 'pam', @role, @now, @now);

-- name: SyncPAMUser :exec
-- What the system's groups say about a PAM user, on every login.
UPDATE users SET role = @role, updated_at = @now WHERE id = @id AND source = 'pam';
-- duck:end
