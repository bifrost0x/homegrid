package main

import (
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
)

func main() {
	upstream, _ := url.Parse("http://127.0.0.1:8096")
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		director(r)
		r.Header.Del("X-Forwarded-Proto")
		r.Header.Del("X-Forwarded-Host")
	}
	srv := httptest.NewUnstartedServer(proxy)
	srv.Listener.Close()
	listener, err := net.Listen("tcp", "127.0.0.1:8443")
	if err != nil {
		panic(err)
	}
	srv.Listener = listener
	srv.StartTLS()
	defer srv.Close()
	fmt.Println("TLS proxy ready at https://127.0.0.1:8443")
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt)
	<-signals
}
