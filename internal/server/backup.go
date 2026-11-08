package server

import (
	"encoding/json"
	"github.com/bifrost0x/homegrid/internal/store"
	"net/http"
)

func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	v, e := s.cfg.Store.Export(r.Context())
	w.Header().Set("Content-Disposition", `attachment; filename="homegrid-backup.json"`)
	s.result(w, 200, v, e)
}
func (s *Server) preview(w http.ResponseWriter, r *http.Request) {
	var raw json.RawMessage
	if !decode(w, r, &raw, 5<<20) {
		return
	}
	v, e := store.ParseImport(raw)
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	p, e := s.cfg.Store.Preview(r.Context(), v)
	s.result(w, 200, p, e)
}
func (s *Server) applyImport(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Data    json.RawMessage `json:"data"`
		Mode    string          `json:"mode"`
		Confirm bool            `json:"confirm"`
	}
	if !decode(w, r, &body, 5<<20) {
		return
	}
	if !body.Confirm || (body.Mode != "merge" && body.Mode != "replace") {
		fail(w, 400, "validation", "Choose merge or replace and explicitly confirm the import")
		return
	}
	v, e := store.ParseImport(body.Data)
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	n, e := s.cfg.Store.Import(r.Context(), v, body.Mode == "replace")
	s.result(w, 200, map[string]int{"imported": n}, e)
}
