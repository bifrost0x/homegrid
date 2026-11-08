// Package icondiscovery finds the icon a web service advertises for itself.
//
// It is the only place where HomeGrid's backend contacts a service URL. The
// administrator supplies the URL; everything the service returns is treated
// as untrusted: responses are size-limited, only raster images are decoded,
// and the caller re-encodes the result before storing it.
package icondiscovery

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"

	"golang.org/x/image/draw"
	"golang.org/x/net/html"

	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	_ "golang.org/x/image/webp"
)

var (
	// ErrNotFound means the service answered but offered no usable icon.
	ErrNotFound = errors.New("no usable icon found")
	// ErrUnreachable means the service could not be contacted.
	ErrUnreachable = errors.New("service unreachable")
	// ErrInvalidURL means the address is not an http(s) URL without credentials.
	ErrInvalidURL = errors.New("invalid service URL")
)

const (
	pageLimit     = 512 << 10
	manifestLimit = 128 << 10
	iconLimit     = 1 << 20
	maxDimension  = 2048
	minDimension  = 16
	outputSize    = 256
	maxCandidates = 6
	maxRedirects  = 3
	totalTimeout  = 12 * time.Second
)

// AddressPolicy decides whether a resolved address may be contacted.
type AddressPolicy func(netip.Addr) bool

// DefaultPolicy allows private, CGNAT and public unicast addresses, which is
// where homelab services live, and refuses loopback (HomeGrid itself),
// link-local (including cloud metadata endpoints), multicast, broadcast and
// unspecified addresses.
func DefaultPolicy(addr netip.Addr) bool {
	addr = addr.Unmap()
	switch {
	case !addr.IsValid(), addr.IsUnspecified(), addr.IsLoopback(),
		addr.IsLinkLocalUnicast(), addr.IsLinkLocalMulticast(),
		addr.IsInterfaceLocalMulticast(), addr.IsMulticast():
		return false
	case addr.Is4() && (addr == netip.AddrFrom4([4]byte{255, 255, 255, 255}) || addr.As4()[0] == 0):
		return false
	}
	return true
}

// Fetcher discovers icons over HTTP(S).
type Fetcher struct {
	client *http.Client
}

// New returns a Fetcher whose every connection is checked against policy at
// connect time, after DNS resolution, so a hostname cannot be rebound to a
// refused address between a check and the request.
func New(policy AddressPolicy) *Fetcher {
	dialer := &net.Dialer{
		Timeout: 5 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			addrPort, e := netip.ParseAddrPort(address)
			if e != nil || !policy(addrPort.Addr()) {
				return fmt.Errorf("%w: address %s is not allowed", ErrUnreachable, address)
			}
			return nil
		},
	}
	transport := &http.Transport{
		// Environment proxies would bypass the address policy.
		Proxy:                  nil,
		DialContext:            dialer.DialContext,
		ForceAttemptHTTP2:      true,
		TLSHandshakeTimeout:    5 * time.Second,
		ResponseHeaderTimeout:  6 * time.Second,
		MaxResponseHeaderBytes: 64 << 10,
		DisableCompression:     false,
		MaxIdleConns:           4,
		IdleConnTimeout:        30 * time.Second,
		// Certificates are verified. A service with a self-signed certificate
		// simply yields no icon; the browser-side favicon option still works.
		TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
	}
	client := &http.Client{
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return errors.New("too many redirects")
			}
			if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
				return errors.New("redirect to unsupported scheme")
			}
			return nil
		},
	}
	return &Fetcher{client: client}
}

// Result is what a service advertises about itself.
type Result struct {
	// Icon is the best raster icon, at most 256 pixels on its longer side.
	Icon image.Image
	// Title is the page title, whitespace-normalized and at most 100 bytes.
	Title string
}

