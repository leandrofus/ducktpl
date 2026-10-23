// duck:file auth
package server

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/duckowner/duckapp/gateway/internal/auth"
	"github.com/duckowner/duckapp/gateway/internal/store"
	"github.com/duckowner/duckapp/gateway/internal/store/db"
)

// openapi:schema User
// type: object
// required: [id, username, display_name, source, role, disabled, created_at, updated_at, last_login_at]
// properties:
//   id: { type: string, format: uuid }
//   username: { type: string }
//   display_name: { type: string }
//   source: { type: string, enum: [local, pam], description: 'pam: a system account; its password and role come from the host.' }
//   role: { type: string, description: 'Role name: admin and user always exist.' }
//   disabled: { type: boolean }
//   created_at: { type: string, format: date-time }
//   updated_at: { type: string, format: date-time }
//   last_login_at: { type: [string, 'null'], format: date-time }

type userDTO struct {
	ID          string     `json:"id"`
	Username    string     `json:"username"`
	DisplayName string     `json:"display_name"`
	Source      string     `json:"source"`
	Role        string     `json:"role"`
	Disabled    bool       `json:"disabled"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	LastLoginAt *time.Time `json:"last_login_at"`
}

func toUser(u db.User) userDTO {
	d := userDTO{ID: u.ID, Username: u.Username, DisplayName: u.DisplayName, Source: u.Source, Role: u.Role, Disabled: u.Disabled,
		CreatedAt: u.CreatedAt.UTC(), UpdatedAt: u.UpdatedAt.UTC()}
	if u.LastLoginAt.Valid {
		t := u.LastLoginAt.Time.UTC()
		d.LastLoginAt = &t
	}
	return d
}

// openapi:schema LoginRequest
// type: object
// required: [username, password]
// additionalProperties: false
// properties:
//   username: { type: string }
//   password: { type: string, format: password }

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// openapi:operation
// summary: Sign in
// description: Sets the duckapp_session cookie (HttpOnly, SameSite=Strict).
// tags: [auth]
// requestBody: { schema: LoginRequest }
// responses:
//   '200': { description: Signed in, schema: User }
//   '401': Error
//   '429': Error

func (s *Server) login(w http.ResponseWriter, r *http.Request, p principal) error {
	var req loginRequest
	if err := decode(r, &req); err != nil {
		return err
	}
	key := strings.ToLower(req.Username) + "|" + p.IP
	if !s.limiter.Allowed(key) {
		return &apiError{http.StatusTooManyRequests, "too_many_attempts", "too many failed attempts; try again later"}
	}
	u, err := s.Auth.Authenticate(r.Context(), req.Username, req.Password)
	// duck:if pam
	if errors.Is(err, auth.ErrInvalid) && s.PAM != nil && (u.ID == "" || u.Source == "pam") {
		u, err = s.PAM.Login(r.Context(), req.Username, req.Password, p.IP)
		if errors.Is(err, auth.ErrNoRole) {
			s.limiter.Fail(key)
			return forbidden("your system account is in no group allowed to sign in here")
		}
	}
	// duck:end
	if errors.Is(err, auth.ErrInvalid) || errors.Is(err, auth.ErrDisabled) {
		s.limiter.Fail(key)
		return &apiError{http.StatusUnauthorized, "invalid_credentials", "wrong username or password"}
	}
	if err != nil {
		return err
	}
	s.limiter.Reset(key)
	tok, err := s.Auth.NewSession(r.Context(), u.ID, p.IP, r.UserAgent())
	if err != nil {
		return err
	}
	s.Store.Q.TouchUserLogin(r.Context(), db.TouchUserLoginParams{ID: u.ID, Now: store.NullTime(store.Now())})
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: tok, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode,
		Secure: s.secureRequest(r), MaxAge: int(auth.SessionAbsolute / time.Second),
	})
	s.record(r, principal{IP: p.IP, User: u}, "auth.login", "user", u.ID, nil)
	return ok(w, toUser(u))
}

// openapi:operation
// summary: Sign out
// tags: [auth]
// responses:
//   '204': { description: Signed out }

func (s *Server) logout(w http.ResponseWriter, r *http.Request, p principal) error {
	if err := s.Auth.EndSession(r.Context(), p.SessionHash); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	return noContent(w)
}

// openapi:schema Me
// type: object
// required: [user, permissions]
// properties:
//   user: { $ref: '#/components/schemas/User' }
//   permissions: { type: array, items: { type: string }, description: 'Global permissions of the role; "*" is all of them.' }

type meDTO struct {
	User        userDTO  `json:"user"`
	Permissions []string `json:"permissions"`
}

// openapi:operation
// summary: The signed-in user and what they may do
// tags: [auth]
// responses:
//   '200': { description: Me, schema: Me }

func (s *Server) me(w http.ResponseWriter, r *http.Request, p principal) error {
	return ok(w, meDTO{User: toUser(p.User), Permissions: append([]string{}, p.Perms...)})
}

// openapi:schema ChangePasswordRequest
// type: object
// required: [current, password]
// additionalProperties: false
// properties:
//   current: { type: string, format: password }
//   password: { type: string, format: password, minLength: 10 }

type changePasswordRequest struct {
	Current  string `json:"current"`
	Password string `json:"password"`
}

// openapi:operation
// summary: Change my password
// description: Ends every other session of the user.
// tags: [auth]
// requestBody: { schema: ChangePasswordRequest }
// responses:
//   '204': { description: Changed }

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request, p principal) error {
	var req changePasswordRequest
	if err := decode(r, &req); err != nil {
		return err
	}
	if p.User.Source != "local" {
		return conflict("the password of a %s account is managed by the host", p.User.Source)
	}
	if _, err := s.Auth.Authenticate(r.Context(), p.User.Username, req.Current); err != nil {
		return &apiError{http.StatusBadRequest, "invalid_credentials", "current password is wrong"}
	}
	if err := s.setPassword(r, p.User.ID, req.Password); err != nil {
		return err
	}
	// Keep this session, sign out the rest: recreate it after the purge.
	s.Store.Q.DeleteUserWebSessions(r.Context(), p.User.ID)
	tok, err := s.Auth.NewSession(r.Context(), p.User.ID, p.IP, r.UserAgent())
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: tok, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode,
		Secure: s.secureRequest(r), MaxAge: int(auth.SessionAbsolute / time.Second),
	})
	s.record(r, p, "user.password", "user", p.User.ID, nil)
	return noContent(w)
}

func (s *Server) setPassword(r *http.Request, userID, pw string) error {
	if err := auth.CheckPasswordPolicy(pw); err != nil {
		return badRequest("%s", err.Error())
	}
	hash, err := auth.HashPassword(pw)
	if err != nil {
		return err
	}
	return fromStore(s.Store.Q.SetUserPassword(r.Context(), db.SetUserPasswordParams{ID: userID, PasswordHash: hash, Now: store.Now()}), "user")
}
