package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"testing"
)

func TestReverseProxyOriginDiagnostics(t *testing.T) {
	c, db := newClient(t)
	c.setup()
	s, err := New(Config{Store: db, DataDir: db.DataDir, SecureCookie: true})
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name, peer, origin, site, token, host, code string
		status                                      int
	}{
		{"preserved public HTTPS host", "192.0.2.10:4567", "https://dashboard.example", "same-origin", "valid", "dashboard.example", "", 200},
		{"TLS termination without trusted proxies", "192.0.2.11:4567", "https://dashboard.example", "same-origin", "valid", "dashboard.example", "", 200},
		{"foreign origin", "192.0.2.10:4567", "https://foreign.example", "cross-site", "valid", "dashboard.example", "origin", 403},
		{"foreign origin without fetch metadata", "192.0.2.10:4567", "https://foreign.example", "", "valid", "dashboard.example", "origin", 403},
		{"cross-site fetch", "192.0.2.10:4567", "https://dashboard.example", "cross-site", "valid", "dashboard.example", "origin", 403},
		{"rewritten private host", "192.0.2.10:4567", "https://dashboard.example", "same-origin", "valid", "private-homegrid:8080", "origin", 403},
		{"TLS termination without forwarded proto", "192.0.2.11:4567", "https://dashboard.example", "same-origin", "valid", "dashboard.example", "", 200},
		{"same-site fetch", "192.0.2.10:4567", "https://dashboard.example", "same-site", "valid", "dashboard.example", "origin", 403},
		{"unknown fetch", "192.0.2.10:4567", "https://dashboard.example", "unexpected", "valid", "dashboard.example", "origin", 403},
		{"spoofed same-origin metadata", "192.0.2.10:4567", "https://foreign.example", "same-origin", "valid", "dashboard.example", "origin", 403},
		{"different port", "192.0.2.10:4567", "https://dashboard.example:443", "same-origin", "valid", "dashboard.example", "origin", 403},
		{"matching port", "192.0.2.10:4567", "https://dashboard.example:9443", "none", "valid", "dashboard.example:9443", "", 200},
		{"bad token", "192.0.2.10:4567", "https://dashboard.example", "same-origin", "invalid", "dashboard.example", "csrf", 403},
	}
	for _, mode := range []string{"preauth", "protected"} {
		t.Run(mode, func(t *testing.T) {
			for _, tc := range cases {
				t.Run(tc.name, func(t *testing.T) {
					cookies := c.cookies
					token := c.csrf
					path := "/api/categories"
					body := `{"name":"Proxy test"}`
					if mode == "preauth" {
						session := httptest.NewRecorder()
						s.ServeHTTP(session, httptest.NewRequest("GET", "http://dashboard.example/api/auth/session", nil))
						if session.Code != 200 {
							t.Fatal(session.Code, session.Body.String())
						}
						var v struct {
							CSRF string `json:"csrf_token"`
						}
						if err := json.Unmarshal(session.Body.Bytes(), &v); err != nil {
							t.Fatal(err)
						}
						cookies = session.Result().Cookies()
						token = v.CSRF
						path = "/api/auth/login"
						body = `{"username":"admin","password":"a-secure-test-password"}`
					}
					if tc.token != "valid" {
						token = strings.Repeat("a", 64)
					}
					r := httptest.NewRequest("POST", "http://"+tc.host+path, strings.NewReader(body))
					r.RemoteAddr = tc.peer
					r.Header.Set("Content-Type", "application/json")
					r.Header.Set("Origin", tc.origin)
					r.Header.Set("Sec-Fetch-Site", tc.site)
					if tc.name != "TLS termination without forwarded proto" {
						r.Header.Set("X-Forwarded-Proto", "https")
					}
					r.Header.Set("X-Forwarded-Host", "foreign.example")
					r.Header.Set("X-CSRF-Token", token)
					for _, cookie := range cookies {
						r.AddCookie(cookie)
					}
					w := httptest.NewRecorder()
					s.ServeHTTP(w, r)
					wantStatus := tc.status
					if mode == "protected" && wantStatus == 200 {
						wantStatus = http.StatusCreated
					}
					if w.Code != wantStatus {
						t.Fatal(w.Code, w.Body.String())
					}
					if tc.code == "" {
						if mode == "preauth" {
							found := false
							for _, cookie := range w.Result().Cookies() {
								if cookie.Name == sessionCookie && cookie.Value != "" {
									found = true
									if !cookie.Secure {
										t.Fatal("session cookie is not secure")
									}
								}
							}
							if !found {
								t.Fatal("login did not create a session")
							}
						}
						return
					}
					var got struct {
						Error struct{ Code, Message string } `json:"error"`
					}
					if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
						t.Fatal(err)
					}
					if got.Error.Code != tc.code {
						t.Fatal(got.Error)
					}
					if tc.code == "origin" && got.Error.Message != "This address is not allowed. Check HomeGrid's reverse proxy configuration." {
						t.Fatal(got.Error)
					}
					if strings.Contains(w.Body.String(), "private-homegrid") || strings.Contains(w.Body.String(), "8080") {
						t.Fatal("private expected address leaked", w.Body.String())
					}
				})
			}
		})
	}
}

