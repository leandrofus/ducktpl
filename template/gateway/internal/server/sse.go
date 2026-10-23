// duck:file sse
package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// openapi:operation
// summary: Live events over Server-Sent Events
// description: >-
//   A text/event-stream of {type, id} events (e.g. note.changed), each
//   named after its type. Refetch the object through the API.
// tags: [live]
// responses:
//   '200':
//     description: The stream
//     content:
//       text/event-stream: { schema: { type: string } }

func (s *Server) eventStream(w http.ResponseWriter, r *http.Request, p principal) error {
	fl, ok := w.(http.Flusher)
	if !ok {
		return fmt.Errorf("streaming unsupported")
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no") // nginx: do not buffer the stream
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "retry: 3000\n\n")
	fl.Flush()

	events, done := s.Events.Subscribe()
	defer done()
	beat := time.NewTicker(25 * time.Second) // keeps proxies from closing it
	defer beat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return nil
		case ev := <-events:
			b, _ := json.Marshal(ev)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, b)
			fl.Flush()
		case <-beat.C:
			fmt.Fprint(w, ": beat\n\n")
			fl.Flush()
		}
	}
}