// Discover returns the best raster icon advertised by the service at rawURL
// and its page title.
func (f *Fetcher) Discover(ctx context.Context, rawURL string) (Result, error) {
	page, e := url.Parse(strings.TrimSpace(rawURL))
	if e != nil || (page.Scheme != "http" && page.Scheme != "https") || page.Hostname() == "" || page.User != nil {
		return Result{}, ErrInvalidURL
	}
	ctx, cancel := context.WithTimeout(ctx, totalTimeout)
	defer cancel()

	var candidates []candidate
	var title string
	body, final, contentType, e := f.get(ctx, page.String(), pageLimit, "text/html,application/xhtml+xml")
	if e != nil {
		if errors.Is(e, ErrUnreachable) {
			return Result{}, e
		}
		// The page itself may require sign-in or fail; well-known paths remain.
		final = page
	} else if strings.Contains(contentType, "html") {
		var manifest *url.URL
		candidates, manifest, title = parsePage(body, final)
		if manifest != nil {
			if data, base, _, e := f.get(ctx, manifest.String(), manifestLimit, "application/manifest+json,application/json"); e == nil {
				candidates = append(candidates, parseManifest(data, base)...)
			}
		}
	}
	origin := &url.URL{Scheme: final.Scheme, Host: final.Host}
	candidates = append(candidates,
		candidate{url: origin.ResolveReference(&url.URL{Path: "/apple-touch-icon.png"}), size: 180, rank: 1},
		candidate{url: origin.ResolveReference(&url.URL{Path: "/favicon.ico"}), size: 32, rank: 0},
	)
	candidates = dedupe(candidates)
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].rank != candidates[j].rank {
			return candidates[i].rank > candidates[j].rank
		}
		return candidates[i].size > candidates[j].size
	})

	var best image.Image
	for i, c := range candidates {
		if i == maxCandidates || ctx.Err() != nil {
			break
		}
		data, _, _, e := f.get(ctx, c.url.String(), iconLimit, "image/*")
		if e != nil {
			continue
		}
		img, e := decode(data)
		if e != nil {
			continue
		}
		if best == nil || side(img) > side(best) {
			best = img
		}
		if side(best) >= 96 {
			break
		}
	}
	if best == nil {
		return Result{}, ErrNotFound
	}
	return Result{Icon: scale(best), Title: title}, nil
}

func (f *Fetcher) get(ctx context.Context, target string, limit int64, accept string) ([]byte, *url.URL, string, error) {
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if e != nil {
		return nil, nil, "", e
	}
	req.Header.Set("Accept", accept)
	req.Header.Set("User-Agent", "HomeGrid icon discovery")
	res, e := f.client.Do(req)
	if e != nil {
		if errors.Is(e, ErrUnreachable) || isNetworkError(e) {
			return nil, nil, "", fmt.Errorf("%w: %v", ErrUnreachable, e)
		}
		return nil, nil, "", e
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, nil, "", fmt.Errorf("HTTP %d", res.StatusCode)
	}
	data, e := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if e != nil {
		return nil, nil, "", e
	}
	if int64(len(data)) > limit {
		return nil, nil, "", errors.New("response too large")
	}
	mediaType, _, _ := mime.ParseMediaType(res.Header.Get("Content-Type"))
	return data, res.Request.URL, mediaType, nil
}

func isNetworkError(e error) bool {
	var netErr net.Error
	var opErr *net.OpError
	var dnsErr *net.DNSError
	return errors.As(e, &opErr) || errors.As(e, &dnsErr) || (errors.As(e, &netErr) && netErr.Timeout())
}

type candidate struct {
	url  *url.URL
	size int
	rank int
}

// parsePage collects icon links and the manifest link from an HTML document.
// SVG and mask icons are skipped: they cannot be re-encoded safely.
func parsePage(body []byte, page *url.URL) ([]candidate, *url.URL, string) {
	base := page
	var out []candidate
	var manifest *url.URL
	var title strings.Builder
	inTitle, titleDone := false, false
	tokens := html.NewTokenizer(bytes.NewReader(body))
	for {
		switch tokens.Next() {
		case html.ErrorToken:
			return out, manifest, cleanTitle(title.String())
		case html.TextToken:
			if inTitle && title.Len() < 1024 {
				title.Write(tokens.Text())
			}
		case html.EndTagToken:
			if name, _ := tokens.TagName(); string(name) == "title" && inTitle {
				inTitle, titleDone = false, true
			}
		case html.StartTagToken, html.SelfClosingTagToken:
			name, hasAttr := tokens.TagName()
			if string(name) == "title" && !titleDone {
				inTitle = true
			}
			if !hasAttr {
				continue
			}
			attrs := map[string]string{}
			for {
				key, value, more := tokens.TagAttr()
				attrs[strings.ToLower(string(key))] = string(value)
				if !more {
					break
				}
			}
			switch string(name) {
			case "base":
				if href, e := base.Parse(attrs["href"]); e == nil && attrs["href"] != "" {
					base = href
				}
			case "link":
				rel := " " + strings.ToLower(attrs["rel"]) + " "
				href, e := base.Parse(strings.TrimSpace(attrs["href"]))
				if e != nil || attrs["href"] == "" || !httpURL(href) {
					continue
				}
				if strings.Contains(rel, " manifest ") {
					manifest = href
					continue
				}
				if !strings.Contains(rel, "icon") || strings.Contains(rel, "mask-icon") || isSVG(attrs["type"], href) {
					continue
				}
				rank := 2
				if strings.Contains(rel, "apple-touch-icon") {
					rank = 3
				}
				out = append(out, candidate{url: href, size: largestSize(attrs["sizes"]), rank: rank})
			}
		}
	}
}

