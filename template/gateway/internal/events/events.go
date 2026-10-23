// duck:file ws|sse
// Package events fans changes out to live clients (WebSocket, SSE). In one
// gateway it is in-process; with Redis every gateway sharing the database
// publishes to and listens on one channel, so a change made through any of
// them reaches every client.
package events

import (
	"context"
	// duck:if redis
	"encoding/json"
	"log/slog"
	// duck:end
	"sync"

	// duck:if redis
	"github.com/redis/go-redis/v9"
	// duck:end
)

// Event says that something changed. It carries ids only: clients refetch
// through the API, which applies permissions.
type Event struct {
	Type string `json:"type"` // e.g. note.changed
	ID   string `json:"id,omitempty"`
}

type Bus struct {
	mu   sync.Mutex
	subs map[chan Event]struct{}
	// duck:if redis
	rdb     *redis.Client
	channel string
	// duck:end
}

func New() *Bus { return &Bus{subs: map[chan Event]struct{}{}} }

// Publish delivers an event to every subscriber (of every gateway, with
// Redis). It never blocks: a subscriber too slow to keep up misses events.
func (b *Bus) Publish(ctx context.Context, typ, id string) {
	ev := Event{Type: typ, ID: id}
	// duck:if redis
	if b.rdb != nil {
		msg, _ := json.Marshal(ev)
		if err := b.rdb.Publish(ctx, b.channel, msg).Err(); err != nil {
			slog.Warn("events: redis publish", "err", err)
			b.deliver(ev) // at least this gateway's clients
		}
		return
	}
	// duck:end
	b.deliver(ev)
}

func (b *Bus) deliver(ev Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		select {
		case ch <- ev:
		default:
		}
	}
}

// Subscribe returns a channel of events and the function that ends the
// subscription.
func (b *Bus) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, 64)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		delete(b.subs, ch)
		b.mu.Unlock()
	}
}

// duck:if redis
// UseRedis routes events through a Redis channel until ctx ends.
func (b *Bus) UseRedis(ctx context.Context, rdb *redis.Client, channel string) {
	b.rdb, b.channel = rdb, channel
	sub := rdb.Subscribe(ctx, channel)
	go func() {
		defer sub.Close()
		for msg := range sub.Channel() {
			var ev Event
			if json.Unmarshal([]byte(msg.Payload), &ev) == nil {
				b.deliver(ev)
			}
		}
	}()
}

// duck:end
