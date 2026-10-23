// duck:file s3
package server

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/duckowner/duckapp/gateway/internal/objstore"
	"github.com/duckowner/duckapp/gateway/internal/store"
	"github.com/duckowner/duckapp/gateway/internal/store/db"
)

// MaxFileSize bounds one upload.
const MaxFileSize = 100 << 20

// openapi:schema File
// type: object
// required: [id, note_id, name, content_type, size, created_at]
// properties:
//   id: { type: string, format: uuid }
//   note_id: { type: string, format: uuid }
//   name: { type: string }
//   content_type: { type: string }
//   size: { type: integer, format: int64 }
//   created_at: { type: string, format: date-time }

type fileDTO struct {
	ID          string    `json:"id"`
	NoteID      string    `json:"note_id"`
	Name        string    `json:"name"`
	ContentType string    `json:"content_type"`
	Size        int64     `json:"size"`
	CreatedAt   time.Time `json:"created_at"`
}

func toFile(f db.File) fileDTO {
	return fileDTO{ID: f.ID, NoteID: f.NoteID, Name: f.Name, ContentType: f.ContentType, Size: f.Size, CreatedAt: f.CreatedAt.UTC()}
}

func fileKey(id string) string { return "files/" + id }

// openapi:operation
// summary: List a note's files
// tags: [files]
// responses:
//   '200': { description: Files, schema: '[]File' }

func (s *Server) listFiles(w http.ResponseWriter, r *http.Request, p principal) error {
	id := r.PathValue("id")
	if err := s.allow(r, p, permNotesRead, "note", id); err != nil {
		return err
	}
	fs, err := s.Store.Q.ListNoteFiles(r.Context(), id)
	if err != nil {
		return err
	}
	out := make([]fileDTO, 0, len(fs))
	for _, f := range fs {
		out = append(out, toFile(f))
	}
	return ok(w, out)
}

// openapi:operation
// summary: Attach a file to a note
// description: The body is the raw file; its name goes in the query.
// tags: [files]
// parameters:
//   - { name: name, in: query, required: true, schema: { type: string } }
// requestBody:
//   content:
//     application/octet-stream: { schema: { type: string, format: binary } }
// responses:
//   '201': { description: Stored, schema: File }
//   '413': { description: Larger than the limit }

func (s *Server) uploadFile(w http.ResponseWriter, r *http.Request, p principal) error {
	noteID := r.PathValue("id")
	if err := s.allow(r, p, permNotesWrite, "note", noteID); err != nil {
		return err
	}
	if _, err := s.Store.Q.GetNote(r.Context(), noteID); err != nil {
		return fromStore(err, "note")
	}
	name := path.Base(strings.ReplaceAll(r.URL.Query().Get("name"), "\\", "/"))
	if name == "" || name == "." || name == "/" || len(name) > 255 {
		return badRequest("a file name is required")
	}
	if r.ContentLength > MaxFileSize {
		return &apiError{http.StatusRequestEntityTooLarge, "too_large", fmt.Sprintf("files are limited to %d MB", MaxFileSize>>20)}
	}
	ctype := r.Header.Get("Content-Type")
	if ctype == "" || ctype == "application/octet-stream" {
		if t := mime.TypeByExtension(path.Ext(name)); t != "" {
			ctype = t
		} else {
			ctype = "application/octet-stream"
		}
	}
	id := store.NewID()
	body := &countingReader{r: http.MaxBytesReader(w, r.Body, MaxFileSize)}
	if err := s.Objects.Put(r.Context(), fileKey(id), body, r.ContentLength, ctype); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return &apiError{http.StatusRequestEntityTooLarge, "too_large", fmt.Sprintf("files are limited to %d MB", MaxFileSize>>20)}
		}
		return err
	}
	f := db.File{ID: id, NoteID: noteID, Name: name, ContentType: ctype, Size: body.n, CreatedAt: store.Now()}
	err := s.Store.Q.CreateFile(r.Context(), db.CreateFileParams{ID: f.ID, NoteID: f.NoteID, Name: f.Name, ContentType: f.ContentType, Size: f.Size, Now: f.CreatedAt})
	if err != nil {
		s.Objects.Delete(r.Context(), fileKey(id))
		return fromStore(err, "file")
	}
	s.record(r, p, "file.upload", "note", noteID, map[string]any{"file": id, "name": name, "size": f.Size})
	s.changed(r, "note", noteID)
	return created(w, toFile(f))
}

type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(b []byte) (int, error) {
	n, err := c.r.Read(b)
	c.n += int64(n)
	return n, err
}

// openapi:operation
// summary: Download a file
// tags: [files]
// responses:
//   '200':
//     description: The file
//     content:
//       application/octet-stream: { schema: { type: string, format: binary } }

func (s *Server) downloadFile(w http.ResponseWriter, r *http.Request, p principal) error {
	f, err := s.Store.Q.GetFile(r.Context(), r.PathValue("id"))
	if err != nil {
		return fromStore(err, "file")
	}
	if err := s.allow(r, p, permNotesRead, "note", f.NoteID); err != nil {
		return err
	}
	rc, err := s.Objects.Open(r.Context(), fileKey(f.ID))
	if errors.Is(err, objstore.ErrNotFound) {
		return &apiError{http.StatusGone, "gone", "the file contents are missing from storage"}
	}
	if err != nil {
		return err
	}
	defer rc.Close()
	h := w.Header()
	h.Set("Content-Type", f.ContentType)
	h.Set("Content-Length", strconv.FormatInt(f.Size, 10))
	h.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": f.Name}))
	// Never rendered as a page of this origin, whatever the stored type says.
	h.Set("Content-Security-Policy", "sandbox")
	io.Copy(w, rc)
	return nil
}

// openapi:operation
// summary: Delete a file
// tags: [files]
// responses:
//   '204': { description: Deleted }

func (s *Server) deleteFile(w http.ResponseWriter, r *http.Request, p principal) error {
	f, err := s.Store.Q.GetFile(r.Context(), r.PathValue("id"))
	if err != nil {
		return fromStore(err, "file")
	}
	if err := s.allow(r, p, permNotesWrite, "note", f.NoteID); err != nil {
		return err
	}
	return handleCommand(w, func() error {
		if _, err := s.Store.Q.DeleteFile(r.Context(), f.ID); err != nil {
			return err
		}
		if err := s.Objects.Delete(r.Context(), fileKey(f.ID)); err != nil {
			return err
		}
		s.record(r, p, "file.delete", "note", f.NoteID, map[string]any{"file": f.ID, "name": f.Name})
		s.changed(r, "note", f.NoteID)
		return nil
	})
}

// deleteNoteFiles removes a note's file contents before the rows cascade.
func (s *Server) deleteNoteFiles(r *http.Request, noteID string) error {
	fs, err := s.Store.Q.ListNoteFiles(r.Context(), noteID)
	if err != nil {
		return err
	}
	for _, f := range fs {
		if err := s.Objects.Delete(r.Context(), fileKey(f.ID)); err != nil {
			return err
		}
	}
	return nil
}
