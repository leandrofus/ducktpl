// Command duckapp is the gateway: API, embedded UI and database in one
// binary. Every flag has a DUCKAPP_<NAME> environment variable.
package main

import (
	"context"
	// duck:if audit
	"crypto/rand"
	"encoding/hex"
	// duck:end
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	// duck:if audit|pam
	"strings"
	// duck:end
	"syscall"
	"time"

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
	"github.com/duckowner/duckapp/gateway/internal/server"
	"github.com/duckowner/duckapp/gateway/internal/store"
)

var version = "dev"

type config struct {
	listen, db, proxies string
	secureCookies       bool
	// duck:if auth
	admin string
	// duck:end
	// duck:if audit
	auditKey string
	// duck:end
	// duck:if pam
	pamService, pamRoles string
	pamRoot              bool
	// duck:end
	// duck:if redis
	redis string
	// duck:end
	// duck:if s3
	files string
	s3    objstore.Config
	// duck:end
}

// env returns $DUCKAPP_<name>, or def.
func env(name, def string) string {
	if v := os.Getenv("DUCKAPP_" + name); v != "" {
		return v
	}
	return def
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "version" {
		fmt.Println(version)
		return
	}
	// duck:if pam
	// Root helper for PAM, run by systemd per connection (deploy/systemd).
	if len(os.Args) > 1 && os.Args[1] == "pam-helper" {
		service := env("PAM_SERVICE", "duckapp")
		if len(os.Args) > 2 {
			service = os.Args[2]
		}
		if err := auth.ServeHelper(service, os.Stdin, os.Stdout); err != nil {
			os.Exit(1)
		}
		return
	}
	// duck:end
	if len(os.Args) > 1 && os.Args[1] == "serve" {
		os.Args = append(os.Args[:1], os.Args[2:]...)
	}
	var c config
	flag.StringVar(&c.listen, "listen", env("LISTEN", "127.0.0.1:8080"), "address to listen on ($DUCKAPP_LISTEN)")
	flag.StringVar(&c.db, "db", env("DB", "duckapp.db"), "SQLite file or postgres:// URL ($DUCKAPP_DB)")
	flag.StringVar(&c.proxies, "trusted-proxies", env("TRUSTED_PROXIES", ""), "reverse proxies whose X-Forwarded-* count, comma-separated ($DUCKAPP_TRUSTED_PROXIES)")
	flag.BoolVar(&c.secureCookies, "secure-cookies", env("SECURE_COOKIES", "") == "1", "always set Secure on cookies ($DUCKAPP_SECURE_COOKIES=1)")
	// duck:if auth
	flag.StringVar(&c.admin, "admin", env("ADMIN", "admin"), "first admin, created on an empty database; its password is $DUCKAPP_ADMIN_PASSWORD or printed once ($DUCKAPP_ADMIN)")
	// duck:end
	// duck:if audit
	flag.StringVar(&c.auditKey, "audit-key", env("AUDIT_KEY", ""), "hex HMAC key of the audit chain; default <db>.audit-key, created on first start ($DUCKAPP_AUDIT_KEY)")
	// duck:end
	// duck:if pam
	flag.StringVar(&c.pamService, "pam-service", env("PAM_SERVICE", "duckapp"), "PAM stack for system users, /etc/pam.d/<name> ($DUCKAPP_PAM_SERVICE)")
	flag.StringVar(&c.pamRoles, "pam-roles", env("PAM_ROLES", ""), "system users that may sign in: group:role pairs, first match wins, e.g. wheel:admin,staff:user; empty turns PAM off ($DUCKAPP_PAM_ROLES)")
	flag.BoolVar(&c.pamRoot, "pam-allow-root", env("PAM_ALLOW_ROOT", "") == "1", "let root sign in through PAM ($DUCKAPP_PAM_ALLOW_ROOT=1)")
	// duck:end
	// duck:if redis
	flag.StringVar(&c.redis, "redis", env("REDIS", ""), "redis:// URL for the shared cache and events; empty: in memory ($DUCKAPP_REDIS)")
	// duck:end
	// duck:if s3
	flag.StringVar(&c.files, "files", env("FILES", "files"), "directory for file contents when S3 is not configured ($DUCKAPP_FILES)")
	flag.StringVar(&c.s3.Endpoint, "s3-endpoint", env("S3_ENDPOINT", ""), "S3 endpoint URL; set it to keep files in a bucket ($DUCKAPP_S3_ENDPOINT)")
	flag.StringVar(&c.s3.Bucket, "s3-bucket", env("S3_BUCKET", ""), "($DUCKAPP_S3_BUCKET)")
	flag.StringVar(&c.s3.Region, "s3-region", env("S3_REGION", ""), "($DUCKAPP_S3_REGION)")
	flag.StringVar(&c.s3.Prefix, "s3-prefix", env("S3_PREFIX", ""), "key prefix inside the bucket ($DUCKAPP_S3_PREFIX)")
	flag.BoolVar(&c.s3.PathStyle, "s3-path-style", env("S3_PATH_STYLE", "") == "1", "path-style URLs, for MinIO and most self-hosted servers ($DUCKAPP_S3_PATH_STYLE=1)")
	c.s3.AccessKey, c.s3.SecretKey = os.Getenv("DUCKAPP_S3_ACCESS_KEY"), os.Getenv("DUCKAPP_S3_SECRET_KEY") // never flags: they show in ps
	// duck:end
	flag.Parse()

	if err := run(c); err != nil {
		slog.Error("duckapp", "err", err)
		os.Exit(1)
	}
}

