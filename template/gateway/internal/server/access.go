package server

import (
	"fmt"
	// duck:if !audit
	// "log/slog"
	// duck:end
	"net/http"
	"net/netip"
	"strings"

	// duck:if auth
	"github.com/duckowner/duckapp/gateway/internal/auth"
	"github.com/duckowner/duckapp/gateway/internal/store/db"
	// duck:end
)

const (
	// duck:if auth
	sessionCookie = "duckapp_session"
	// duck:end
	// Mutating requests must carry this header. Browsers cannot add custom
	// headers to cross-site requests without a CORS preflight we never
	// answer, so together with SameSite=Strict cookies it stops CSRF.
	csrfHeader = "X-DuckApp-Request"
)

// principal is who is calling.
type principal struct {
	IP string
	// duck:if auth
	User        db.User
	SessionHash string
	// Perms: the user's global permissions (auth.PermAll for everything).
	Perms []string
	// duck:end
}

// who names the caller for audit records and logs.
func (p principal) who() (id, username string) {
	// duck:if auth
	return p.User.ID, p.User.Username
	// duck:else
	// return "", ""
	// duck:end
}

type handlerFunc func(w http.ResponseWriter, r *http.Request, p principal) error

func checkCSRF(r *http.Request) error {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return nil
	}
	if r.Header.Get(csrfHeader) == "" {
		return &apiError{http.StatusForbidden, "csrf", "missing " + csrfHeader + " header"}
	}
	return nil
}

// public needs no session (still the CSRF header on writes).
func (s *Server) public(h handlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := checkCSRF(r); err != nil {
			writeErr(w, err)
			return
		}
		if err := h(w, r, principal{IP: s.clientIP(r)}); err != nil {
			writeErr(w, err)
		}
	})
}

// duck:if auth
func (s *Server) resolve(r *http.Request) (principal, error) {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return principal{}, errUnauthorized
	}
	sess, err := s.Auth.Session(r.Context(), c.Value)
	if err != nil {
		return principal{}, errUnauthorized
	}
	perms, err := s.Auth.Permissions(r.Context(), sess.User.Role)
	if err != nil {
		return principal{}, err
	}
	return principal{IP: s.clientIP(r), User: sess.User, SessionHash: sess.IDHash, Perms: perms}, nil
}

// signedIn requires a session; what the caller may do is checked inside.
func (s *Server) signedIn(h handlerFunc) http.Handler {
	return s.can("", h)
}

// can requires a session whose role grants perm ("" for any session).
func (s *Server) can(perm string, h handlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := checkCSRF(r); err != nil {
			writeErr(w, err)
			return
		}
		p, err := s.resolve(r)
		switch {
		case err != nil:
			writeErr(w, err)
		case perm != "" && !auth.Has(p.Perms, perm):
			writeErr(w, forbidden("missing permission %s", perm))
		default:
			if err := h(w, r, p); err != nil {
				writeErr(w, err)
			}
		}
	})
}

// duck:end

// duck:if !rbac
// // allow checks a permission on one object. Without object grants (the rbac
// // module) it is the caller's global permission.
// func (s *Server) allow(r *http.Request, p principal, perm, objType, objID string) error {
// duck:if auth
// if !auth.Has(p.Perms, perm) {
// return forbidden("missing permission %s", perm)
// }
// duck:end
// return nil
// }

// // visible reports which objects of a type the caller may see: all of them,
// // or only those in ids.
// func (s *Server) visible(r *http.Request, p principal, perm, objType string) (all bool, ids map[string]bool, err error) {
// duck:if auth
// if !auth.Has(p.Perms, perm) {
// return false, nil, nil
// }
// duck:end
// return true, nil, nil
// }

// duck:end

// record writes an audit event. A failure is logged, never shown to the
// client: the change it describes already happened.
func (s *Server) record(r *http.Request, p principal, action, targetType, targetID string, details any) {
	id, username := p.who()
	// duck:if audit
	s.recordAudit(r, p.IP, id, username, action, targetType, targetID, details)
	// duck:else
	// slog.Info(action, "target", targetType+":"+targetID, "user", username, "user_id", id, "ip", p.IP, "details", details)
	// duck:end
}

// changed tells live clients (ws, sse) that an object changed, and drops
// cached reads of its type. Events carry ids only: clients refetch through
// the API, which applies permissions.
func (s *Server) changed(r *http.Request, objType, id string) {
	// duck:if redis
	s.Cache.DeletePrefix(r.Context(), objType+":")
	// duck:end
	// duck:if ws|sse
	s.Events.Publish(r.Context(), objType+".changed", id)
	// duck:end
}

func (s *Server) trusted(a netip.Addr) bool {
	for _, p := range s.TrustedProxies {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

func remoteAddr(r *http.Request) netip.Addr {
	ap, err := netip.ParseAddrPort(r.RemoteAddr)
	if err != nil {
		return netip.Addr{}
	}
	return ap.Addr().Unmap()
}

// clientIP is the address the request came from. Behind trusted proxies it
// is the right-most X-Forwarded-For entry that is not one of them: entries
// further left were written by the client and prove nothing.
func (s *Server) clientIP(r *http.Request) string {
	addr := remoteAddr(r)
	if !addr.IsValid() {
		return r.RemoteAddr
	}
	if !s.trusted(addr) {
		return addr.String()
	}
	hops := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		a, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			break // garbage: stop at the last address we could trust
		}
		addr = a.Unmap()
		if !s.trusted(addr) {
			break
		}
	}
	return addr.String()
}

// secureRequest reports whether the browser reached us over HTTPS.
func (s *Server) secureRequest(r *http.Request) bool {
	if r.TLS != nil || s.SecureCookies {
		return true
	}
	return s.trusted(remoteAddr(r)) && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// ParseProxies parses a comma-separated list of addresses and CIDRs.
func ParseProxies(list string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, f := range strings.Split(list, ",") {
		if f = strings.TrimSpace(f); f == "" {
			continue
		}
		if !strings.Contains(f, "/") {
			a, err := netip.ParseAddr(f)
			if err != nil {
				return nil, fmt.Errorf("trusted proxy %q: %w", f, err)
			}
			out = append(out, netip.PrefixFrom(a.Unmap(), a.Unmap().BitLen()))
			continue
		}
		p, err := netip.ParsePrefix(f)
		if err != nil {
			return nil, fmt.Errorf("trusted proxy %q: %w", f, err)
		}
		out = append(out, p.Masked())
	}
	return out, nil
}
