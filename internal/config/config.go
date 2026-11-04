package config

import (
	"fmt"
	"net"
	"net/netip"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Listen, DataDir string
	SecureCookie    bool
	TrustedProxies  []netip.Prefix
}

func Load() (Config, error) {
	c := Config{Listen: "0.0.0.0:8080", DataDir: "./data"}
	if v := os.Getenv("HOMEGRID_LISTEN"); v != "" {
		c.Listen = v
	}
	if v := os.Getenv("HOMEGRID_DATA_DIR"); v != "" {
		c.DataDir = v
	}
	if _, _, e := net.SplitHostPort(c.Listen); e != nil {
		return c, fmt.Errorf("HOMEGRID_LISTEN must be a host:port address: %w", e)
	}
	if v := os.Getenv("HOMEGRID_SECURE_COOKIE"); v != "" {
		b, e := strconv.ParseBool(v)
		if e != nil {
			return c, fmt.Errorf("HOMEGRID_SECURE_COOKIE must be true or false")
		}
		c.SecureCookie = b
	}
	if v := os.Getenv("HOMEGRID_TRUSTED_PROXIES"); v != "" {
		for _, part := range strings.Split(v, ",") {
			part = strings.TrimSpace(part)
			p, e := netip.ParsePrefix(part)
			if e != nil {
				ip, err := netip.ParseAddr(part)
				if err != nil {
					return c, fmt.Errorf("invalid trusted proxy %q", part)
				}
				p = netip.PrefixFrom(ip, ip.BitLen())
			}
			c.TrustedProxies = append(c.TrustedProxies, p.Masked())
		}
	}
	return c, nil
}
func HealthURL(listen string) string {
	host, port, e := net.SplitHostPort(listen)
	if e != nil {
		return "http://127.0.0.1:8080/api/health"
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port) + "/api/health"
}
