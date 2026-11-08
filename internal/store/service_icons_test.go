package store

import "testing"

func TestValidIconAcceptsGeneratedServiceLogos(t *testing.T) {
	if len(serviceIconIDs) < 300 {
		t.Fatalf("expected the generated service catalog, got %d ids", len(serviceIconIDs))
	}
	seen := map[string]bool{}
	for _, id := range serviceIconIDs {
		if seen[id] {
			t.Fatalf("duplicate generated service id %q", id)
		}
		seen[id] = true
		if !ValidIcon("service:" + id) {
			t.Fatalf("service:%s rejected", id)
		}
	}
	// Ids stored by earlier releases must remain valid.
	for _, id := range []string{"jellyfin", "plex", "navidrome", "linkwarden", "paperlessngx", "nginxproxymanager", "authelia"} {
		if !ValidIcon("service:" + id) {
			t.Fatalf("existing service:%s rejected", id)
		}
	}
	for _, id := range []string{"opnsense", "openwebui", "ollama", "fritzbox", "proxmoxbackupserver"} {
		if !ValidIcon("service:" + id) {
			t.Fatalf("new service:%s rejected", id)
		}
	}
}

func TestValidIconRejectsUnknownServiceLogos(t *testing.T) {
	for _, icon := range []string{
		"service:", "service:unknown", "service:Jellyfin", "service:jellyfin.svg", "service:../jellyfin",
		"service:jellyfin?x=1", "service: jellyfin", "service:__proto__", "Service:jellyfin", "jellyfin",
		"service:open-webui", "https://remote.invalid/icon.svg", "builtin:jellyfin",
	} {
		if ValidIcon(icon) {
			t.Fatalf("%q accepted", icon)
		}
	}
}
