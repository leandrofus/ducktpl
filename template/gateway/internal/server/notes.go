package server

import (
	"net/http"
	"strings"
	"time"

	// duck:if auth
	"github.com/duckowner/duckapp/gateway/internal/auth"
	// duck:end

	"github.com/duckowner/duckapp/gateway/internal/store"
	"github.com/duckowner/duckapp/gateway/internal/store/db"
)

// Notes are the example resource: one table, its queries, these handlers
// and web/src/pages/Notes.tsx. Copy the shape for your own resources, then
// delete them.
//
// The flow for any new endpoint:
//   1. migration in both engines + query in internal/store/queries
//   2. handler here with its openapi:operation block, DTOs with openapi:schema
//   3. route in Server.Handler with its access rule
//   4. make generate (sqlc, openapi.yaml, web/src/lib/api-types.ts)

// openapi:schema Note
// type: object
// required: [id, title, body, pinned, created_at, updated_at]
// properties:
//   id: { type: string, format: uuid }
//   title: { type: string }
//   body: { type: string }
//   pinned: { type: boolean }
//   created_at: { type: string, format: date-time }
//   updated_at: { type: string, format: date-time }

type noteDTO struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	Pinned    bool      `json:"pinned"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func toNote(n db.Note) noteDTO {
	return noteDTO{ID: n.ID, Title: n.Title, Body: n.Body, Pinned: n.Pinned, CreatedAt: n.CreatedAt.UTC(), UpdatedAt: n.UpdatedAt.UTC()}
}

// openapi:schema PaginatedNotes
// type: object
// required: [items, total, page, per_page]
// properties:
//   items: { type: array, items: { $ref: '#/components/schemas/Note' } }
//   total: { type: integer }
//   page: { type: integer }
//   per_page: { type: integer }

type paginatedNotes struct {
	Items   []noteDTO `json:"items"`
	Total   int       `json:"total"`
	Page    int       `json:"page"`
	PerPage int       `json:"per_page"`
}

// openapi:schema CreateNoteRequest
// type: object
// required: [title]
// additionalProperties: false
// properties:
//   title: { type: string, minLength: 1, maxLength: 200 }
//   body: { type: string }
//   pinned: { type: boolean }

type createNoteRequest struct {
	Title  string `json:"title"`
	Body   string `json:"body"`
	Pinned bool   `json:"pinned"`
}

// openapi:schema UpdateNoteRequest
// type: object
// additionalProperties: false
// properties:
//   title: { type: string, minLength: 1, maxLength: 200 }
//   body: { type: string }
//   pinned: { type: boolean }

type updateNoteRequest struct {
	Title  opt[string] `json:"title"`
	Body   opt[string] `json:"body"`
	Pinned opt[bool]   `json:"pinned"`
}

// Without the auth module there are no permissions; the names stay so the
// handlers read the same either way.
const (
	// duck:if auth
	permNotesRead  = auth.PermNotesRead
	permNotesWrite = auth.PermNotesWrite
	// duck:else
	// permNotesRead  = "notes.read"
	// permNotesWrite = "notes.write"
	// duck:end
)

func validTitle(t string) (string, error) {
	t = strings.TrimSpace(t)
	if t == "" || len([]rune(t)) > 200 {
		return "", badRequest("title must have 1 to 200 characters")
	}
	return t, nil
}

// openapi:operation
// summary: List notes
// description: Pinned first, then the most recently updated.
// parameters:
//   - { name: page, in: query, schema: { type: integer, default: 1 } }
//   - { name: per_page, in: query, schema: { type: integer, default: 50 } }
// responses:
//   '200': { description: Notes, schema: PaginatedNotes }

func (s *Server) listNotes(w http.ResponseWriter, r *http.Request, p principal) error {
	all, ids, err := s.visible(r, p, permNotesRead, "note")
	if err != nil {
		return err
	}
	page, perPage, offset := pageParams(r)
	total, err := s.Store.Q.CountNotes(r.Context())
	if err != nil {
		return err
	}
	ns, err := s.Store.Q.ListNotes(r.Context(), db.ListNotesParams{LimCount: int64(perPage), LimOffset: int64(offset)})
	if err != nil {
		return err
	}
	out := make([]noteDTO, 0, len(ns))
	for _, n := range ns {
		if all || ids[n.ID] {
			out = append(out, toNote(n))
		}
	}
	tot := int(total)
	if !all {
		tot = len(out)
	}
	return ok(w, paginatedNotes{Items: out, Total: tot, Page: page, PerPage: perPage})
}

// allNotes reads up to 100 notes, through the cache when there is one.
func (s *Server) allNotes(r *http.Request) ([]noteDTO, error) {
	// duck:if redis
	var cached []noteDTO
	if s.Cache.GetJSON(r.Context(), "note:all", &cached) {
		return cached, nil
	}
	// duck:end
	ns, err := s.Store.Q.ListNotes(r.Context(), db.ListNotesParams{LimCount: 100, LimOffset: 0})
	if err != nil {
		return nil, err
	}
	out := make([]noteDTO, 0, len(ns))
	for _, n := range ns {
		out = append(out, toNote(n))
	}
	// duck:if redis
	s.Cache.SetJSON(r.Context(), "note:all", out, time.Minute)
	// duck:end
	return out, nil
}

// openapi:operation
// summary: Get a note
// responses:
//   '200': { description: The note, schema: Note }

func (s *Server) getNote(w http.ResponseWriter, r *http.Request, p principal) error {
	id := r.PathValue("id")
	if err := s.allow(r, p, permNotesRead, "note", id); err != nil {
		return err
	}
	n, err := s.Store.Q.GetNote(r.Context(), id)
	if err != nil {
		return fromStore(err, "note")
	}
	return ok(w, toNote(n))
}

// openapi:operation
// summary: Create a note
// requestBody: { schema: CreateNoteRequest }
// responses:
//   '201': { description: Created, schema: Note }
//   '409': Error

func (s *Server) createNote(w http.ResponseWriter, r *http.Request, p principal) error {
	return handleCreated(w, r, func(req createNoteRequest) (noteDTO, error) {
		title, err := validTitle(req.Title)
		if err != nil {
			return noteDTO{}, err
		}
		id := store.NewID()
		err = s.Store.Q.CreateNote(r.Context(), db.CreateNoteParams{ID: id, Title: title, Body: req.Body, Pinned: req.Pinned, Now: store.Now()})
		if err != nil {
			return noteDTO{}, fromStore(err, "note")
		}
		n, err := s.Store.Q.GetNote(r.Context(), id)
		if err != nil {
			return noteDTO{}, err
		}
		s.record(r, p, "note.create", "note", id, map[string]any{"title": title})
		s.changed(r, "note", id)
		return toNote(n), nil
	})
}

// openapi:operation
// summary: Update a note
// description: Only the fields present change.
// requestBody: { schema: UpdateNoteRequest }
// responses:
//   '200': { description: Updated, schema: Note }
//   '409': Error

func (s *Server) updateNote(w http.ResponseWriter, r *http.Request, p principal) error {
	return handleAction(w, r, func(req updateNoteRequest) (noteDTO, error) {
		id := r.PathValue("id")
		if err := s.allow(r, p, permNotesWrite, "note", id); err != nil {
			return noteDTO{}, err
		}
		var out db.Note
		err := s.Store.Tx(r.Context(), func(q *db.Queries) error {
			n, err := q.GetNote(r.Context(), id)
			if err != nil {
				return fromStore(err, "note")
			}
			if req.Title.Set {
				if n.Title, err = validTitle(req.Title.V); err != nil {
					return err
				}
			}
			if req.Body.Set {
				n.Body = req.Body.V
			}
			if req.Pinned.Set {
				n.Pinned = req.Pinned.V
			}
			if err := q.UpdateNote(r.Context(), db.UpdateNoteParams{ID: id, Title: n.Title, Body: n.Body, Pinned: n.Pinned, Now: store.Now()}); err != nil {
				return fromStore(err, "note")
			}
			out, err = q.GetNote(r.Context(), id)
			return err
		})
		if err != nil {
			return noteDTO{}, err
		}
		s.record(r, p, "note.update", "note", id, nil)
		s.changed(r, "note", id)
		return toNote(out), nil
	})
}

// openapi:operation
// summary: Delete a note
// responses:
//   '204': { description: Deleted }

func (s *Server) deleteNote(w http.ResponseWriter, r *http.Request, p principal) error {
	id := r.PathValue("id")
	if err := s.allow(r, p, permNotesWrite, "note", id); err != nil {
		return err
	}
	return handleCommand(w, func() error {
		// duck:if s3
		if err := s.deleteNoteFiles(r, id); err != nil {
			return err
		}
		// duck:end
		// duck:if rbac
		if err := s.Store.Q.DeleteObjectGrants(r.Context(), db.DeleteObjectGrantsParams{ObjectType: "note", ObjectID: id}); err != nil {
			return err
		}
		// duck:end
		// ducktpl:on-delete note (before the row goes: what references it)
		n, err := s.Store.Q.DeleteNote(r.Context(), id)
		if err != nil {
			return err
		}
		if n == 0 {
			return notFound("note")
		}
		s.record(r, p, "note.delete", "note", id, nil)
		s.changed(r, "note", id)
		// ducktpl:on-deleted note
		return nil
	})
}
