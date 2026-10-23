-- duck:file rbac
-- name: ListRoles :many
SELECT * FROM roles ORDER BY builtin DESC, name;

-- name: GetRole :one
SELECT * FROM roles WHERE name = @name;

-- name: CreateRole :exec
INSERT INTO roles (name, description, permissions) VALUES (@name, @description, @permissions);

-- name: UpdateRole :exec
UPDATE roles SET description = @description, permissions = @permissions WHERE name = @name;

-- name: DeleteRole :execrows
DELETE FROM roles WHERE name = @name AND NOT builtin;

-- name: CountRoleUsers :one
SELECT count(*) FROM users WHERE role = @role;

-- name: ListGrants :many
SELECT * FROM grants
WHERE (CAST(@object_type AS TEXT) = '' OR object_type = @object_type)
  AND (CAST(@object_id AS TEXT) = '' OR object_id = @object_id)
ORDER BY created_at;

-- name: GetGrant :one
SELECT * FROM grants WHERE id = @id;

-- name: CreateGrant :exec
INSERT INTO grants (id, subject_type, subject_id, object_type, object_id, permission, created_at)
VALUES (@id, @subject_type, @subject_id, @object_type, @object_id, @permission, @now);

-- name: DeleteGrant :execrows
DELETE FROM grants WHERE id = @id;

-- name: DeleteObjectGrants :exec
DELETE FROM grants WHERE object_type = @object_type AND object_id = @object_id;

-- name: HasGrant :one
-- Whether the user, directly or through their role, holds perm on the object.
SELECT count(*) > 0 FROM grants
WHERE object_type = @object_type AND object_id = @object_id AND permission = @permission
  AND ((subject_type = 'user' AND subject_id = @user_id) OR (subject_type = 'role' AND subject_id = @role));

-- name: GrantedObjects :many
-- Ids of the objects of a type the user holds perm on, directly or through their role.
SELECT DISTINCT object_id FROM grants
WHERE object_type = @object_type AND permission = @permission
  AND ((subject_type = 'user' AND subject_id = @user_id) OR (subject_type = 'role' AND subject_id = @role));
