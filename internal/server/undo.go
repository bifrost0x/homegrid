package server

import "net/http"

func (s *Server) pendingUndo(w http.ResponseWriter, r *http.Request) {
	records, e := s.cfg.Store.PendingUndo(r.Context())
	s.result(w, 200, records, e)
}
func (s *Server) undo(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	if !decode(w, r, &body, 1024) {
		return
	}
	if len(body.Token) != 64 {
		fail(w, 409, "conflict", "This undo action expired or is no longer available")
		return
	}
	e := s.cfg.Store.Undo(r.Context(), body.Token)
	s.result(w, 200, map[string]bool{"ok": true}, e)
}
func (s *Server) examples(w http.ResponseWriter, r *http.Request) {
	e := s.cfg.Store.SeedExamples(r.Context())
	s.result(w, 200, map[string]bool{"ok": true}, e)
}
