// duck:file audit
package audit

import (
	"context"
	"testing"

	"github.com/duckowner/duckapp/gateway/internal/store"
)

func TestChain(t *testing.T) {
	s, closeDB, err := store.OpenTemp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer closeDB()
	ctx := context.Background()
	l := &Log{Store: s, Key: []byte("test-key")}
	for i, action := range []string{"note.create", "note.update", "note.delete"} {
		if err := l.Record(ctx, Event{Actor: Actor{Username: "ana", IP: "10.0.0.1"}, Action: action, TargetID: "n1", Details: map[string]any{"i": i}}); err != nil {
			t.Fatal(err)
		}
	}
	v, err := l.Verify(ctx)
	if err != nil || !v.Valid || v.Events != 3 {
		t.Fatalf("fresh chain: %+v %v", v, err)
	}

	// Another key cannot vouch for the chain.
	v, _ = (&Log{Store: s, Key: []byte("other")}).Verify(ctx)
	if v.Valid {
		t.Fatal("chain verified with the wrong key")
	}

	// The table refuses edits.
	if _, err := s.DB.Exec(`UPDATE audit_events SET action = 'x' WHERE seq = 2`); err == nil {
		t.Fatal("audit_events accepted an UPDATE")
	}
}
