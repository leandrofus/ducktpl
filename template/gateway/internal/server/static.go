package server

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/duckowner/duckapp/gateway/internal/server/ui"
)

// The built UI loads nothing from other origins; inline styles are used by
// components.
const uiCSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
	"font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

const placeholder = `<!doctype html><meta charset="utf-8"><title>duckapp</title>
<p style="font:15px system-ui;margin:3em">The UI is not built into this binary. Run <code>make build</code>, or <code>make dev</code> for hot reload.</p>`

// static serves the embedded UI: hashed assets cached forever, index.html
// never cached.
func (s *Server) static() http.Handler {
	dist := ui.FS()
	files := http.FileServerFS(dist)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		p := strings.TrimPrefix(r.URL.Path, "/")
		if dist == nil {
			if p != "" {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write([]byte(placeholder))
			return
		}
		w.Header().Set("Content-Security-Policy", uiCSP)
		if p == "" || p == "index.html" {
			w.Header().Set("Cache-Control", "no-cache")
			http.ServeFileFS(w, r, dist, "index.html")
			return
		}
		if _, err := fs.Stat(dist, p); err != nil {
			http.NotFound(w, r)
			return
		}
		if strings.HasPrefix(p, "assets/") {
			// Vite fingerprints these file names.
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		files.ServeHTTP(w, r)
	})
}

// openapi:schema Health
// type: object
// required: [status, version]
// properties:
//   status: { type: string, enum: [ok] }
//   version: { type: string }

type healthDTO struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

// openapi:operation
// summary: Liveness and version
// tags: [system]
// responses:
//   '200': { description: Up, schema: Health }

func (s *Server) health(w http.ResponseWriter, r *http.Request, p principal) error {
	if err := s.Store.DB.PingContext(r.Context()); err != nil {
		return &apiError{http.StatusServiceUnavailable, "unavailable", "database unreachable"}
	}
	return ok(w, healthDTO{Status: "ok", Version: s.Version})
}
