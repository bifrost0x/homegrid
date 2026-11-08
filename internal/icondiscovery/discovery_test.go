package icondiscovery

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"
)

func allowAll(netip.Addr) bool { return true }

func pngBytes(t *testing.T, w, h int, c color.Color) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	var b bytes.Buffer
	if e := png.Encode(&b, img); e != nil {
		t.Fatal(e)
	}
	return b.Bytes()
}

// icoBytes builds an ICO file with one bottom-up DIB entry.
func icoBytes(w, h, bpp int, pixel func(x, y int) []byte, masked func(x, y int) bool) []byte {
	stride := (w*bpp + 31) / 32 * 4
	maskStride := (w + 31) / 32 * 4
	var dib bytes.Buffer
	header := make([]byte, 40)
	binary.LittleEndian.PutUint32(header[0:], 40)
	binary.LittleEndian.PutUint32(header[4:], uint32(w))
	binary.LittleEndian.PutUint32(header[8:], uint32(2*h))
	binary.LittleEndian.PutUint16(header[12:], 1)
	binary.LittleEndian.PutUint16(header[14:], uint16(bpp))
	dib.Write(header)
	if bpp == 8 {
		binary.LittleEndian.PutUint32(header[32:], 2)
		dib.Reset()
		dib.Write(header)
		dib.Write([]byte{0, 0, 255, 0, 0, 255, 0, 0}) // palette: red, green
	}
	for y := h - 1; y >= 0; y-- {
		row := make([]byte, stride)
		for x := 0; x < w; x++ {
			copy(row[x*bpp/8:], pixel(x, y))
		}
		dib.Write(row)
	}
	for y := h - 1; y >= 0; y-- {
		row := make([]byte, maskStride)
		for x := 0; x < w; x++ {
			if masked(x, y) {
				row[x/8] |= 0x80 >> (x % 8)
			}
		}
		dib.Write(row)
	}
	var out bytes.Buffer
	dir := make([]byte, 22)
	binary.LittleEndian.PutUint16(dir[2:], 1)
	binary.LittleEndian.PutUint16(dir[4:], 1)
	dir[6], dir[7] = byte(w), byte(h)
	binary.LittleEndian.PutUint32(dir[14:], uint32(dib.Len()))
	binary.LittleEndian.PutUint32(dir[18:], 22)
	out.Write(dir)
	out.Write(dib.Bytes())
	return out.Bytes()
}

func TestDefaultPolicy(t *testing.T) {
	for addr, want := range map[string]bool{
		"192.168.1.10": true, "10.0.0.5": true, "172.16.4.1": true, "100.64.0.7": true,
		"8.8.8.8": true, "fd00::1": true, "2001:db8::1": true,
		"127.0.0.1": false, "::1": false, "::ffff:127.0.0.1": false, "169.254.169.254": false,
		"fe80::1": false, "224.0.0.251": false, "ff02::1": false, "0.0.0.0": false,
		"0.1.2.3": false, "255.255.255.255": false, "::": false,
	} {
		if got := DefaultPolicy(netip.MustParseAddr(addr)); got != want {
			t.Errorf("%s: got %v want %v", addr, got, want)
		}
	}
}

func TestDiscoverPrefersLargestAdvertisedRasterIcon(t *testing.T) {
	var mu sync.Mutex
	requested := map[string]bool{}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		requested[r.URL.Path] = true
		mu.Unlock()
		switch r.URL.Path {
		case "/app/":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write([]byte(`<html><head><title>
				Book  shelf &amp; more</title><base href="/app/">
				<link rel="icon" type="image/svg+xml" href="logo.svg">
				<link rel="mask-icon" href="mask.png">
				<link rel="icon" sizes="32x32" href="small.png">
				<link rel="manifest" href="site.webmanifest"></head></html>`))
		case "/app/site.webmanifest":
			w.Write([]byte(`{"icons":[{"src":"big.png","sizes":"512x512","type":"image/png"},{"src":"vector.svg","sizes":"any"}]}`))
		case "/app/big.png":
			w.Write(pngBytes(t, 512, 512, color.NRGBA{B: 255, A: 255}))
		case "/app/small.png":
			w.Write(pngBytes(t, 32, 32, color.NRGBA{R: 255, A: 255}))
		default:
			http.NotFound(w, r)
		}
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	found, e := New(allowAll).Discover(context.Background(), srv.URL+"/app/")
	if e != nil {
		t.Fatal(e)
	}
	img := found.Icon
	if found.Title != "Book shelf & more" {
		t.Fatalf("unexpected title %q", found.Title)
	}
	if b := img.Bounds(); b.Dx() != 256 || b.Dy() != 256 {
		t.Fatalf("expected the 512px icon scaled to 256, got %v", b)
	}
	if r, g, bl, _ := img.At(10, 10).RGBA(); bl == 0 || r != 0 || g != 0 {
		t.Fatal("picked the wrong icon")
	}
	for _, path := range []string{"/app/logo.svg", "/app/vector.svg", "/app/mask.png"} {
		if requested[path] {
			t.Errorf("%s must never be fetched", path)
		}
	}
}

