package server

import (
	"net/http"
	"net/url"
	"strconv"

	"github.com/bifrost0x/homegrid/internal/status"
)

// serviceStatus reports up, down or unknown per application while the
// administrator has enabled status checks; otherwise it contacts nothing.
func (s *Server) serviceStatus(w http.ResponseWriter, r *http.Request) {
	settings, e := s.cfg.Store.Settings(r.Context())
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	statuses := map[string]status.State{}
	if !settings.StatusChecks {
		write(w, 200, map[string]any{"enabled": false, "statuses": statuses})
		return
	}
	apps, e := s.cfg.Store.Apps(r.Context())
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	var urls []string
	for _, a := range apps {
		if !exampleURL(a.URL) {
			urls = append(urls, a.URL)
		}
	}
	results := s.status.Check(r.Context(), urls)
	for _, a := range apps {
		state, ok := results[a.URL]
		if !ok {
			state = status.Unknown
		}
		statuses[strconv.FormatInt(a.ID, 10)] = state
	}
	write(w, 200, map[string]any{"enabled": true, "statuses": statuses})
}

// exampleURL matches the configuration-only example cards, which have no service.
func exampleURL(raw string) bool {
	u, e := url.Parse(raw)
	return e == nil && u.Hostname() == "example.homegrid.invalid"
}
