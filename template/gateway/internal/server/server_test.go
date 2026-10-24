package server

import (
	// duck:if sse
	"bufio"
	// duck:end
	"bytes"
	// duck:if auth|ws|sse
	"context"
	// duck:end
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	// duck:if ws|sse
	"time"
	// duck:end

	// duck:if ws
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	// duck:end

	// duck:if audit
	"github.com/duckowner/duckapp/gateway/internal/audit"
	// duck:end
	// duck:if auth
	"github.com/duckowner/duckapp/gateway/internal/auth"
	// duck:end
	// duck:if redis
	"github.com/duckowner/duckapp/gateway/internal/cache"
	// duck:end
	// duck:if ws|sse|eventbus
	"github.com/duckowner/duckapp/gateway/internal/events"
	// duck:end
	// duck:if s3
	"github.com/duckowner/duckapp/gateway/internal/objstore"
	// duck:end
	"github.com/duckowner/duckapp/gateway/internal/store"
)

// The suites run on SQLite, and on PostgreSQL with DUCKAPP_TEST_POSTGRES
// (make test-postgres).

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	st, closeDB, err := store.OpenTemp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(closeDB)
	srv := &Server{Store: st, Version: "test"}
	// duck:if auth
	srv.Auth = &auth.Service{Store: st}
	if _, err := srv.Auth.Bootstrap(context.Background(), "admin", "admin-password"); err != nil {
		t.Fatal(err)
	}
	// duck:end
	// duck:if audit
	srv.Audit = &audit.Log{Store: st, Key: []byte("k")}
	// duck:end
	// duck:if redis
	srv.Cache = cache.NewMemory()
	// duck:end
	// duck:if ws|sse|eventbus
	srv.Events = events.New()
	// duck:end
	// duck:if s3
	srv.Objects = objstore.Disk{Dir: t.TempDir()}
	// duck:end
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts
}

type client struct {
	t    *testing.T
	base string
	http *http.Client
}

func newClient(t *testing.T, ts *httptest.Server) *client {
	jar, _ := cookiejar.New(nil)
	return &client{t: t, base: ts.URL + "/api/v1", http: &http.Client{Jar: jar}}
}

// do sends a JSON request and decodes the response into out (when not nil);
// it returns the status.
func (c *client) do(method, path string, body, out any) int {
	c.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.base+path, rd)
	req.Header.Set("X-DuckApp-Request", "1")
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	if out != nil {
		json.NewDecoder(res.Body).Decode(out)
	}
	return res.StatusCode
}

func (c *client) must(want int, method, path string, body, out any) {
	c.t.Helper()
	if got := c.do(method, path, body, out); got != want {
		c.t.Fatalf("%s %s: status %d, want %d", method, path, got, want)
	}
}

// duck:if auth
func (c *client) login(user, pw string) {
	c.t.Helper()
	c.must(200, "POST", "/auth/login", map[string]string{"username": user, "password": pw}, nil)
}

// duck:end

func TestHealth(t *testing.T) {
	c := newClient(t, newTestServer(t))
	var h healthDTO
	c.must(200, "GET", "/health", nil, &h)
	if h.Status != "ok" {
		t.Fatalf("health %+v", h)
	}
	c.must(404, "GET", "/nope", nil, nil)
}

func TestCSRFHeaderRequired(t *testing.T) {
	ts := newTestServer(t)
	res, err := http.Post(ts.URL+"/api/v1/notes", "application/json", strings.NewReader(`{"title":"x"}`))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("status %d without the CSRF header", res.StatusCode)
	}
}

// seedNote creates a note for tests that need one (ducktpl ref fields).
func seedNote(c *client) string {
	c.t.Helper()
	var n noteDTO
	c.must(201, "POST", "/notes", map[string]any{"title": "seed " + store.NewID()}, &n)
	return n.ID
}

func TestNotes(t *testing.T) {
	c := newClient(t, newTestServer(t))
	// duck:if auth
	c.must(401, "GET", "/notes", nil, nil)
	c.login("admin", "admin-password")
	// duck:end
	var n noteDTO
	c.must(201, "POST", "/notes", map[string]any{"title": " First ", "body": "hi"}, &n)
	if n.Title != "First" || n.ID == "" {
		t.Fatalf("created %+v", n)
	}
	c.must(409, "POST", "/notes", map[string]any{"title": "First"}, nil)
	c.must(400, "POST", "/notes", map[string]any{"title": ""}, nil)
	c.must(400, "POST", "/notes", map[string]any{"title": "x", "nope": 1}, nil)
	c.must(200, "PATCH", "/notes/"+n.ID, map[string]any{"pinned": true}, &n)
	if !n.Pinned || n.Body != "hi" {
		t.Fatalf("patched %+v", n)
	}
	var list paginatedNotes
	c.must(200, "GET", "/notes", nil, &list)
	if len(list.Items) != 1 || !list.Items[0].Pinned || list.Total != 1 {
		t.Fatalf("list %+v", list)
	}
	c.must(204, "DELETE", "/notes/"+n.ID, nil, nil)
	c.must(404, "GET", "/notes/"+n.ID, nil, nil)
	c.must(200, "GET", "/notes", nil, &list)
	if len(list.Items) != 0 || list.Total != 0 {
		t.Fatalf("list after delete %+v (stale cache?)", list)
	}
}

