package server

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func (c *client) uploadImage(raw []byte, want int) string {
	c.t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, _ := mw.CreateFormFile("file", "image.png")
	part.Write(raw)
	mw.Close()
	r := httptest.NewRequest("POST", "/api/uploads", &body)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	r.Header.Set("X-CSRF-Token", c.csrf)
	for _, cookie := range c.cookies {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	c.h.ServeHTTP(w, r)
	if w.Code != want {
		c.t.Fatalf("upload got %d want %d: %s", w.Code, want, w.Body.String())
	}
	var result map[string]string
	json.Unmarshal(w.Body.Bytes(), &result)
	return result["url"]
}

func TestUploadRepairsTruncatedFileAndLeavesNoTemporaryFiles(t *testing.T) {
	c, db := newClient(t)
	c.setup()
	var encoded bytes.Buffer
	png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 3, 3)))
	url := c.uploadImage(encoded.Bytes(), 201)
	dir := filepath.Join(db.DataDir, "uploads")
	stored := filepath.Join(dir, strings.TrimPrefix(url, "/uploads/"))
	complete, e := os.ReadFile(stored)
	if e != nil {
		t.Fatal(e)
	}
	// Simulate a file left behind by an interrupted write before atomic storage.
	if e = os.WriteFile(stored, complete[:len(complete)/2], 0600); e != nil {
		t.Fatal(e)
	}
	if again := c.uploadImage(encoded.Bytes(), 201); again != url {
		t.Fatalf("content-addressed URL changed: %s != %s", again, url)
	}
	served := c.req("GET", url, nil, 200)
	if !bytes.Equal(served, complete) {
		t.Fatal("re-upload did not repair the truncated image")
	}
	entries, e := os.ReadDir(dir)
	if e != nil {
		t.Fatal(e)
	}
	if len(entries) != 1 || entries[0].Name() != filepath.Base(stored) {
		names := []string{}
		for _, entry := range entries {
			names = append(names, entry.Name())
		}
		t.Fatalf("unexpected upload directory contents: %v", names)
	}
}

func TestPanicRecoveryAndAbortHandler(t *testing.T) {
	c, _ := newClient(t)
	s := c.h.(*Server)
	s.mux.HandleFunc("GET /test/panic", func(http.ResponseWriter, *http.Request) { panic("boom") })
	s.mux.HandleFunc("GET /test/abort", func(http.ResponseWriter, *http.Request) { panic(http.ErrAbortHandler) })
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/test/panic", nil))
	if w.Code != 500 || strings.Contains(w.Body.String(), "boom") {
		t.Fatalf("panic response %d: %s", w.Code, w.Body.String())
	}
	defer func() {
		if v := recover(); v != http.ErrAbortHandler {
			t.Fatalf("abort handler was not propagated: %v", v)
		}
	}()
	s.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/test/abort", nil))
	t.Fatal("abort handler returned normally")
}
