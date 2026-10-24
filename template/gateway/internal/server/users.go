// duck:file auth
package server

import (
	"context"
	"net/http"
	"regexp"

	"github.com/duckowner/duckapp/gateway/internal/auth"
	"github.com/duckowner/duckapp/gateway/internal/store"
	"github.com/duckowner/duckapp/gateway/internal/store/db"
)

var usernameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)

func (s *Server) checkRole(r *http.Request, role string) error {
	// duck:if rbac
	if _, err := s.Store.Q.GetRole(r.Context(), role); err != nil {
		return badRequest("unknown role %q", role)
	}
	// duck:else
	// if _, ok := auth.BuiltinRoles[role]; !ok {
	// 	return badRequest("unknown role %q", role)
	// }
	// duck:end
	return nil
}

// openapi:schema CreateUserRequest
// type: object
// required: [username, password]
// additionalProperties: false
// properties:
//   username: { type: string, pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' }
//   password: { type: string, format: password, minLength: 10 }
//   display_name: { type: string }
//   role: { type: string }

type createUserRequest struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
}

// openapi:schema UpdateUserRequest
// type: object
// additionalProperties: false
// properties:
//   display_name: { type: string }
//   role: { type: string }
//   disabled: { type: boolean }

type updateUserRequest struct {
	DisplayName opt[string] `json:"display_name"`
	Role        opt[string] `json:"role"`
	Disabled    opt[bool]   `json:"disabled"`
}

// openapi:schema PasswordRequest
// type: object
// required: [password]
// additionalProperties: false
// properties:
//   password: { type: string, format: password, minLength: 10 }

type passwordRequest struct {
	Password string `json:"password"`
}

// openapi:schema PaginatedUsers
// type: object
// required: [items, total, page, per_page]
// properties:
//   items: { type: array, items: { $ref: '#/components/schemas/User' } }
//   total: { type: integer }
//   page: { type: integer }
//   per_page: { type: integer }

type paginatedUsers struct {
	Items   []userDTO `json:"items"`
	Total   int       `json:"total"`
	Page    int       `json:"page"`
	PerPage int       `json:"per_page"`
}

// openapi:operation
// summary: List users
// parameters:
//   - { name: page, in: query, schema: { type: integer, default: 1 } }
//   - { name: per_page, in: query, schema: { type: integer, default: 50 } }
// responses:
//   '200': { description: All users, schema: PaginatedUsers }

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request, p principal) error {
	page, perPage, offset := pageParams(r)
	total, err := s.Store.Q.CountUsers(r.Context())
	if err != nil {
		return err
	}
	us, err := s.Store.Q.ListUsers(r.Context(), db.ListUsersParams{LimCount: int64(perPage), LimOffset: int64(offset)})
	if err != nil {
		return err
	}
	out := make([]userDTO, 0, len(us))
	for _, u := range us {
		out = append(out, toUser(u))
	}
	return ok(w, paginatedUsers{Items: out, Total: int(total), Page: page, PerPage: perPage})
}

// openapi:operation
// summary: Create a user
// requestBody: { schema: CreateUserRequest }
// responses:
//   '201': { description: Created, schema: User }
//   '409': Error

func (s *Server) createUser(w http.ResponseWriter, r *http.Request, p principal) error {
	return handleCreated(w, r, func(req createUserRequest) (userDTO, error) {
		if !usernameRe.MatchString(req.Username) {
			return userDTO{}, badRequest("username: lowercase letters, digits, dot, dash and underscore")
		}
		if req.Role == "" {
			req.Role = "user"
		}
		if err := s.checkRole(r, req.Role); err != nil {
			return userDTO{}, err
		}
		if err := auth.CheckPasswordPolicy(req.Password); err != nil {
			return userDTO{}, badRequest("%s", err.Error())
		}
		hash, err := auth.HashPassword(req.Password)
		if err != nil {
			return userDTO{}, err
		}
		id := store.NewID()
		err = s.Store.Q.CreateUser(r.Context(), db.CreateUserParams{
			ID: id, Username: req.Username, DisplayName: req.DisplayName, PasswordHash: hash, Role: req.Role, Now: store.Now(),
		})
		if err != nil {
			return userDTO{}, fromStore(err, "user")
		}
		u, err := s.Store.Q.GetUser(r.Context(), id)
		if err != nil {
			return userDTO{}, err
		}
		s.record(r, p, "user.create", "user", id, map[string]any{"username": u.Username, "role": u.Role})
		return toUser(u), nil
	})
}