// duck:if auth
func TestUsersAndPermissions(t *testing.T) {
	ts := newTestServer(t)
	admin := newClient(t, ts)
	admin.must(401, "POST", "/auth/login", map[string]string{"username": "admin", "password": "wrong"}, nil)
	admin.login("admin", "admin-password")
	var me meDTO
	admin.must(200, "GET", "/auth/me", nil, &me)
	if me.User.Role != "admin" || !auth.Has(me.Permissions, auth.PermUsersManage) {
		t.Fatalf("me %+v", me)
	}
	var ana userDTO
	admin.must(400, "POST", "/users", map[string]any{"username": "ana", "password": "short"}, nil)
	admin.must(201, "POST", "/users", map[string]any{"username": "ana", "password": "ana-password"}, &ana)
	admin.must(409, "POST", "/users", map[string]any{"username": "ana", "password": "ana-password"}, nil)
	admin.must(409, "DELETE", "/users/"+me.User.ID, nil, nil)

	user := newClient(t, ts)
	user.login("ana", "ana-password")
	user.must(403, "GET", "/users", nil, nil)
	user.must(201, "POST", "/notes", map[string]any{"title": "mine"}, nil)

	// Disabling a user ends their sessions.
	admin.must(200, "PATCH", "/users/"+ana.ID, map[string]any{"disabled": true}, nil)
	user.must(401, "GET", "/notes", nil, nil)

	// Password change keeps the session that made it.
	admin.must(204, "PUT", "/auth/me/password", map[string]string{"current": "admin-password", "password": "new-admin-password"}, nil)
	admin.must(200, "GET", "/auth/me", nil, nil)
	admin.must(204, "POST", "/auth/logout", nil, nil)
	admin.must(401, "GET", "/auth/me", nil, nil)
	admin.login("admin", "new-admin-password")
}

// duck:end

// duck:if rbac
func TestRolesAndGrants(t *testing.T) {
	ts := newTestServer(t)
	admin := newClient(t, ts)
	admin.login("admin", "admin-password")

	// A role that can only read, and a user holding it.
	admin.must(400, "POST", "/roles", map[string]any{"name": "reader", "permissions": []string{"nope"}}, nil)
	admin.must(201, "POST", "/roles", map[string]any{"name": "reader", "permissions": []string{}}, nil)
	var bob userDTO
	admin.must(201, "POST", "/users", map[string]any{"username": "bob", "password": "bob-password", "role": "reader"}, &bob)
	admin.must(409, "DELETE", "/roles/reader", nil, nil) // held by bob
	admin.must(409, "PATCH", "/roles/admin", map[string]any{"permissions": []string{}}, nil)

	var a, b noteDTO
	admin.must(201, "POST", "/notes", map[string]any{"title": "shared"}, &a)
	admin.must(201, "POST", "/notes", map[string]any{"title": "secret"}, &b)

	bc := newClient(t, ts)
	bc.login("bob", "bob-password")
	var list paginatedNotes
	bc.must(200, "GET", "/notes", nil, &list)
	if len(list.Items) != 0 {
		t.Fatalf("bob sees %d notes without grants", len(list.Items))
	}
	bc.must(403, "GET", "/notes/"+a.ID, nil, nil)

	// Grant read on one note to bob, write to his role.
	var g grantDTO
	admin.must(201, "POST", "/grants", map[string]any{"subject_type": "user", "subject_id": bob.ID, "object_type": "note", "object_id": a.ID, "permission": "notes.read"}, &g)
	bc.must(200, "GET", "/notes", nil, &list)
	if len(list.Items) != 1 || list.Items[0].ID != a.ID {
		t.Fatalf("bob sees %+v", list)
	}
	bc.must(403, "PATCH", "/notes/"+a.ID, map[string]any{"body": "x"}, nil)
	// bob cannot pass on what he does not hold
	bc.must(403, "POST", "/grants", map[string]any{"subject_type": "role", "subject_id": "reader", "object_type": "note", "object_id": a.ID, "permission": "notes.write"}, nil)
	admin.must(201, "POST", "/grants", map[string]any{"subject_type": "role", "subject_id": "reader", "object_type": "note", "object_id": a.ID, "permission": "notes.write"}, nil)
	bc.must(200, "PATCH", "/notes/"+a.ID, map[string]any{"body": "x"}, nil)
	bc.must(403, "GET", "/notes/"+b.ID, nil, nil)

	var gs []grantDTO
	admin.must(200, "GET", "/grants?object_type=note&object_id="+a.ID, nil, &gs)
	if len(gs) != 2 {
		t.Fatalf("grants %+v", gs)
	}
	admin.must(204, "DELETE", "/grants/"+g.ID, nil, nil)
	admin.must(204, "DELETE", "/notes/"+a.ID, nil, nil) // takes its grants along
	admin.must(200, "GET", "/grants?object_type=note&object_id="+a.ID, nil, &gs)
	if len(gs) != 0 {
		t.Fatalf("grants after delete %+v", gs)
	}
}

