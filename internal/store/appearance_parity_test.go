package store

import (
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// The frontend offers the palettes, photos and gradients defined in themes.ts.
// Every one of them must pass server validation, and the server must not accept
// identifiers the frontend cannot render.
func TestAppearanceIdentifiersMatchFrontend(t *testing.T) {
	raw, e := os.ReadFile("../../frontend/src/themes.ts")
	if os.IsNotExist(e) {
		t.Skip("frontend sources are not part of this build context")
	}
	if e != nil {
		t.Fatal(e)
	}
	source := string(raw)
	section := func(name string) []string {
		start := strings.Index(source, "export const "+name)
		if start < 0 {
			t.Fatalf("%s not found in themes.ts", name)
		}
		body := source[start:]
		body = body[:strings.Index(body, "\n];")]
		var ids []string
		for _, m := range regexp.MustCompile(`id: "([a-z-]+)"`).FindAllStringSubmatch(body, -1) {
			ids = append(ids, m[1])
		}
		sort.Strings(ids)
		return ids
	}
	check := func(name string, ids []string, valid func(string) bool, others ...[]string) {
		if len(ids) == 0 {
			t.Fatalf("no %s parsed", name)
		}
		offered := map[string]bool{}
		for _, id := range ids {
			offered[id] = true
			if !valid(id) {
				t.Errorf("server rejects frontend %s %q", name, id)
			}
		}
		for _, list := range others {
			for _, id := range list {
				if !offered[id] && valid(id) {
					t.Errorf("server accepts %q as a %s, but the frontend does not offer it", id, name)
				}
			}
		}
	}
	palettes, photos, gradients := section("palettes"), section("photos"), section("gradients")
	check("palette", palettes, validDesign, gradients)
	check("photo", photos, validPhoto, palettes, gradients)
	check("gradient", gradients, validGradient, palettes, photos)
}
