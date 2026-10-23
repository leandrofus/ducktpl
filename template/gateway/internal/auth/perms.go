// duck:file auth
package auth

import (
	"context"
	"slices"
	// duck:if rbac
	"strings"
	// duck:end
)

// Permissions are verb-free names, object.action. A role holds a list of
// them; PermAll grants everything.
const (
	PermAll         = "*"
	PermNotesRead   = "notes.read"
	PermNotesWrite  = "notes.write"
	PermUsersManage = "users.manage"
	// duck:if audit
	PermAuditRead = "audit.read"
	// duck:end
	// duck:if rbac
	PermRolesManage = "roles.manage"
	// duck:end
	// ducktpl:perms
)

// openapi:schema Permission
// type: object
// required: [name, description]
// properties:
//   name: { type: string }
//   description: { type: string }

type Permission struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// Catalog lists every permission, for role editors.
var Catalog = []Permission{
	{PermNotesRead, "Read every note"},
	{PermNotesWrite, "Create, edit and delete every note"},
	{PermUsersManage, "Manage users"},
	// duck:if audit
	{PermAuditRead, "Read and verify the audit log"},
	// duck:end
	// duck:if rbac
	{PermRolesManage, "Manage roles and their permissions"},
	// duck:end
	// ducktpl:catalog
}

// BuiltinRoles are the roles a fresh database has. Without the rbac module
// they are the only ones; with it they are rows admins can edit (except
// admin, which always holds everything).
var BuiltinRoles = map[string][]string{
	"admin": {PermAll},
	"user": {
		PermNotesRead, PermNotesWrite,
		// ducktpl:user-perms
	},
}

// Has reports whether perms grant p.
func Has(perms []string, p string) bool {
	return slices.Contains(perms, PermAll) || slices.Contains(perms, p)
}

// Known reports whether p is in the catalog.
func Known(p string) bool {
	return p == PermAll || slices.ContainsFunc(Catalog, func(c Permission) bool { return c.Name == p })
}

// Permissions resolves a role's global permissions.
func (s *Service) Permissions(ctx context.Context, role string) ([]string, error) {
	// duck:if rbac
	r, err := s.Store.Q.GetRole(ctx, role)
	if err != nil {
		return nil, err
	}
	return strings.Fields(r.Permissions), nil
	// duck:else
	// return BuiltinRoles[role], nil
	// duck:end
}