// duck:end

// duck:if audit
func TestAuditChain(t *testing.T) {
	c := newClient(t, newTestServer(t))
	// duck:if auth
	c.login("admin", "admin-password")
	// duck:end
	var n noteDTO
	c.must(201, "POST", "/notes", map[string]any{"title": "a"}, &n)
	c.must(204, "DELETE", "/notes/"+n.ID, nil, nil)
	var evs paginatedAuditEvents
	c.must(200, "GET", "/audit", nil, &evs)
	if len(evs.Items) < 2 || evs.Items[0].Action != "note.delete" {
		t.Fatalf("audit %+v", evs)
	}
	var v audit.Verification
	c.must(200, "GET", "/audit/verify", nil, &v)
	if !v.Valid {
		t.Fatalf("verify %+v", v)
	}
}

// duck:end

// duck:if s3
func TestFiles(t *testing.T) {
	ts := newTestServer(t)
	c := newClient(t, ts)
	// duck:if auth
	c.login("admin", "admin-password")
	// duck:end
	var n noteDTO
	c.must(201, "POST", "/notes", map[string]any{"title": "with files"}, &n)
	req, _ := http.NewRequest("POST", c.base+"/notes/"+n.ID+"/files?name=hello.txt", strings.NewReader("hello"))
	req.Header.Set("X-DuckApp-Request", "1")
	res, err := c.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var f fileDTO
	json.NewDecoder(res.Body).Decode(&f)
	res.Body.Close()
	if res.StatusCode != 201 || f.Size != 5 || !strings.HasPrefix(f.ContentType, "text/plain") {
		t.Fatalf("upload %d %+v", res.StatusCode, f)
	}
	res, err = c.http.Get(c.base + "/files/" + f.ID + "/content")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if string(b) != "hello" {
		t.Fatalf("download %q", b)
	}
	c.must(204, "DELETE", "/notes/"+n.ID, nil, nil)
	c.must(404, "GET", "/files/"+f.ID+"/content", nil, nil)
}

// duck:end

// duck:if sse
func TestEventStream(t *testing.T) {
	ts := newTestServer(t)
	c := newClient(t, ts)
	// duck:if auth
	c.login("admin", "admin-password")
	// duck:end
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", c.base+"/events", nil)
	res, err := c.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	sc := bufio.NewScanner(res.Body)
	sc.Scan() // retry:
	sc.Scan()
	c.must(201, "POST", "/notes", map[string]any{"title": "live"}, nil)
	for sc.Scan() {
		if strings.HasPrefix(sc.Text(), "event: note.changed") {
			return
		}
	}
	t.Fatal("no note.changed event")
}

// duck:end

// duck:if ws
func TestWebSocket(t *testing.T) {
	ts := newTestServer(t)
	c := newClient(t, ts)
	// duck:if auth
	c.login("admin", "admin-password")
	// duck:end
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, strings.Replace(c.base, "http", "ws", 1)+"/ws", &websocket.DialOptions{HTTPClient: c.http})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	time.Sleep(50 * time.Millisecond) // let the server subscribe
	c.must(201, "POST", "/notes", map[string]any{"title": "live"}, nil)
	var ev events.Event
	if err := wsjson.Read(ctx, conn, &ev); err != nil || ev.Type != "note.changed" {
		t.Fatalf("event %+v %v", ev, err)
	}
}

// duck:end

// duck:if ssr
func TestSSR(t *testing.T) {
	ts := newTestServer(t)
	res, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || !strings.Contains(string(b), `id="ssr"`) || !strings.Contains(string(b), "og:title") {
		t.Fatalf("home %d %s", res.StatusCode, b)
	}
}

// duck:end
