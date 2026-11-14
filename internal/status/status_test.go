package status

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strconv"
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

// blackHole accepts connections and never answers.
func blackHole(t *testing.T) (string, *atomic.Int32) {
	t.Helper()
	l, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	var accepted atomic.Int32
	var conns []net.Conn
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			c, e := l.Accept()
			if e != nil {
				return
			}
			accepted.Add(1)
			conns = append(conns, c)
		}
	}()
	t.Cleanup(func() {
		l.Close()
		<-done
		for _, c := range conns {
			c.Close()
		}
	})
	return "http://" + l.Addr().String(), &accepted
}

func TestDeadlineCutSweepIsCachedAsUnknown(t *testing.T) {
	base, accepted := blackHole(t)
	var urls []string
	for i := range 40 {
		urls = append(urls, base+"/service/"+strconv.Itoa(i))
	}
	c := New(allowAll)
	c.deadline = 300 * time.Millisecond
	start := time.Now()
	got := c.Check(context.Background(), urls)
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatal("sweep exceeded its deadline", elapsed)
	}
	for _, u := range urls[:concurrency] {
		if got[u] != Unknown {
			t.Fatal("cut-off check reported as", got[u])
		}
	}
	first := accepted.Load()
	if first == 0 || first > concurrency {
		t.Fatal("unexpected number of connections", first)
	}
	// The next request continues with URLs that were never checked instead of
	// repeating the cut-off ones.
	c.Check(context.Background(), urls)
	second := accepted.Load() - first
	if second == 0 {
		t.Fatal("the next sweep made no progress")
	}
	if _, ok := c.cache[urls[0]]; !ok {
		t.Fatal("cut-off result was not cached")
	}
}

func TestConcurrentCheckReturnsCachedResultsWithoutWaiting(t *testing.T) {
	release := make(chan struct{})
	slow := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { <-release }))
	defer slow.Close()
	defer close(release)
	c := New(allowAll)
	done := make(chan map[string]State)
	go func() { done <- c.Check(context.Background(), []string{slow.URL}) }()
	// Wait until the first sweep holds the lock.
	for c.sweep.TryLock() {
		c.sweep.Unlock()
		time.Sleep(5 * time.Millisecond)
	}
	start := time.Now()
	if got := c.Check(context.Background(), []string{slow.URL})[slow.URL]; got != Unknown {
		t.Fatal("concurrent check reported", got)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatal("concurrent check waited for the sweep", elapsed)
	}
	release <- struct{}{}
	if got := (<-done)[slow.URL]; got != Up {
		t.Fatal("sweep result", got)
	}
}

func TestTLSAlertsCountAsAnswer(t *testing.T) {
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	server.TLS = &tls.Config{ClientAuth: tls.RequireAnyClientCert}
	server.StartTLS()
	defer server.Close()
	if got := New(allowAll).Check(context.Background(), []string{server.URL})[server.URL]; got != Up {
		t.Fatal("server requiring a client certificate reported as", got)
	}
	if untrustedCertificate(errors.New("connection refused")) {
		t.Fatal("plain error treated as an answer")
	}
	if !untrustedCertificate(&net.OpError{Op: "remote error", Err: errors.New("tls: handshake failure")}) {
		t.Fatal("remote TLS alert not treated as an answer")
	}
}
