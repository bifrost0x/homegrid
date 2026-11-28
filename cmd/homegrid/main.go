package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/bifrost0x/homegrid/internal/auth"
	"github.com/bifrost0x/homegrid/internal/config"
	"github.com/bifrost0x/homegrid/internal/server"
	"github.com/bifrost0x/homegrid/internal/store"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

var version = "0.1.0"
var commit = "development"

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if e := run(logger); e != nil {
		logger.Error("HomeGrid stopped", "error", e)
		os.Exit(1)
	}
}
func run(logger *slog.Logger) error {
	cfg, e := config.Load()
	if e != nil {
		return e
	}
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "healthcheck":
			return healthcheck(cfg.Listen)
		case "reset-password":
			return resetPassword(cfg.DataDir, os.Stdout)
		}
		return fmt.Errorf("unknown command %q", os.Args[1])
	}
	db, e := store.Open(cfg.DataDir)
	if e != nil {
		return fmt.Errorf("open database: %w", e)
	}
	defer db.Close()
	handler, e := server.New(server.Config{Store: db, DataDir: cfg.DataDir, SecureCookie: cfg.SecureCookie, TrustedProxies: cfg.TrustedProxies, Version: version, Commit: commit, Logger: logger})
	if e != nil {
		return e
	}
	srv := &http.Server{Addr: cfg.Listen, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	errCh := make(chan error, 1)
	go func() {
		logger.Info("HomeGrid listening", "address", cfg.Listen, "version", version)
		errCh <- srv.ListenAndServe()
	}()
	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if e = srv.Shutdown(shutdown); e != nil {
			_ = srv.Close()
			return e
		}
		err := <-errCh
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	}
}
func healthcheck(listen string) error {
	client := &http.Client{Timeout: 3 * time.Second}
	r, e := client.Get(config.HealthURL(listen))
	if e != nil {
		return e
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return fmt.Errorf("health returned HTTP %d", r.StatusCode)
	}
	var v struct {
		Status string `json:"status"`
	}
	if e = json.NewDecoder(r.Body).Decode(&v); e != nil {
		return e
	}
	if v.Status != "ok" {
		return errors.New("server is not healthy")
	}
	return nil
}

// resetPassword sets a new random administrator password and signs out every
// session. Anyone who can run commands in the container can already read the
// database, so this adds no access beyond what they have. The password is
// printed once to the terminal of the operator who ran the command; it is not
// written to the server log.
func resetPassword(dataDir string, out io.Writer) error {
	db, e := store.Open(dataDir)
	if e != nil {
		return fmt.Errorf("open database: %w", e)
	}
	defer db.Close()
	password := auth.Token()[:32]
	hash, e := auth.Hash(password)
	if e != nil {
		return fmt.Errorf("hash password: %w", e)
	}
	username, e := db.ResetPassword(context.Background(), hash)
	if errors.Is(e, store.ErrNotFound) {
		return fmt.Errorf("no administrator exists in %s; check HOMEGRID_DATA_DIR or open HomeGrid in a browser to create one", dataDir)
	}
	if e != nil {
		return fmt.Errorf("reset password: %w", e)
	}
	_, e = fmt.Fprintf(out, "Password for %q reset. All sessions were signed out.\nNew password: %s\nSign in and change it under Settings > Account.\n", username, password)
	return e
}
