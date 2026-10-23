// duck:file ssr
package server

// Server-rendered first paint (the duckforum pattern). The built index.html
// is a shell with two markers: <!--ssr-head--> (meta, canonical, Open
// Graph) and <!--ssr-body--> (the page content as plain semantic HTML).
// Crawlers and slow phones get content without running JS; the app then
// takes over and hides the server block once it has rendered (the
// "hydrated" class on <html>).

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"html"
	"html/template"
	"io/fs"
	"net/http"
	"regexp"
	"strings"

	"github.com/duckowner/duckapp/gateway/internal/server/ui"
)

const fallbackShell = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DuckApp</title><!--ssr-head--></head><body><div id="root"></div><!--ssr-body--></body></html>`

var (
	titleRE = regexp.MustCompile(`(?s)<title>.*?</title>`)

	headTmpl = template.Must(template.New("head").Parse(`
{{if .Private}}<meta name="robots" content="noindex, nofollow">{{else}}<meta name="description" content="{{.Description}}">
<meta property="og:title" content="{{.Title}}">
<meta property="og:description" content="{{.Description}}">
<meta property="og:type" content="{{.OGType}}">{{end}}`))

	listTmpl = template.Must(template.New("list").Parse(`<main id="ssr" class="ssr"><h1>{{.Title}}</h1>
{{if .Notes}}<ul>{{range .Notes}}<li><a href="/n/{{.ID}}">{{.Title}}</a></li>{{end}}</ul>{{else}}<p>{{.Description}}</p>{{end}}</main>`))

	noteTmpl = template.Must(template.New("note").Parse(`<main id="ssr" class="ssr"><article><h1>{{.Title}}</h1>
<p style="white-space:pre-wrap">{{.Body}}</p></article></main>`))
)

type page struct {
	Title, Description, OGType string
	// Private: content only signed-in users may see; not cached, not indexed.
	Private bool
	Body    template.HTML
}

// loadShell reads the built index.html once.
func (s *Server) loadShell() {
	if dist := ui.FS(); dist != nil {
		if b, err := fs.ReadFile(dist, "index.html"); err == nil {
			s.shell = string(b)
		}
	}
}

func (s *Server) writePage(w http.ResponseWriter, r *http.Request, status int, p page) {
	var head bytes.Buffer
	if err := headTmpl.Execute(&head, p); err != nil {
		writeErr(w, err)
		return
	}
	shell := s.shell
	if shell == "" {
		shell = fallbackShell
	}
	doc := titleRE.ReplaceAllLiteralString(shell, "<title>"+html.EscapeString(p.Title)+"</title>")
	doc = strings.Replace(doc, "<!--ssr-head-->", head.String(), 1)
	doc = strings.Replace(doc, "<!--ssr-body-->", string(p.Body), 1)

	sum := sha256.Sum256([]byte(doc))
	etag := `W/"` + hex.EncodeToString(sum[:8]) + `"`
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Content-Security-Policy", uiCSP)
	h.Set("Vary", "Cookie")
	h.Set("Cache-Control", "no-cache") // revalidate; the ETag makes that a 304
	if p.Private {
		h.Set("Cache-Control", "private, no-store")
		h.Set("X-Robots-Tag", "noindex, nofollow")
	}
	if status == http.StatusOK && !p.Private {
		h.Set("ETag", etag)
		if r.Header.Get("If-None-Match") == etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}
	w.WriteHeader(status)
	w.Write([]byte(doc))
}

const siteTitle = "DuckApp"

// ssrHome renders the note list. With the auth module notes are private,
// so the page carries only the app's description.
func (s *Server) ssrHome(w http.ResponseWriter, r *http.Request) {
	data := struct {
		Title, Description string
		Notes              []noteDTO
	}{Title: siteTitle, Description: "Sign in to see your notes."}
	p := page{Title: siteTitle, Description: data.Description, OGType: "website"}
	// duck:if !auth
	// ns, err := s.allNotes(r)
	// if err != nil {
	// 	writeErr(w, err)
	// 	return
	// }
	// data.Notes, data.Description, p.Description = ns, "Notes", "Notes"
	// duck:end
	var body bytes.Buffer
	if err := listTmpl.Execute(&body, data); err != nil {
		writeErr(w, err)
		return
	}
	p.Body = template.HTML(body.String())
	s.writePage(w, r, http.StatusOK, p)
}

// ssrNote renders one note at /n/{id}; the app opens it at #/notes/{id}.
func (s *Server) ssrNote(w http.ResponseWriter, r *http.Request) {
	p := page{Title: siteTitle, OGType: "article", Private: true}
	// duck:if !auth
	// n, err := s.Store.Q.GetNote(r.Context(), r.PathValue("id"))
	// if err != nil {
	// 	p.Body = template.HTML(`<main id="ssr" class="ssr"><p>Note not found.</p></main>`)
	// 	s.writePage(w, r, http.StatusNotFound, p)
	// 	return
	// }
	// var body bytes.Buffer
	// noteTmpl.Execute(&body, n)
	// desc := n.Body
	// if len([]rune(desc)) > 160 {
	// 	desc = string([]rune(desc)[:157]) + "…"
	// }
	// p = page{Title: n.Title + " · " + siteTitle, Description: desc, OGType: "article", Body: template.HTML(body.String())}
	// duck:end
	s.writePage(w, r, http.StatusOK, p)
}