func parseManifest(data []byte, base *url.URL) []candidate {
	var manifest struct {
		Icons []struct {
			Src   string `json:"src"`
			Sizes string `json:"sizes"`
			Type  string `json:"type"`
		} `json:"icons"`
	}
	if json.Unmarshal(data, &manifest) != nil {
		return nil
	}
	var out []candidate
	for _, icon := range manifest.Icons {
		href, e := base.Parse(strings.TrimSpace(icon.Src))
		if e != nil || icon.Src == "" || !httpURL(href) || isSVG(icon.Type, href) {
			continue
		}
		out = append(out, candidate{url: href, size: largestSize(icon.Sizes), rank: 2})
	}
	return out
}

func httpURL(u *url.URL) bool {
	return (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" && u.User == nil
}

func isSVG(declaredType string, u *url.URL) bool {
	return strings.Contains(strings.ToLower(declaredType), "svg") || strings.HasSuffix(strings.ToLower(u.Path), ".svg")
}

func largestSize(sizes string) int {
	best := 0
	for _, size := range strings.Fields(strings.ToLower(sizes)) {
		w, _, ok := strings.Cut(size, "x")
		if n, e := strconv.Atoi(w); ok && e == nil && n > best && n <= maxDimension {
			best = n
		}
	}
	return best
}

func dedupe(list []candidate) []candidate {
	seen := map[string]bool{}
	out := list[:0]
	for _, c := range list {
		key := c.url.String()
		if !seen[key] {
			seen[key] = true
			out = append(out, c)
		}
	}
	return out
}

// decode accepts PNG, JPEG, GIF, WebP and ICO data within size bounds.
func decode(data []byte) (image.Image, error) {
	if isICO(data) {
		return decodeICO(data)
	}
	cfg, format, e := image.DecodeConfig(bytes.NewReader(data))
	if e != nil {
		return nil, e
	}
	switch format {
	case "png", "jpeg", "gif", "webp":
	default:
		return nil, fmt.Errorf("unsupported format %s", format)
	}
	if !inBounds(cfg.Width, cfg.Height) {
		return nil, errors.New("image dimensions out of range")
	}
	img, _, e := image.Decode(bytes.NewReader(data))
	return img, e
}

func inBounds(w, h int) bool {
	return w >= minDimension && h >= minDimension && w <= maxDimension && h <= maxDimension
}

func side(img image.Image) int {
	b := img.Bounds()
	return min(b.Dx(), b.Dy())
}

func scale(img image.Image) image.Image {
	b := img.Bounds()
	longest := max(b.Dx(), b.Dy())
	if longest <= outputSize {
		return img
	}
	w := b.Dx() * outputSize / longest
	h := b.Dy() * outputSize / longest
	out := image.NewNRGBA(image.Rect(0, 0, max(w, 1), max(h, 1)))
	draw.CatmullRom.Scale(out, out.Bounds(), img, b, draw.Over, nil)
	return out
}

// cleanTitle collapses whitespace and limits the title to 100 bytes on a rune
// boundary, matching the application name limit.
func cleanTitle(raw string) string {
	title := strings.Join(strings.Fields(raw), " ")
	for len(title) > 100 {
		_, size := utf8.DecodeLastRuneInString(title)
		title = title[:len(title)-size]
	}
	return strings.TrimSpace(title)
}
