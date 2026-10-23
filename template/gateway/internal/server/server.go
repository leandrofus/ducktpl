// Package server exposes the REST API (/api/v1) and serves the embedded UI.
//
// Every route is registered in Handler with its access rule; cmd/openapi-gen
// reads them from here, so the contract (openapi/openapi.yaml) always says
// who may call what.
package server

import (
	"net/http"
	"net/netip"

	// duck:if audit
	"github.com/duckowner/duckapp/gateway/internal/audit"
	// duck:end
	// duck:if auth
	"github.com/duckowner/duckapp/gateway/internal/auth"
	// duck:end
	// duck:if redis
	"github.com/duckowner/duckapp/gateway/internal/cache"
	// duck:end
	// duck:if ws|sse
	"github.com/duckowner/duckapp/gateway/internal/events"
	// duck:end
	// duck:if s3
	"github.com/duckowner/duckapp/gateway/internal/objstore"
	// duck:end
	"github.com/duckowner/duckapp/gateway/internal/store"
)

type Server struct {
	Store *store.Store
	// duck:if auth
	Auth *auth.Service
	// duck:end
	// duck:if pam
	// PAM, when set, lets system users sign in (see internal/auth/pam.go).
	PAM *auth.PAM
	// duck:end
	// duck:if audit
	Audit *audit.Log
	// duck:end
	// duck:if ws|sse
	Events *events.Bus
	// duck:end
	// duck:if redis
	Cache cache.Cache
	// duck:end
	// duck:if s3
	Objects objstore.Store
	// duck:end
	// TrustedProxies are the reverse proxies in front of the gateway. Requests
	// from them are attributed to the address in X-Forwarded-For (the last
	// one not itself a trusted proxy), and their X-Forwarded-Proto counts.
	TrustedProxies []netip.Prefix
	// SecureCookies forces the Secure flag on cookies, for TLS terminated
	// before the gateway by a proxy not listed as trusted.
	SecureCookies bool
	Version       string

	// duck:if auth
	limiter *auth.Limiter
	// duck:end
	// duck:if ssr
	shell string // the built index.html, with the SSR markers
	// duck:end
}

func (s *Server) Handler() http.Handler {
	// duck:if auth
	if s.limiter == nil {
		s.limiter = auth.NewLimiter()
	}
	// duck:end
	mux := http.NewServeMux()
	mux.Handle("/", s.static())
	// duck:if ssr
	s.loadShell()
	mux.HandleFunc("GET /{$}", s.ssrHome)
	mux.HandleFunc("GET /n/{id}", s.ssrNote)
	// duck:end

	mux.Handle("GET /api/v1/health", s.public(s.health))

	// duck:if auth
	mux.Handle("POST /api/v1/auth/login", s.public(s.login))
	mux.Handle("POST /api/v1/auth/logout", s.signedIn(s.logout))
	mux.Handle("GET /api/v1/auth/me", s.signedIn(s.me))
	mux.Handle("PUT /api/v1/auth/me/password", s.signedIn(s.changePassword))

	mux.Handle("GET /api/v1/users", s.can(auth.PermUsersManage, s.listUsers))
	mux.Handle("POST /api/v1/users", s.can(auth.PermUsersManage, s.createUser))
	mux.Handle("PATCH /api/v1/users/{id}", s.can(auth.PermUsersManage, s.updateUser))
	mux.Handle("DELETE /api/v1/users/{id}", s.can(auth.PermUsersManage, s.deleteUser))
	mux.Handle("PUT /api/v1/users/{id}/password", s.can(auth.PermUsersManage, s.resetPassword))
	// duck:end

	// duck:if rbac
	mux.Handle("GET /api/v1/permissions", s.signedIn(s.listPermissions))
	mux.Handle("GET /api/v1/roles", s.signedIn(s.listRoles))
	mux.Handle("POST /api/v1/roles", s.can(auth.PermRolesManage, s.createRole))
	mux.Handle("PATCH /api/v1/roles/{name}", s.can(auth.PermRolesManage, s.updateRole))
	mux.Handle("DELETE /api/v1/roles/{name}", s.can(auth.PermRolesManage, s.deleteRole))
	mux.Handle("GET /api/v1/grants", s.signedIn(s.listGrants))
	mux.Handle("POST /api/v1/grants", s.signedIn(s.createGrant))
	mux.Handle("DELETE /api/v1/grants/{id}", s.signedIn(s.deleteGrant))
	// duck:end

	// duck:if auth
	// Notes: object-level checks (s.allow) happen inside the handlers, so
	// the routes only require a session.
	mux.Handle("GET /api/v1/notes", s.signedIn(s.listNotes))
	mux.Handle("POST /api/v1/notes", s.can(auth.PermNotesWrite, s.createNote))
	mux.Handle("GET /api/v1/notes/{id}", s.signedIn(s.getNote))
	mux.Handle("PATCH /api/v1/notes/{id}", s.signedIn(s.updateNote))
	mux.Handle("DELETE /api/v1/notes/{id}", s.signedIn(s.deleteNote))
	// duck:else
	// mux.Handle("GET /api/v1/notes", s.public(s.listNotes))
	// mux.Handle("POST /api/v1/notes", s.public(s.createNote))
	// mux.Handle("GET /api/v1/notes/{id}", s.public(s.getNote))
	// mux.Handle("PATCH /api/v1/notes/{id}", s.public(s.updateNote))
	// mux.Handle("DELETE /api/v1/notes/{id}", s.public(s.deleteNote))
	// duck:end

	// duck:if s3 auth
	mux.Handle("GET /api/v1/notes/{id}/files", s.signedIn(s.listFiles))
	mux.Handle("POST /api/v1/notes/{id}/files", s.signedIn(s.uploadFile))
	mux.Handle("GET /api/v1/files/{id}/content", s.signedIn(s.downloadFile))
	mux.Handle("DELETE /api/v1/files/{id}", s.signedIn(s.deleteFile))
	// duck:end
	// duck:if s3 !auth
	// mux.Handle("GET /api/v1/notes/{id}/files", s.public(s.listFiles))
	// mux.Handle("POST /api/v1/notes/{id}/files", s.public(s.uploadFile))
	// mux.Handle("GET /api/v1/files/{id}/content", s.public(s.downloadFile))
	// mux.Handle("DELETE /api/v1/files/{id}", s.public(s.deleteFile))
	// duck:end

	// duck:if audit auth
	mux.Handle("GET /api/v1/audit", s.can(auth.PermAuditRead, s.listAudit))
	mux.Handle("GET /api/v1/audit/verify", s.can(auth.PermAuditRead, s.verifyAudit))
	// duck:end
	// duck:if audit !auth
	// mux.Handle("GET /api/v1/audit", s.public(s.listAudit))
	// mux.Handle("GET /api/v1/audit/verify", s.public(s.verifyAudit))
	// duck:end

	// duck:if ws auth
	mux.Handle("GET /api/v1/ws", s.signedIn(s.websocket))
	// duck:end
	// duck:if ws !auth
	// mux.Handle("GET /api/v1/ws", s.public(s.websocket))
	// duck:end
	// duck:if sse auth
	mux.Handle("GET /api/v1/events", s.signedIn(s.eventStream))
	// duck:end
	// duck:if sse !auth
	// mux.Handle("GET /api/v1/events", s.public(s.eventStream))
	// duck:end

	// ducktpl:routes (npx ducktpl add <resource> inserts above)

	mux.Handle("/api/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeErr(w, notFound("route"))
	}))
	return securityHeaders(mux)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}
