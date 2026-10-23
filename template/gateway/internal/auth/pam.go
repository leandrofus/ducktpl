// duck:file pam
package auth

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/user"
	"runtime"
	"slices"

	"github.com/duckowner/duckapp/gateway/internal/store"
	"github.com/duckowner/duckapp/gateway/internal/store/db"
)

// PAM signs in system users: the host checks the password (PAM stacks, so
// shadow, SSSD/LDAP, lockouts and expiry all apply) and the user's groups
// pick the role. The user row is created on first login and its role
// re-synced on every login.
//
// The gateway runs unprivileged, so it asks a root helper on HelperSocket
// (`duckapp pam-helper`, socket-activated by systemd: see deploy/systemd).
// Without the helper it tries PAM in-process, which only works as root or
// with modules that need no privilege (pam_sss).
type PAM struct {
	Service *Service
	// PAMService is the PAM stack name (/etc/pam.d/<name>).
	PAMService string
	// Roles maps system groups to roles, first match wins; users in none of
	// them may not sign in.
	Roles []GroupRole
	// AllowRoot lets root sign in.
	AllowRoot bool
}

type GroupRole struct{ Group, Role string }

var (
	ErrNoRole      = errors.New("the user is in no group that grants a role")
	ErrUnavailable = errors.New("system-user authentication is not available in this build (build with -tags pam)")
)

// Login checks a system user's password and returns their user row.
func (p *PAM) Login(ctx context.Context, username, password, rhost string) (db.User, error) {
	if username == "root" && !p.AllowRoot {
		return db.User{}, ErrInvalid
	}
	if err := checkPassword(p.PAMService, username, password, rhost); err != nil {
		if errors.Is(err, ErrBadPassword) {
			return db.User{}, ErrInvalid
		}
		return db.User{}, err
	}
	role, err := p.role(username)
	if err != nil {
		return db.User{}, err
	}
	q := p.Service.Store.Q
	u, err := q.GetUserByUsername(ctx, username)
	switch {
	case errors.Is(store.Classify(err), store.ErrNotFound):
		err = q.CreatePAMUser(ctx, db.CreatePAMUserParams{ID: store.NewID(), Username: username, Role: role, Now: store.Now()})
	case err != nil:
		return db.User{}, err
	case u.Source != "pam":
		return db.User{}, ErrInvalid // a local account with that name: never shadowed
	case u.Disabled:
		return db.User{}, ErrDisabled
	default:
		err = q.SyncPAMUser(ctx, db.SyncPAMUserParams{ID: u.ID, Role: role, Now: store.Now()})
	}
	if err != nil {
		return db.User{}, err
	}
	return q.GetUserByUsername(ctx, username)
}

func (p *PAM) role(username string) (string, error) {
	groups, err := Groups(username)
	if err != nil {
		return "", fmt.Errorf("groups of %s: %w", username, err)
	}
	for _, gr := range p.Roles {
		if slices.Contains(groups, gr.Group) {
			return gr.Role, nil
		}
	}
	return "", ErrNoRole
}

// Groups returns the names of every group the user belongs to (primary
// included), resolved through NSS so LDAP/SSSD users work too.
func Groups(username string) ([]string, error) {
	u, err := user.Lookup(username)
	if err != nil {
		return nil, err
	}
	ids, err := u.GroupIds()
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(ids))
	for _, id := range ids {
		if g, err := user.LookupGroupId(id); err == nil {
			names = append(names, g.Name)
		}
	}
	return names, nil
}

// Mode describes how system users are checked, for the startup log.
func Mode() string {
	switch {
	case os.Geteuid() == 0 && pamCompiled:
		return "pam in-process (root)"
	case fileExists(HelperSocket):
		return "pam via the root helper (" + HelperSocket + ")"
	case pamCompiled:
		return "pam in-process, unprivileged (only SSSD/LDAP or your own user)"
	case runtime.GOOS != "linux":
		return "not available on " + runtime.GOOS
	}
	return "not available (build with -tags pam)"
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }
