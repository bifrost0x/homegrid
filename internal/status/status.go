// Package status reports whether the services on the dashboard answer.
//
// Checks only run when the administrator enables them, only target URLs the
// administrator entered, and only report up, down or unknown. A check sends
// one HEAD request without cookies or credentials, never follows redirects
// and never reads a response body.
package status

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"sort"
	"sync"
	"syscall"
	"time"
)

// State is the reachability of one service URL.
type State string

const (
	Up   State = "up"
	Down State = "down"
	// Unknown means the URL was not checked: its address is refused by the
	// policy, it is not an HTTP(S) URL, or the check did not finish in time.
	Unknown State = "unknown"
)

const (
	// TTL is how long a result is reused before the URL is checked again.
	TTL          = time.Minute
	checkTimeout = 4 * time.Second
	// sweepTimeout stays well below the server's write timeout.
	sweepTimeout = 10 * time.Second
	concurrency  = 8
)

var errRefused = errors.New("address refused by policy")

// AddressPolicy decides whether a resolved address may be contacted.
type AddressPolicy func(netip.Addr) bool

type entry struct {
	state State
	at    time.Time
}

// Checker checks service URLs and caches the results for TTL.
type Checker struct {
	client *http.Client
	now    func() time.Time
	// deadline bounds one sweep; tests shorten it.
	deadline time.Duration
	// sweep allows one sweep at a time; concurrent callers get cached results.
	sweep sync.Mutex
	mu    sync.Mutex
	cache map[string]entry
}

// New returns a Checker whose connections are checked against policy at
// connect time, after DNS resolution, so a hostname cannot be rebound to a
// refused address.
func New(policy AddressPolicy) *Checker {
	dialer := &net.Dialer{
		Timeout: checkTimeout,
		Control: func(_, address string, _ syscall.RawConn) error {
			addrPort, e := netip.ParseAddrPort(address)
			if e != nil || !policy(addrPort.Addr()) {
				return fmt.Errorf("%w: %s", errRefused, address)
			}
			return nil
		},
	}
	transport := &http.Transport{
		// Environment proxies would bypass the address policy.
		Proxy:                  nil,
		DialContext:            dialer.DialContext,
		TLSHandshakeTimeout:    checkTimeout,
		ResponseHeaderTimeout:  checkTimeout,
		MaxResponseHeaderBytes: 16 << 10,
		DisableKeepAlives:      true,
		// Certificates are verified. A service with a self-signed certificate
		// fails verification after it answered the handshake; probe counts
		// that as up without sending the request.
		TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
	}
	return &Checker{
		client: &http.Client{
			Transport: transport,
			// A redirect is an answer; following it could reach other hosts.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		now:      time.Now,
		deadline: sweepTimeout,
		cache:    map[string]entry{},
	}
}

// Check returns the state of every URL. Results younger than TTL are reused;
// the remaining URLs are checked with bounded concurrency within one sweep
// deadline, oldest results first. While another sweep runs, Check returns the
// cached results without waiting. Cached results for URLs not in urls are
// dropped.
func (c *Checker) Check(ctx context.Context, urls []string) map[string]State {
	if !c.sweep.TryLock() {
		return c.cached(urls)
	}
	defer c.sweep.Unlock()
	now := c.now()
	wanted := map[string]bool{}
	var stale []string
	c.mu.Lock()
	for _, u := range urls {
		if wanted[u] {
			continue
		}
		wanted[u] = true
		if e, ok := c.cache[u]; !ok || now.Sub(e.at) >= TTL {
			stale = append(stale, u)
		}
	}
	for u := range c.cache {
		if !wanted[u] {
			delete(c.cache, u)
		}
	}
	// Never-checked URLs first, then the oldest results, so a sweep cut off
	// by its deadline still makes progress through a long list.
	sort.SliceStable(stale, func(i, j int) bool { return c.cache[stale[i]].at.Before(c.cache[stale[j]].at) })
	c.mu.Unlock()

	if len(stale) > 0 {
		// The sweep outlives a disconnecting client so its work is cached.
		sweepCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), c.deadline)
		slots := make(chan struct{}, concurrency)
		var wg sync.WaitGroup
		for _, u := range stale {
			select {
			case slots <- struct{}{}:
			case <-sweepCtx.Done():
			}
			if sweepCtx.Err() != nil {
				break
			}
			wg.Add(1)
			go func(u string) {
				defer wg.Done()
				defer func() { <-slots }()
				state := c.probe(sweepCtx, u)
				// A check cut off by the sweep deadline proves nothing; caching
				// it as unknown keeps the next request from sweeping it again.
				if sweepCtx.Err() != nil && state == Down {
					state = Unknown
				}
				c.mu.Lock()
				c.cache[u] = entry{state: state, at: c.now()}
				c.mu.Unlock()
			}(u)
		}
		wg.Wait()
		cancel()
	}

	return c.cached(urls)
}

// cached returns the cached state of every URL, unknown when none exists.
func (c *Checker) cached(urls []string) map[string]State {
	out := make(map[string]State, len(urls))
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, u := range urls {
		if e, ok := c.cache[u]; ok {
			out[u] = e.state
		} else {
			out[u] = Unknown
		}
	}
	return out
}

func (c *Checker) probe(ctx context.Context, raw string) State {
	u, e := url.Parse(raw)
	if e != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil {
		return Unknown
	}
	u.Fragment = ""
	ctx, cancel := context.WithTimeout(ctx, checkTimeout)
	defer cancel()
	req, e := http.NewRequestWithContext(ctx, http.MethodHead, u.String(), nil)
	if e != nil {
		return Unknown
	}
	req.Header.Set("User-Agent", "HomeGrid-Status")
	resp, e := c.client.Do(req)
	if e != nil {
		if errors.Is(e, errRefused) {
			return Unknown
		}
		if untrustedCertificate(e) {
			return Up
		}
		return Down
	}
	resp.Body.Close()
	// Gateway errors mean a proxy answered for a service that does not.
	switch resp.StatusCode {
	case http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return Down
	}
	return Up
}

// untrustedCertificate reports whether a TLS handshake reached certificate
// verification or a peer alert, which means the service answers on that
// address.
func untrustedCertificate(e error) bool {
	var verification *tls.CertificateVerificationError
	var unknown x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var invalid x509.CertificateInvalidError
	// A TLS alert also shows that the peer answers: one it sent ("remote
	// error"), for example when it requires a client certificate, or one sent
	// in reply to its handshake messages, for example for an old TLS version.
	var alert tls.AlertError
	var op *net.OpError
	remoteAlert := errors.As(e, &op) && op.Op == "remote error"
	return errors.As(e, &verification) || errors.As(e, &unknown) || errors.As(e, &hostname) || errors.As(e, &invalid) || errors.As(e, &alert) || remoteAlert
}
