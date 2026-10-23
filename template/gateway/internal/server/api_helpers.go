package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/duckowner/duckapp/gateway/internal/store"
)

type apiError struct {
	Status  int
	Code    string
	Message string
}

func (e *apiError) Error() string { return e.Message }

var (
	errUnauthorized = &apiError{http.StatusUnauthorized, "unauthorized", "authentication required"}
	errForbidden    = &apiError{http.StatusForbidden, "forbidden", "not allowed"}
)

func badRequest(format string, a ...any) error {
	return &apiError{http.StatusBadRequest, "bad_request", fmt.Sprintf(format, a...)}
}

func notFound(what string) error {
	return &apiError{http.StatusNotFound, "not_found", what + " not found"}
}

func conflict(format string, a ...any) error {
	return &apiError{http.StatusConflict, "conflict", fmt.Sprintf(format, a...)}
}

func forbidden(format string, a ...any) error {
	return &apiError{http.StatusForbidden, "forbidden", fmt.Sprintf(format, a...)}
}

// fromStore maps store errors; what names the object for not-found.
func fromStore(err error, what string) error {
	err = store.Classify(err)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, store.ErrNotFound):
		return notFound(what)
	case errors.Is(err, store.ErrConflict):
		msg := err.Error()
		switch {
		case strings.Contains(msg, "UNIQUE"):
			return conflict("%s with that name already exists", what)
		case strings.Contains(msg, "FOREIGN KEY"):
			return conflict("%s is referenced by other objects or references a missing one", what)
		}
		return conflict("%s", msg)
	}
	return err
}

func writeErr(w http.ResponseWriter, err error) {
	var ae *apiError
	if !errors.As(err, &ae) {
		slog.Error("api", "err", err)
		ae = &apiError{http.StatusInternalServerError, "internal", "internal error"}
	}
	writeJSON(w, ae.Status, map[string]string{"error": ae.Code, "message": ae.Message})
}

func writeJSON(w http.ResponseWriter, status int, v any) error {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(v)
}

func ok(w http.ResponseWriter, v any) error      { return writeJSON(w, http.StatusOK, v) }
func created(w http.ResponseWriter, v any) error { return writeJSON(w, http.StatusCreated, v) }
func noContent(w http.ResponseWriter) error {
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return badRequest("invalid JSON body: %v", err)
	}
	return nil
}

// opt is a PATCH field: Set when present in the body, Null when it was null.
type opt[T any] struct {
	Set  bool
	Null bool
	V    T
}

func (o *opt[T]) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Null = true
		return nil
	}
	return json.Unmarshal(b, &o.V)
}

func (o opt[T]) Ptr() *T {
	if !o.Set {
		return nil
	}
	return &o.V
}

// handleOK executes fn to produce a result and writes it with HTTP 200 JSON.
func handleOK[T any](w http.ResponseWriter, fn func() (T, error)) error {
	res, err := fn()
	if err != nil {
		return err
	}
	return ok(w, res)
}

// handleCreated decodes JSON body into Req, executes fn, and writes the response with HTTP 201 Created.
func handleCreated[Req any, Resp any](w http.ResponseWriter, r *http.Request, fn func(req Req) (Resp, error)) error {
	var req Req
	if err := decode(r, &req); err != nil {
		return err
	}
	res, err := fn(req)
	if err != nil {
		return err
	}
	return created(w, res)
}

// handleAction decodes JSON body into Req, executes fn, and writes the response with HTTP 200 OK.
func handleAction[Req any, Resp any](w http.ResponseWriter, r *http.Request, fn func(req Req) (Resp, error)) error {
	var req Req
	if err := decode(r, &req); err != nil {
		return err
	}
	res, err := fn(req)
	if err != nil {
		return err
	}
	return ok(w, res)
}

// handleCommand executes a mutating action without request body and writes HTTP 204 No Content.
func handleCommand(w http.ResponseWriter, fn func() error) error {
	if err := fn(); err != nil {
		return err
	}
	return noContent(w)
}
