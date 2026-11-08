package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/bifrost0x/homegrid/internal/store"
	"io"
	"net/http"
	"strconv"
	"strings"
)

func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}
func fail(w http.ResponseWriter, status int, code, message string) {
	write(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
func (s *Server) result(w http.ResponseWriter, status int, v any, e error) {
	if e == nil {
		write(w, status, v)
		return
	}
	if errors.Is(e, store.ErrInvalid) {
		fail(w, 400, "validation", strings.TrimPrefix(e.Error(), "invalid resource: "))
		return
	}
	if errors.Is(e, store.ErrConflict) {
		fail(w, 409, "conflict", e.Error())
		return
	}
	if errors.Is(e, store.ErrNotFound) || errors.Is(e, sql.ErrNoRows) {
		fail(w, 404, "not_found", "Resource not found")
		return
	}
	s.cfg.Logger.Error("database operation failed", "error", e)
	fail(w, 500, "internal", "Unable to complete the request")
}
func decode(w http.ResponseWriter, r *http.Request, v any, limit int64) bool {
	ct := strings.Split(r.Header.Get("Content-Type"), ";")[0]
	if ct != "application/json" {
		fail(w, 415, "content_type", "Use application/json")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		var large *http.MaxBytesError
		if errors.As(e, &large) {
			fail(w, 413, "too_large", "Request body is too large")
		} else {
			fail(w, 400, "validation", "Invalid JSON request: "+e.Error())
		}
		return false
	}
	if e := d.Decode(new(any)); e != io.EOF {
		fail(w, 400, "validation", "Send one JSON object")
		return false
	}
	return true
}
func id(w http.ResponseWriter, r *http.Request) (int64, bool) {
	v, e := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if e != nil || v < 1 {
		fail(w, 400, "validation", "Invalid resource ID")
		return 0, false
	}
	return v, true
}