func run(c config) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.Open(c.db)
	if err != nil {
		return fmt.Errorf("database: %w", err)
	}
	defer st.Close()

	proxies, err := server.ParseProxies(c.proxies)
	if err != nil {
		return err
	}
	srv := &server.Server{Store: st, TrustedProxies: proxies, SecureCookies: c.secureCookies, Version: version}

	// duck:if auth
	srv.Auth = &auth.Service{Store: st}
	pw, err := srv.Auth.Bootstrap(ctx, c.admin, os.Getenv("DUCKAPP_ADMIN_PASSWORD"))
	if err != nil {
		return fmt.Errorf("creating the first admin: %w", err)
	}
	if pw != "" {
		fmt.Fprintf(os.Stderr, "\n  first admin: %s\n  password:    %s\n  (shown once; change it under My account)\n\n", c.admin, pw)
	}
	go purgeSessions(ctx, srv.Auth)
	// duck:end

	// duck:if pam
	if c.pamRoles != "" {
		roles, err := parsePAMRoles(c.pamRoles)
		if err != nil {
			return err
		}
		srv.PAM = &auth.PAM{Service: srv.Auth, PAMService: c.pamService, Roles: roles, AllowRoot: c.pamRoot}
		slog.Info("system users can sign in", "mode", auth.Mode(), "roles", c.pamRoles)
	}
	// duck:end

	// duck:if redis
	cc, rdb, err := cache.Open(ctx, c.redis, "duckapp")
	if err != nil {
		return fmt.Errorf("redis: %w", err)
	}
	srv.Cache = cc
	if rdb != nil {
		defer rdb.Close()
	}
	// duck:end

	// duck:if ws|sse|eventbus
	srv.Events = events.New()
	// duck:end
	// duck:if ws|sse|eventbus redis
	if rdb != nil {
		srv.Events.UseRedis(ctx, rdb, "duckapp:events")
	}
	// duck:end

	// duck:if s3
	if c.s3.Endpoint != "" {
		s3, err := objstore.NewS3(c.s3)
		if err != nil {
			return err
		}
		if err := s3.Check(ctx); err != nil {
			return fmt.Errorf("s3: %w", err)
		}
		srv.Objects = s3
	} else {
		srv.Objects = objstore.Disk{Dir: c.files}
	}
	// duck:end

	// duck:if audit
	key, err := loadAuditKey(c)
	if err != nil {
		return fmt.Errorf("audit key: %w", err)
	}
	srv.Audit = &audit.Log{Store: st, Key: key}
	// duck:end

	hs := &http.Server{Addr: c.listen, Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		hs.Shutdown(sctx)
	}()
	slog.Info("listening", "addr", "http://"+c.listen, "version", version, "postgres", st.Postgres)
	if err := hs.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// duck:if auth
func purgeSessions(ctx context.Context, a *auth.Service) {
	t := time.NewTicker(10 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if _, err := a.PurgeExpired(ctx); err != nil {
				slog.Warn("purging sessions", "err", err)
			}
		}
	}
}

// duck:end

// duck:if pam
func parsePAMRoles(list string) ([]auth.GroupRole, error) {
	var out []auth.GroupRole
	for _, pair := range strings.Split(list, ",") {
		g, r, ok := strings.Cut(strings.TrimSpace(pair), ":")
		if !ok || g == "" || r == "" {
			return nil, fmt.Errorf("pam roles: %q is not group:role", pair)
		}
		out = append(out, auth.GroupRole{Group: g, Role: r})
	}
	return out, nil
}

// duck:end

// duck:if audit
// loadAuditKey reads the key from the flag, or from a file beside the SQLite
// database, created with a random key on first start. PostgreSQL has no file
// beside it, so the key must be given.
func loadAuditKey(c config) ([]byte, error) {
	if c.auditKey != "" {
		return hex.DecodeString(c.auditKey)
	}
	if store.IsPostgres(c.db) {
		return nil, errors.New("set -audit-key ($DUCKAPP_AUDIT_KEY) with PostgreSQL")
	}
	path := c.db + ".audit-key"
	if b, err := os.ReadFile(path); err == nil {
		return hex.DecodeString(strings.TrimSpace(string(b)))
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	key := make([]byte, 32)
	rand.Read(key)
	if err := os.WriteFile(path, []byte(hex.EncodeToString(key)+"\n"), 0o600); err != nil {
		return nil, err
	}
	slog.Info("created the audit key; back it up with the database", "path", path)
	return key, nil
}

// duck:end
