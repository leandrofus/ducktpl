// duck:file audit
// Package audit keeps a tamper-evident log: every event's hash is
// HMAC-SHA256(key, prev_hash || canonical JSON of the event), so editing,
// deleting or reordering rows breaks the chain, and without the key nobody
// can forge a valid one. The table is append-only in both engines.
package audit

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/duckowner/duckapp/gateway/internal/store"
	"github.com/duckowner/duckapp/gateway/internal/store/db"
)

var GenesisHash = strings.Repeat("0", 64)

type Log struct {
	Store *store.Store
	Key   []byte
}

type Actor struct {
	ID       string
	Username string
	IP       string
}

type Event struct {
	Actor      Actor
	Action     string // verb.object, e.g. note.create
	TargetType string
	TargetID   string
	Details    any
}

// canonical is what the hash covers; field order is fixed by the struct.
type canonical struct {
	TS         string          `json:"ts"`
	Seq        int64           `json:"seq"`
	ActorID    string          `json:"actor_id"`
	ActorName  string          `json:"actor_name"`
	ActorIP    string          `json:"actor_ip"`
	Action     string          `json:"action"`
	TargetType string          `json:"target_type"`
	TargetID   string          `json:"target_id"`
	Details    json.RawMessage `json:"details"`
}

// canonicalJSON re-encodes details so the stored text and the hashed text
// are byte-identical (sorted keys, no insignificant space).
func canonicalJSON(raw []byte) ([]byte, error) {
	if len(raw) == 0 {
		return []byte("{}"), nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	return json.Marshal(v)
}

func (l *Log) hash(prev string, c canonical) (string, error) {
	b, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	m := hmac.New(sha256.New, l.Key)
	m.Write([]byte(prev))
	m.Write(b)
	return hex.EncodeToString(m.Sum(nil)), nil
}

// Record appends ev to the chain. The latest event is read and the new one
// written in one transaction, which the store serializes on both engines.
func (l *Log) Record(ctx context.Context, ev Event) error {
	raw := []byte("{}")
	if ev.Details != nil {
		b, err := json.Marshal(ev.Details)
		if err != nil {
			return fmt.Errorf("audit: details: %w", err)
		}
		raw = b
	}
	details, err := canonicalJSON(raw)
	if err != nil {
		return fmt.Errorf("audit: details: %w", err)
	}
	now := store.Now()
	return l.Store.Tx(ctx, func(q *db.Queries) error {
		prev, seq := GenesisHash, int64(1)
		latest, err := q.LatestAuditEvent(ctx)
		switch {
		case err == nil:
			prev, seq = latest.Hash, latest.Seq+1
		case !errors.Is(store.Classify(err), store.ErrNotFound):
			return fmt.Errorf("audit: latest event: %w", err)
		}
		c := canonical{
			TS: store.TS(now), Seq: seq, ActorID: ev.Actor.ID, ActorName: ev.Actor.Username, ActorIP: ev.Actor.IP,
			Action: ev.Action, TargetType: ev.TargetType, TargetID: ev.TargetID, Details: details,
		}
		h, err := l.hash(prev, c)
		if err != nil {
			return err
		}
		return q.InsertAuditEvent(ctx, db.InsertAuditEventParams{
			Seq: seq, ActorID: c.ActorID, ActorUsername: c.ActorName, ActorIP: c.ActorIP,
			Action: c.Action, TargetType: c.TargetType, TargetID: c.TargetID, Details: string(details),
			PrevHash: prev, Hash: h, CreatedAt: now,
		})
	})
}

type Verification struct {
	Events int64  `json:"events"`
	Valid  bool   `json:"valid"`
	Error  string `json:"error,omitempty"`
}

// verifyPage bounds memory while walking the chain.
const verifyPage = 5000

// Verify walks the whole chain and reports the first break.
func (l *Log) Verify(ctx context.Context) (Verification, error) {
	prev, last, total := GenesisHash, int64(0), int64(0)
	for {
		page, err := l.Store.Q.AuditEventsAfter(ctx, db.AuditEventsAfterParams{After: last, Lim: verifyPage})
		if err != nil {
			return Verification{}, err
		}
		for _, e := range page {
			total++
			fail := func(format string, a ...any) (Verification, error) {
				return Verification{Events: total, Error: fmt.Sprintf(format, a...)}, nil
			}
			if e.Seq != last+1 {
				return fail("sequence gap after %d (got %d)", last, e.Seq)
			}
			if e.PrevHash != prev {
				return fail("chain broken at %d: prev_hash does not match", e.Seq)
			}
			h, err := l.hash(e.PrevHash, canonical{
				TS: store.TS(e.CreatedAt), Seq: e.Seq, ActorID: e.ActorID, ActorName: e.ActorUsername, ActorIP: e.ActorIP,
				Action: e.Action, TargetType: e.TargetType, TargetID: e.TargetID, Details: json.RawMessage(e.Details),
			})
			if err != nil {
				return Verification{}, err
			}
			if !hmac.Equal([]byte(h), []byte(e.Hash)) {
				return fail("event %d was modified", e.Seq)
			}
			prev, last = e.Hash, e.Seq
		}
		if len(page) < verifyPage {
			return Verification{Events: total, Valid: true}, nil
		}
	}
}
