package status

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"sync/atomic"
	"testing"
	"time"
)

func allowAll(netip.Addr) bool { return true }

func TestStatesAndNoRedirects(t *testing.T) {
	var targetHits, methodErrors atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { targetHits.Add(1) }))
	defer target.Close()
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodHead || r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
			methodErrors.Add(1)
		}
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer up.Close()
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusBadGateway) }))
	defer gateway.Close()
	redirect := httptest.NewServer(http.RedirectHandler(target.URL, http.StatusFound))
	defer redirect.Close()
	selfSigned := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer selfSigned.Close()
	closed := httptest.NewServer(http.NotFoundHandler())
	closedURL := closed.URL
	closed.Close()

	got := New(allowAll).Check(context.Background(), []string{up.URL, gateway.URL, redirect.URL, selfSigned.URL, closedURL, "ftp://files.home.arpa", "https://user:pass@nas.home.arpa"})
	want := map[string]State{up.URL: Up, gateway.URL: Down, redirect.URL: Up, selfSigned.URL: Up, closedURL: Down, "ftp://files.home.arpa": Unknown, "https://user:pass@nas.home.arpa": Unknown}
	for u, state := range want {
		if got[u] != state {
			t.Errorf("%s: got %q want %q", u, got[u], state)
		}
	}
	if targetHits.Load() != 0 {
		t.Fatal("redirect was followed")
	}
	if methodErrors.Load() != 0 {
		t.Fatal("check was not a plain HEAD request")
	}
}

func TestPolicyIsEnforcedAfterResolution(t *testing.T) {
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hits.Add(1) }))
	defer server.Close()
	_, port, _ := net.SplitHostPort(server.Listener.Addr().String())
	refuseLoopback := func(a netip.Addr) bool { return !a.Unmap().IsLoopback() }
	// localhost resolves to a loopback address, which the policy refuses.
	u := "http://localhost:" + port
	if got := New(refuseLoopback).Check(context.Background(), []string{u})[u]; got != Unknown {
		t.Fatal("refused address reported as", got)
	}
	if hits.Load() != 0 {
		t.Fatal("refused address was contacted")
	}
}

func TestResultsAreCachedAndPruned(t *testing.T) {
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hits.Add(1) }))
	defer server.Close()
	c := New(allowAll)
	now := time.Now()
	c.now = func() time.Time { return now }
	for range 3 {
		if got := c.Check(context.Background(), []string{server.URL, server.URL})[server.URL]; got != Up {
			t.Fatal(got)
		}
	}
	if hits.Load() != 1 {
		t.Fatal("cached result was not reused", hits.Load())
	}
	now = now.Add(TTL)
	c.Check(context.Background(), []string{server.URL})
	if hits.Load() != 2 {
		t.Fatal("expired result was not refreshed", hits.Load())
	}
	c.Check(context.Background(), nil)
	if len(c.cache) != 0 {
		t.Fatal("results for removed URLs were kept", c.cache)
	}
}

func TestCanceledRequestStillCompletesSweep(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	c := New(allowAll)
	if got := c.Check(ctx, []string{server.URL})[server.URL]; got != Up {
		t.Fatal(got)
	}
}
