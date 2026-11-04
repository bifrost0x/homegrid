package config

import "testing"

func TestLoadDefaultsAndValidation(t *testing.T) {
	for _, k := range []string{"HOMEGRID_LISTEN", "HOMEGRID_DATA_DIR", "HOMEGRID_SECURE_COOKIE", "HOMEGRID_TRUSTED_PROXIES"} {
		t.Setenv(k, "")
	}
	c, e := Load()
	if e != nil || c.Listen != "127.0.0.1:8080" || c.SecureCookie || len(c.TrustedProxies) != 0 {
		t.Fatal(c, e)
	}
	t.Setenv("HOMEGRID_LISTEN", "0.0.0.0:8080")
	c, e = Load()
	if e != nil || c.Listen != "0.0.0.0:8080" {
		t.Fatal("explicit network binding must remain available", c, e)
	}
	t.Setenv("HOMEGRID_SECURE_COOKIE", "true")
	t.Setenv("HOMEGRID_TRUSTED_PROXIES", "127.0.0.1,10.0.0.0/8,::1")
	c, e = Load()
	if e != nil || !c.SecureCookie || len(c.TrustedProxies) != 3 {
		t.Fatal(c, e)
	}
	t.Setenv("HOMEGRID_TRUSTED_PROXIES", "*")
	if _, e = Load(); e == nil {
		t.Fatal("invalid proxies accepted")
	}
	t.Setenv("HOMEGRID_TRUSTED_PROXIES", "")
	t.Setenv("HOMEGRID_SECURE_COOKIE", "maybe")
	if _, e = Load(); e == nil {
		t.Fatal("invalid boolean accepted")
	}
	t.Setenv("HOMEGRID_SECURE_COOKIE", "")
	t.Setenv("HOMEGRID_LISTEN", "8080")
	if _, e = Load(); e == nil {
		t.Fatal("invalid listen accepted")
	}
}
func TestHealthURL(t *testing.T) {
	for _, v := range []string{"0.0.0.0:8080", "[::]:8080", ":8080"} {
		if s := HealthURL(v); s != "http://127.0.0.1:8080/api/health" {
			t.Fatal(s)
		}
	}
	if s := HealthURL("127.0.0.1:8095"); s != "http://127.0.0.1:8095/api/health" {
		t.Fatal(s)
	}
}
