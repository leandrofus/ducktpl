// duck:file ws|sse
package events

import (
	"context"
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
