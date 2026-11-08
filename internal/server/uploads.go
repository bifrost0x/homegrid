package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"github.com/bifrost0x/homegrid/internal/store"
	_ "golang.org/x/image/webp"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	select {
	case s.imageSlots <- struct{}{}:
		defer func() { <-s.imageSlots }()
	default:
		fail(w, 429, "rate_limit", "Please try the image upload again shortly")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 6<<20)
	reader, e := r.MultipartReader()
	if e != nil {
		fail(w, 400, "validation", "Choose a PNG, JPEG or WebP image")
		return
	}
	part, e := reader.NextPart()
	if e != nil || part.FormName() != "file" {
		fail(w, 400, "validation", "Upload an image in the file field")
		return
	}
	raw, e := io.ReadAll(io.LimitReader(part, (5<<20)+1))
	part.Close()
	if e != nil {
		fail(w, 400, "validation", "Unable to read image")
		return
	}
	if len(raw) > 5<<20 {
		fail(w, 413, "too_large", "Images must be at most 5 MB")
		return
	}
	if _, e = reader.NextPart(); e != io.EOF {
		fail(w, 400, "validation", "Upload exactly one image")
		return
	}
	cfg, format, e := image.DecodeConfig(bytes.NewReader(raw))
	if e != nil || (format != "png" && format != "jpeg" && format != "webp") || cfg.Width < 1 || cfg.Height < 1 || int64(cfg.Width)*int64(cfg.Height) > 16000000 {
		fail(w, 400, "validation", "Use a valid PNG, JPEG or WebP with at most 16 million pixels")
		return
	}
	img, _, e := image.Decode(bytes.NewReader(raw))
	if e != nil {
		fail(w, 400, "validation", "Image could not be decoded")
		return
	}
	var out bytes.Buffer
	ext := "png"
	if format == "jpeg" {
		ext = "jpg"
		e = jpeg.Encode(&out, img, &jpeg.Options{Quality: 90})
	} else {
		e = png.Encode(&out, img)
	}
	if e != nil {
		fail(w, 400, "validation", "Unable to process image")
		return
	}
	sum := sha256.Sum256(out.Bytes())
	name := hex.EncodeToString(sum[:]) + "." + ext
	dir := filepath.Join(s.cfg.DataDir, "uploads")
	if e = os.MkdirAll(dir, 0700); e != nil {
		s.result(w, 0, nil, e)
		return
	}
	info, e := os.Stat(dir)
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	if e = os.Chmod(dir, info.Mode().Perm()&0700); e != nil {
		s.result(w, 0, nil, e)
		return
	}
	if e = writeFileAtomic(dir, name, out.Bytes()); e != nil {
		s.result(w, 0, nil, e)
		return
	}
	write(w, 201, map[string]string{"url": "/uploads/" + name})
}

// writeFileAtomic stores data under dir/name so that readers only ever observe a
// complete file. Upload names are content hashes, so replacing an existing file
// is safe and also repairs a file truncated by an earlier interrupted write.
// The temporary name starts with a dot and never matches a servable upload path.
func writeFileAtomic(dir, name string, data []byte) (err error) {
	f, err := os.CreateTemp(dir, ".upload-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer func() {
		if err != nil {
			os.Remove(tmp)
		}
	}()
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(dir, name))
}

// removeStaleUploadTemps deletes temporary upload files left behind when the
// process stopped between creating and renaming them. Only files older than
// cutoff are touched, so a concurrent upload in progress is never affected.
// Failures are logged; they never prevent startup.
func (s *Server) removeStaleUploadTemps(cutoff time.Time) {
	dir := filepath.Join(s.cfg.DataDir, "uploads")
	entries, e := os.ReadDir(dir)
	if e != nil {
		if !os.IsNotExist(e) {
			s.cfg.Logger.Warn("unable to inspect uploads", "error", e)
		}
		return
	}
	for _, entry := range entries {
		if !entry.Type().IsRegular() || !strings.HasPrefix(entry.Name(), ".upload-") {
			continue
		}
		info, e := entry.Info()
		if e != nil || !info.ModTime().Before(cutoff) {
			continue
		}
		if e = os.Remove(filepath.Join(dir, entry.Name())); e != nil && !os.IsNotExist(e) {
			s.cfg.Logger.Warn("unable to remove stale upload", "file", entry.Name(), "error", e)
		}
	}
}
func (s *Server) serveUpload(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !store.ValidUpload("/uploads/" + name) {
		fail(w, 404, "not_found", "Image not found")
		return
	}
	f, e := os.Open(filepath.Join(s.cfg.DataDir, "uploads", name))
	if e != nil {
		fail(w, 404, "not_found", "Image not found")
		return
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil || !info.Mode().IsRegular() {
		fail(w, 404, "not_found", "Image not found")
		return
	}
	contentType := "image/png"
	if strings.HasSuffix(name, ".jpg") {
		contentType = "image/jpeg"
	} else if strings.HasSuffix(name, ".webp") {
		contentType = "image/webp"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", "inline")
	http.ServeContent(w, r, name, info.ModTime(), f)
}
