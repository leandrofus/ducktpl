// duck:file s3
package objstore

import (
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"testing"
)

func exercise(t *testing.T, s Store) {
	ctx := context.Background()
	if err := s.Put(ctx, "files/a", strings.NewReader("hello"), 5, "text/plain"); err != nil {
		t.Fatal(err)
	}
	rc, err := s.Open(ctx, "files/a")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(rc)
	rc.Close()
	if string(b) != "hello" {
		t.Fatalf("read %q", b)
	}
	if err := s.Delete(ctx, "files/a"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Open(ctx, "files/a"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("open after delete: %v", err)
	}
}

func TestDisk(t *testing.T) {
	exercise(t, Disk{Dir: t.TempDir()})
	if err := (Disk{Dir: t.TempDir()}).Put(context.Background(), "../x", strings.NewReader(""), 0, ""); err == nil {
		t.Fatal("accepted a key outside the directory")
	}
}

// DUCKAPP_TEST_S3=1 plus DUCKAPP_S3_* (make minio prints them) runs it against a bucket.
func TestS3(t *testing.T) {
	if os.Getenv("DUCKAPP_TEST_S3") == "" {
		t.Skip("DUCKAPP_TEST_S3 not set")
	}
	s, err := NewS3(Config{Endpoint: os.Getenv("DUCKAPP_S3_ENDPOINT"), Bucket: os.Getenv("DUCKAPP_S3_BUCKET"),
		AccessKey: os.Getenv("DUCKAPP_S3_ACCESS_KEY"), SecretKey: os.Getenv("DUCKAPP_S3_SECRET_KEY"), PathStyle: true, Prefix: "test/"})
	if err != nil {
		t.Fatal(err)
	}
	exercise(t, s)
}
