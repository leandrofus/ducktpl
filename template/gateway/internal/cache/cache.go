// duck:file redis
// Package cache keeps short-lived copies of expensive reads: in Redis when
// one is configured (shared by every gateway, so invalidations reach all of
// them), else in process memory.
package cache

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

type Cache interface {
	// GetJSON decodes the value at key into v; false when missing.
	GetJSON(ctx context.Context, key string, v any) bool
	SetJSON(ctx context.Context, key string, v any, ttl time.Duration)
	// DeletePrefix drops every key starting with prefix.
	DeletePrefix(ctx context.Context, prefix string)
}

// Open returns a Redis cache for a redis:// URL, or a memory one for "".
// The client is returned too, for other users of the same server (events).
func Open(ctx context.Context, url, namespace string) (Cache, *redis.Client, error) {
	if url == "" {
		return NewMemory(), nil, nil
	}
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, nil, err
	}
	rdb := redis.NewClient(opt)
	if err := rdb.Ping(ctx).Err(); err != nil {
		rdb.Close()
		return nil, nil, err
	}
	return &Redis{rdb: rdb, ns: namespace + ":"}, rdb, nil
}

// ---- memory ----

type entry struct {
	b   []byte
	exp time.Time
}

type Memory struct {
	mu sync.Mutex
	m  map[string]entry
}

func NewMemory() *Memory { return &Memory{m: map[string]entry{}} }

func (c *Memory) GetJSON(_ context.Context, key string, v any) bool {
	c.mu.Lock()
	e, ok := c.m[key]
	c.mu.Unlock()
	if !ok || time.Now().After(e.exp) {
		return false
	}
	return json.Unmarshal(e.b, v) == nil
}

func (c *Memory) SetJSON(_ context.Context, key string, v any, ttl time.Duration) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	for k, e := range c.m { // keep it small: drop expired entries on write
		if now.After(e.exp) {
			delete(c.m, k)
		}
	}
	c.m[key] = entry{b, now.Add(ttl)}
}

func (c *Memory) DeletePrefix(_ context.Context, prefix string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for k := range c.m {
		if strings.HasPrefix(k, prefix) {
			delete(c.m, k)
		}
	}
}

// ---- redis ----

type Redis struct {
	rdb *redis.Client
	ns  string
}

// Failures are logged and treated as misses: the cache is never the source
// of truth.

func (c *Redis) GetJSON(ctx context.Context, key string, v any) bool {
	b, err := c.rdb.Get(ctx, c.ns+key).Bytes()
	if err != nil {
		if err != redis.Nil {
			slog.Warn("cache get", "key", key, "err", err)
		}
		return false
	}
	return json.Unmarshal(b, v) == nil
}

func (c *Redis) SetJSON(ctx context.Context, key string, v any, ttl time.Duration) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	if err := c.rdb.Set(ctx, c.ns+key, b, ttl).Err(); err != nil {
		slog.Warn("cache set", "key", key, "err", err)
	}
}

func (c *Redis) DeletePrefix(ctx context.Context, prefix string) {
	iter := c.rdb.Scan(ctx, 0, c.ns+prefix+"*", 100).Iterator()
	var keys []string
	for iter.Next(ctx) {
		keys = append(keys, iter.Val())
	}
	if err := iter.Err(); err != nil {
		slog.Warn("cache scan", "prefix", prefix, "err", err)
	}
	if len(keys) > 0 {
		if err := c.rdb.Del(ctx, keys...).Err(); err != nil {
			slog.Warn("cache delete", "prefix", prefix, "err", err)
		}
	}
}
