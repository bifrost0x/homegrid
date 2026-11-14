package store

import (
	"errors"
	"strings"
	"testing"
)

func TestSimpleImportCarriesDescriptions(t *testing.T) {
	d, e := ParseImport([]byte(`{"apps":[{"name":"Sonarr","url":"https://sonarr.home.arpa","category":"Media","icon":"","description":"  Series  "},{"name":"NAS","url":"https://nas.home.arpa"}]}`))
	if e != nil {
		t.Fatal(e)
	}
	if d.Apps[0].Description != "Series" || d.Apps[1].Description != "" || d.Apps[1].CategoryID != 1 {
		t.Fatal(d.Apps)
	}
	long := strings.Repeat("x", 501)
	if _, e = ParseImport([]byte(`{"apps":[{"name":"NAS","url":"https://nas.home.arpa","description":"` + long + `"}]}`)); !errors.Is(e, ErrInvalid) {
		t.Fatal("overlong description accepted", e)
	}
	if _, e = ParseImport([]byte(`{"apps":[{"name":"NAS","url":"https://nas.home.arpa","target":"_blank"}]}`)); !errors.Is(e, ErrInvalid) {
		t.Fatal("unknown field accepted", e)
	}
}