func TestOriginStrictSyntaxAndProxyIndependentAuthority(t *testing.T) {
	s := &Server{}
	for _, origin := range []string{"null", "https:dashboard.example", "//dashboard.example", "ftp://dashboard.example", "https://dashboard.example/", "https://dashboard.example?", "https://dashboard.example#", "https://user@dashboard.example", "https://dashboard.example/path", "https://dashboard.example?query", "https://dashboard.example#fragment", "https://dashboard.example https://foreign.example", "https://dashboard.example:443"} {
		t.Run(origin, func(t *testing.T) {
			r := httptest.NewRequest("POST", "http://dashboard.example/api/apps", nil)
			r.Header.Set("Origin", origin)
			r.Header.Set("Sec-Fetch-Site", "same-origin")
			if s.sameOrigin(r) {
				t.Fatal("accepted malformed or foreign authority", origin)
			}
		})
	}
	for _, site := range []string{"", "same-origin", "none"} {
		r := httptest.NewRequest("POST", "http://dashboard.example/api/apps", nil)
		r.Header.Set("Sec-Fetch-Site", site)
		if !s.sameOrigin(r) {
			t.Fatal("rejected API request without Origin", site)
		}
	}
}

func TestHTTPSReverseProxySetupLoginAndProtectedCRUD(t *testing.T) {
	_, db := newClient(t)
	s, err := New(Config{Store: db, DataDir: db.DataDir, SecureCookie: true})
	if err != nil {
		t.Fatal(err)
	}
	backend := httptest.NewServer(s)
	defer backend.Close()
	upstream, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		director(r)
		r.Header.Del("X-Forwarded-Proto")
		r.Header.Del("X-Forwarded-Host")
	}
	public := httptest.NewTLSServer(proxy)
	defer public.Close()
	client := public.Client()
	client.Jar, _ = cookiejar.New(nil)
	csrf := ""
	request := func(method, path, body string, status int) []byte {
		t.Helper()
		r, err := http.NewRequest(method, public.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		r.Header.Set("Content-Type", "application/json")
		if method != "GET" {
			r.Header.Set("Origin", public.URL)
			r.Header.Set("Sec-Fetch-Site", "same-origin")
			r.Header.Set("X-CSRF-Token", csrf)
		}
		response, err := client.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		b, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != status {
			t.Fatalf("%s %s: %d %s", method, path, response.StatusCode, b)
		}
		return b
	}
	refresh := func(b []byte) {
		t.Helper()
		var v struct {
			CSRF string `json:"csrf_token"`
		}
		if err := json.Unmarshal(b, &v); err != nil || len(v.CSRF) != 64 {
			t.Fatal(string(b), err)
		}
		csrf = v.CSRF
	}
	refresh(request("GET", "/api/auth/session", "", 200))
	credentials := `{"username":"admin","password":"a-secure-test-password"}`
	refresh(request("POST", "/api/auth/setup", credentials, 201))
	request("POST", "/api/auth/logout", `{}`, 204)
	refresh(request("GET", "/api/auth/session", "", 200))
	refresh(request("POST", "/api/auth/login", credentials, 200))
	request("POST", "/api/categories", `{"name":"TLS proxy CRUD"}`, 201)
	request("POST", "/api/apps", `{"name":"Service","url":"https://service.example","category_id":2}`, 201)
	request("PATCH", "/api/apps/1", `{"name":"Updated service","url":"https://service.example","category_id":2}`, 200)
	apps := request("GET", "/api/apps", "", 200)
	if !strings.Contains(string(apps), "Updated service") {
		t.Fatal(string(apps))
	}
	request("DELETE", "/api/apps/1", "", 204)
	request("DELETE", "/api/categories/2", "", 204)
}