// keepAnAdmin refuses changes that would leave no active admin.
func keepAnAdmin(ctx context.Context, q *db.Queries, before db.User, stillAdmin bool) error {
	if before.Role != "admin" || before.Disabled || stillAdmin {
		return nil
	}
	n, err := q.CountActiveAdmins(ctx)
	if err != nil {
		return err
	}
	if n <= 1 {
		return conflict("this is the last active admin")
	}
	return nil
}

// openapi:operation
// summary: Update a user
// requestBody: { schema: UpdateUserRequest }
// responses:
//   '200': { description: Updated, schema: User }
//   '409': Error

func (s *Server) updateUser(w http.ResponseWriter, r *http.Request, p principal) error {
	return handleAction(w, r, func(req updateUserRequest) (userDTO, error) {
		id := r.PathValue("id")
		var out db.User
		err := s.Store.Tx(r.Context(), func(q *db.Queries) error {
			u, err := q.GetUser(r.Context(), id)
			if err != nil {
				return fromStore(err, "user")
			}
			before := u
			if req.DisplayName.Set {
				u.DisplayName = req.DisplayName.V
			}
			if req.Role.Set {
				if err := s.checkRole(r, req.Role.V); err != nil {
					return err
				}
				u.Role = req.Role.V
			}
			if req.Disabled.Set {
				u.Disabled = req.Disabled.V
			}
			if err := keepAnAdmin(r.Context(), q, before, u.Role == "admin" && !u.Disabled); err != nil {
				return err
			}
			if err := q.UpdateUser(r.Context(), db.UpdateUserParams{ID: id, DisplayName: u.DisplayName, Role: u.Role, Disabled: u.Disabled, Now: store.Now()}); err != nil {
				return err
			}
			if u.Disabled {
				q.DeleteUserWebSessions(r.Context(), id)
			}
			out, err = q.GetUser(r.Context(), id)
			return err
		})
		if err != nil {
			return userDTO{}, err
		}
		s.record(r, p, "user.update", "user", id, map[string]any{"role": out.Role, "disabled": out.Disabled})
		return toUser(out), nil
	})
}

// openapi:operation
// summary: Delete a user
// responses:
//   '204': { description: Deleted }
//   '409': Error

func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request, p principal) error {
	id := r.PathValue("id")
	if id == p.User.ID {
		return conflict("you cannot delete yourself")
	}
	return handleCommand(w, func() error {
		err := s.Store.Tx(r.Context(), func(q *db.Queries) error {
			u, err := q.GetUser(r.Context(), id)
			if err != nil {
				return fromStore(err, "user")
			}
			if err := keepAnAdmin(r.Context(), q, u, false); err != nil {
				return err
			}
			_, err = q.DeleteUser(r.Context(), id)
			return err
		})
		if err == nil {
			s.record(r, p, "user.delete", "user", id, nil)
		}
		return err
	})
}

// openapi:operation
// summary: Reset a user's password
// description: Ends every session of the user.
// requestBody: { schema: PasswordRequest }
// responses:
//   '204': { description: Changed }

func (s *Server) resetPassword(w http.ResponseWriter, r *http.Request, p principal) error {
	var req passwordRequest
	if err := decode(r, &req); err != nil {
		return err
	}
	id := r.PathValue("id")
	u, err := s.Store.Q.GetUser(r.Context(), id)
	if err != nil {
		return fromStore(err, "user")
	}
	if u.Source != "local" {
		return conflict("the password of a %s account is managed by the host", u.Source)
	}
	if err := s.setPassword(r, id, req.Password); err != nil {
		return err
	}
	s.Store.Q.DeleteUserWebSessions(r.Context(), id)
	s.record(r, p, "user.password_reset", "user", id, nil)
	return noContent(w)
}
