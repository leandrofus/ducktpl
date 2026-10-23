// duck:file redis
package cache

import (
	"context"
	"os"
	"testing"
	"time"
)

func exercise(t *testing.T, c Cache) {
	ctx := context.Background()
	c.SetJSON(ctx, "note:list", []string{"a"}, time.Minute)
	c.SetJSON(ctx, "user:1", 1, time.Minute)
	var got []string
	if !c.GetJSON(ctx, "note:list", &got) || len(got) != 1 {
		t.Fatalf("miss after set: %v", got)
	}
	c.DeletePrefix(ctx, "note:")
	if c.GetJSON(ctx, "note:list", &got) {
		t.Fatal("hit after DeletePrefix")
	}
	var n int
	if !c.GetJSON(ctx, "user:1", &n) {
		t.Fatal("DeletePrefix dropped another prefix")
	}
	c.DeletePrefix(ctx, "user:")
}

func TestMemory(t *testing.T) { exercise(t, NewMemory()) }

// DUCKAPP_TEST_REDIS=redis://127.0.0.1:6379/15 runs it against Redis.
func TestRedis(t *testing.T) {
	url := os.Getenv("DUCKAPP_TEST_REDIS")
	if url == "" {
		t.Skip("DUCKAPP_TEST_REDIS not set")
	}
	c, rdb, err := Open(context.Background(), url, "duckapp-test")
	if err != nil {
		t.Fatal(err)
	}
	defer rdb.Close()
	exercise(t, c)
}
