package server

import (
	"github.com/bifrost0x/homegrid/internal/store"
	"net/http"
	"strings"
)

func (s *Server) listApps(w http.ResponseWriter, r *http.Request) {
	v, e := s.cfg.Store.Apps(r.Context())
	s.result(w, 200, v, e)
}
func (s *Server) listCategories(w http.ResponseWriter, r *http.Request) {
	v, e := s.cfg.Store.Categories(r.Context())
	s.result(w, 200, v, e)
}
func (s *Server) saveApp(w http.ResponseWriter, r *http.Request) {
	v := store.App{CategoryID: 1, OpenInNewTab: true}
	if !decode(w, r, &v, 1<<20) {
		return
	}
	create := r.Method == "POST"
	status := 200
	if create {
		status = 201
		v.ID = 0
	} else {
		n, ok := id(w, r)
		if !ok {
			return
		}
		v.ID = n
	}
	a, e := s.cfg.Store.SaveApp(r.Context(), v, create)
	s.result(w, status, a, e)
}
func (s *Server) saveCategory(w http.ResponseWriter, r *http.Request) {
	var v store.Category
	if !decode(w, r, &v, 1<<20) {
		return
	}
	create := r.Method == "POST"
	status := 200
	if create {
		status = 201
		v.ID = 0
	} else {
		n, ok := id(w, r)
		if !ok {
			return
		}
		v.ID = n
	}
	c, e := s.cfg.Store.SaveCategory(r.Context(), v, create)
	s.result(w, status, c, e)
}
func resourceKind(r *http.Request) string {
	if strings.HasPrefix(r.URL.Path, "/api/categories") {
		return "categories"
	}
	return "applications"
}
func (s *Server) deleteResource(w http.ResponseWriter, r *http.Request) {
	n, ok := id(w, r)
	if !ok {
		return
	}
	var e error
	if resourceKind(r) == "applications" {
		var token string
		token, e = s.cfg.Store.DeleteAppWithUndo(r.Context(), n)
		if e == nil {
			w.Header().Set("X-HomeGrid-Undo", token)
		}
	} else {
		e = s.cfg.Store.Delete(r.Context(), resourceKind(r), n)
	}
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	w.WriteHeader(204)
}
func (s *Server) reorder(w http.ResponseWriter, r *http.Request) {
	var v struct {
		IDs  []int64        `json:"ids"`
		Move *store.AppMove `json:"move"`
	}
	if !decode(w, r, &v, 1<<20) {
		return
	}
	var moves []store.AppMove
	if v.Move != nil {
		moves = append(moves, *v.Move)
	}
	token, e := s.cfg.Store.ReorderWithUndo(r.Context(), resourceKind(r), v.IDs, moves...)
	if e == nil {
		w.Header().Set("X-HomeGrid-Undo", token)
	}
	s.result(w, 200, map[string]bool{"ok": true}, e)
}
func (s *Server) settings(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" || r.Method == "HEAD" {
		v, e := s.cfg.Store.Settings(r.Context())
		s.result(w, 200, v, e)
		return
	}
	var v store.Settings
	if !decode(w, r, &v, 1<<20) {
		return
	}
	v, token, e := s.cfg.Store.SaveSettingsWithUndo(r.Context(), v)
	if e == nil {
		w.Header().Set("X-HomeGrid-Undo", token)
	}
	s.result(w, 200, v, e)
}
