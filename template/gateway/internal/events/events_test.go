// duck:file ws|sse|eventbus
package events

import (
	"context"
	"sync"
	"testing"
)

func TestFanOut(t *testing.T) {
	b := New()
	a, endA := b.Subscribe()
	c, endC := b.Subscribe()
	defer endC()
	b.Publish(context.Background(), "note.changed", "n1")
	for _, ch := range []<-chan Event{a, c} {
		if ev := <-ch; ev.Type != "note.changed" || ev.ID != "n1" {
			t.Fatalf("got %+v", ev)
		}
	}
	endA()
	b.Publish(context.Background(), "note.changed", "n2")
	if ev := <-c; ev.ID != "n2" {
		t.Fatalf("got %+v", ev)
	}
	select {
	case ev := <-a:
		t.Fatalf("ended subscription got %+v", ev)
	default:
	}
}

func TestObserverOn(t *testing.T) {
	b := New()
	var wg sync.WaitGroup
	wg.Add(1)

	var received Event
	unsub := b.On("order.", func(ev Event) {
		received = ev
		wg.Done()
	})
	defer unsub()

	// Non-matching event
	b.Publish(context.Background(), "user.created", "u1")

	// Matching event
	b.PublishEvent(context.Background(), Event{
		Type: "order.placed",
		ID:   "ord_123",
		Data: map[string]int{"total": 99},
	})

	wg.Wait()
	if received.Type != "order.placed" || received.ID != "ord_123" {
		t.Fatalf("expected order.placed event, got %+v", received)
	}
	data, ok := received.Data.(map[string]int)
	if !ok || data["total"] != 99 {
		t.Fatalf("expected data with total=99, got %+v", received.Data)
	}
}
