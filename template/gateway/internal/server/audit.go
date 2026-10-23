// duck:file audit
package server

import (
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/duckowner/duckapp/gateway/internal/audit"
	"github.com/duckowner/duckapp/gateway/internal/store/db"
)

// openapi:schema AuditEvent
// type: object
// required: [seq, actor_id, actor_username, actor_ip, action, target_type, target_id, details, created_at]
// properties:
//   seq: { type: integer, format: int64 }
//   actor_id: { type: string }
//   actor_username: { type: string }
//   actor_ip: { type: string }
//   action: { type: string, description: 'verb.object, e.g. note.create' }
//   target_type: { type: string }
//   target_id: { type: string }
//   details: { type: object, additionalProperties: true }
//   created_at: { type: string, format: date-time }

type auditEventDTO struct {
	Seq           int64     `json:"seq"`
	ActorID       string    `json:"actor_id"`
	ActorUsername string    `json:"actor_username"`
	ActorIP       string    `json:"actor_ip"`
	Action        string    `json:"action"`
	TargetType    string    `json:"target_type"`
	TargetID      string    `json:"target_id"`
	Details       rawJSON   `json:"details"`
	CreatedAt     time.Time `json:"created_at"`
}

// rawJSON embeds stored JSON text as is.
type rawJSON string

func (j rawJSON) MarshalJSON() ([]byte, error) { return []byte(j), nil }

// openapi:operation
// summary: Audit log
// description: Newest first. Pass the last seq of a page as before for the next one.
// parameters:
//   - { name: before, in: query, schema: { type: integer, format: int64 } }
//   - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 500, default: 100 } }
// responses:
//   '200': { description: Events, schema: '[]AuditEvent' }

func (s *Server) listAudit(w http.ResponseWriter, r *http.Request, p principal) error {
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	limit, _ := strconv.ParseInt(r.URL.Query().Get("limit"), 10, 64)
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	evs, err := s.Store.Q.ListAuditEvents(r.Context(), db.ListAuditEventsParams{Before: before, Lim: limit})
	if err != nil {
		return err
	}
	out := make([]auditEventDTO, 0, len(evs))
	for _, e := range evs {
		out = append(out, auditEventDTO{
			Seq: e.Seq, ActorID: e.ActorID, ActorUsername: e.ActorUsername, ActorIP: e.ActorIP, Action: e.Action,
			TargetType: e.TargetType, TargetID: e.TargetID, Details: rawJSON(e.Details), CreatedAt: e.CreatedAt.UTC(),
		})
	}
	return ok(w, out)
}

// openapi:schema AuditVerification
// type: object
// required: [events, valid]
// properties:
//   events: { type: integer, format: int64, description: Events checked. }
//   valid: { type: boolean }
//   error: { type: string, description: The first break; absent when valid. }

// openapi:operation
// summary: Verify the audit chain
// description: Recomputes every hash; slow on large logs.
// responses:
//   '200': { description: Result, schema: AuditVerification }

func (s *Server) verifyAudit(w http.ResponseWriter, r *http.Request, p principal) error {
	v, err := s.Audit.Verify(r.Context())
	if err != nil {
		return err
	}
	return ok(w, v)
}

func (s *Server) recordAudit(r *http.Request, ip, id, username, action, targetType, targetID string, details any) {
	if s.Audit == nil {
		return
	}
	err := s.Audit.Record(r.Context(), audit.Event{
		Actor: audit.Actor{ID: id, Username: username, IP: ip}, Action: action, TargetType: targetType, TargetID: targetID, Details: details,
	})
	if err != nil {
		slog.Error("audit", "action", action, "err", err)
	}
}