func TestDiscoverFallsBackToFaviconWhenPageIsProtected(t *testing.T) {
	ico := icoBytes(16, 16, 32, func(x, y int) []byte { return []byte{0, 0, 255, 255} }, func(int, int) bool { return false })
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/favicon.ico" {
			w.Write(ico)
			return
		}
		http.Error(w, "sign in", http.StatusUnauthorized)
	}))
	defer srv.Close()
	found, e := New(allowAll).Discover(context.Background(), srv.URL+"/admin")
	if e != nil {
		t.Fatal(e)
	}
	img := found.Icon
	if found.Title != "" {
		t.Fatalf("a failed page must not yield a title, got %q", found.Title)
	}
	if c := color.NRGBAModel.Convert(img.At(3, 3)).(color.NRGBA); c != (color.NRGBA{R: 255, A: 255}) {
		t.Fatalf("unexpected pixel %v", c)
	}
}

func TestDiscoverRefusesDisallowedAddressesEvenAfterRedirect(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(pngBytes(t, 64, 64, color.Black))
	}))
	defer target.Close()
	if _, e := New(DefaultPolicy).Discover(context.Background(), target.URL); !errors.Is(e, ErrUnreachable) {
		t.Fatalf("loopback must be refused, got %v", e)
	}
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://169.254.169.254/latest/meta-data/", http.StatusFound)
	}))
	defer redirect.Close()
	onlyLoopback := func(a netip.Addr) bool { return a.IsLoopback() }
	if _, e := New(onlyLoopback).Discover(context.Background(), redirect.URL); e == nil {
		t.Fatal("redirect to a refused address must not yield an icon")
	}
}

func TestDiscoverRejectsOversizedAndHostileResponses(t *testing.T) {
	bomb := pngBytes(t, 16, 16, color.White)
	binary.BigEndian.PutUint32(bomb[16:], 30000) // width in IHDR; CRC mismatch is irrelevant to DecodeConfig limits
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte(`<link rel="icon" href="/huge.png"><link rel="apple-touch-icon" href="/bomb.png">` + strings.Repeat(" ", 600<<10)))
		case "/huge.png":
			w.Write(bytes.Repeat([]byte{1}, (1<<20)+10))
		case "/bomb.png":
			w.Write(bomb)
		case "/favicon.ico":
			w.Write([]byte{0, 0, 1, 0, 200, 0}) // claims 200 entries without data
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	if _, e := New(allowAll).Discover(context.Background(), srv.URL); !errors.Is(e, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", e)
	}
}

func TestDiscoverRejectsInvalidURLs(t *testing.T) {
	for _, raw := range []string{"", "ftp://example.com", "javascript:alert(1)", "https://user:pw@example.com", "http://"} {
		if _, e := New(allowAll).Discover(context.Background(), raw); !errors.Is(e, ErrInvalidURL) {
			t.Errorf("%q: got %v", raw, e)
		}
	}
}

func TestDecodeICOVariants(t *testing.T) {
	red := []byte{0, 0, 255}
	masked := icoBytes(16, 16, 24, func(int, int) []byte { return red }, func(x, y int) bool { return x < 8 })
	img, e := decode(masked)
	if e != nil {
		t.Fatal(e)
	}
	if a := color.NRGBAModel.Convert(img.At(2, 2)).(color.NRGBA).A; a != 0 {
		t.Fatal("AND mask not applied")
	}
	if c := color.NRGBAModel.Convert(img.At(12, 2)).(color.NRGBA); c != (color.NRGBA{R: 255, A: 255}) {
		t.Fatalf("unexpected 24-bit pixel %v", c)
	}
	paletted := icoBytes(16, 16, 8, func(x, _ int) []byte { return []byte{byte(x % 2)} }, func(int, int) bool { return false })
	if img, e = decode(paletted); e != nil {
		t.Fatal(e)
	}
	if c := color.NRGBAModel.Convert(img.At(1, 0)).(color.NRGBA); c != (color.NRGBA{G: 255, A: 255}) {
		t.Fatalf("unexpected palette pixel %v", c)
	}
	// Mask-only 32-bit icons have zero alpha everywhere.
	legacy := icoBytes(16, 16, 32, func(int, int) []byte { return []byte{0, 0, 255, 0} }, func(int, int) bool { return false })
	if img, e = decode(legacy); e != nil {
		t.Fatal(e)
	}
	if a := color.NRGBAModel.Convert(img.At(5, 5)).(color.NRGBA).A; a != 255 {
		t.Fatal("legacy 32-bit icon should be opaque")
	}
	embedded := pngBytes(t, 48, 48, color.White)
	var ico bytes.Buffer
	dir := make([]byte, 22)
	binary.LittleEndian.PutUint16(dir[2:], 1)
	binary.LittleEndian.PutUint16(dir[4:], 1)
	binary.LittleEndian.PutUint32(dir[14:], uint32(len(embedded)))
	binary.LittleEndian.PutUint32(dir[18:], 22)
	ico.Write(dir)
	ico.Write(embedded)
	if img, e = decode(ico.Bytes()); e != nil || img.Bounds().Dx() != 48 {
		t.Fatalf("embedded PNG entry: %v", e)
	}
	for _, broken := range [][]byte{
		{0, 0, 1, 0, 1, 0},
		append([]byte{0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0}, bytes.Repeat([]byte{0xff}, 8)...),
		masked[:60],
	} {
		if _, e := decode(broken); e == nil {
			t.Errorf("malformed icon %x decoded", broken[:min(len(broken), 12)])
		}
	}
}

func TestCleanTitle(t *testing.T) {
	long := strings.Repeat("ä", 80)
	if got := cleanTitle(long); len(got) > 100 || !utf8.ValidString(got) {
		t.Fatalf("title not cut on a rune boundary: %q", got)
	}
	if got := cleanTitle("  a\n\tb  "); got != "a b" {
		t.Fatalf("got %q", got)
	}
}
