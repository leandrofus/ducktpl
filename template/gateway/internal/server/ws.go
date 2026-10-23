// duck:file ws
package server

import (
	"context"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// openapi:operation
// summary: Live events over WebSocket
// description: >-
//   Upgrades to a WebSocket that streams {type, id} events (e.g.
//   note.changed) as JSON text messages. Refetch the object through the API.
// tags: [live]
// responses:
//   '101': { description: Switching to the WebSocket protocol }

func (s *Server) websocket(w http.ResponseWriter, r *http.Request, p principal) error {
	// Accept checks that Origin matches Host: other sites cannot open it with
	// the user's cookie.
	c, err := websocket.Accept(w, r, nil)
	if err != nil {
		return nil // Accept already answered
	}
	defer c.CloseNow()
	events, done := s.Events.Subscribe()
	defer done()
	// The client sends nothing; CloseRead handles its pings and close.
	ctx := c.CloseRead(r.Context())
	ping := time.NewTicker(30 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case ev := <-events:
			wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := wsjson.Write(wctx, c, ev)
			cancel()
			if err != nil {
				return nil
			}
		case <-ping.C:
			if err := c.Ping(ctx); err != nil {
				return nil
			}
		}
	}
}
