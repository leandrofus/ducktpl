// duck:file s3
// Package objstore keeps file contents: in an S3-compatible bucket (AWS,
// MinIO, R2, Garage…) when configured, else in a local directory.
package objstore

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var ErrNotFound = errors.New("object not found")

type Store interface {
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
}

// ---- local directory ----

type Disk struct{ Dir string }

func (d Disk) path(key string) (string, error) {
	if key == "" || strings.Contains(key, "..") || filepath.IsAbs(key) {
		return "", fmt.Errorf("invalid key %q", key)
	}
	return filepath.Join(d.Dir, filepath.FromSlash(key)), nil
}

func (d Disk) Put(_ context.Context, key string, body io.Reader, size int64, _ string) error {
	p, err := d.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o750); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(p), ".up-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	n, err := io.Copy(tmp, body)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil && size >= 0 && n != size {
		err = fmt.Errorf("short upload: %d of %d bytes", n, size)
	}
	if err != nil {
		return err
	}
	return os.Rename(tmp.Name(), p)
}

func (d Disk) Open(_ context.Context, key string) (io.ReadCloser, error) {
	p, err := d.path(key)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(p)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	return f, err
}

func (d Disk) Delete(_ context.Context, key string) error {
	p, err := d.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// ---- S3 ----

// Config is the DUCKAPP_S3_* settings.
type Config struct {
	Endpoint  string // http(s)://host[:port]
	Bucket    string
	Region    string
	Prefix    string
	AccessKey string
	SecretKey string
	PathStyle bool // MinIO and most self-hosted servers need it
}

type S3 struct {
	c      *minio.Client
	bucket string
	prefix string
}

func NewS3(cfg Config) (*S3, error) {
	u, err := url.Parse(cfg.Endpoint)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("S3 endpoint %q must be an http(s) URL", cfg.Endpoint)
	}
	if cfg.Bucket == "" || cfg.AccessKey == "" || cfg.SecretKey == "" {
		return nil, errors.New("S3 needs a bucket, an access key and a secret key")
	}
	lookup := minio.BucketLookupDNS
	if cfg.PathStyle {
		lookup = minio.BucketLookupPath
	}
	region := cfg.Region
	if region == "" {
		region = "us-east-1"
	}
	c, err := minio.New(u.Host, &minio.Options{Creds: credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: u.Scheme == "https", Region: region, BucketLookup: lookup})
	if err != nil {
		return nil, err
	}
	return &S3{c: c, bucket: cfg.Bucket, prefix: cfg.Prefix}, nil
}

// Check verifies the bucket exists and the credentials reach it.
func (s *S3) Check(ctx context.Context) error {
	ok, err := s.c.BucketExists(ctx, s.bucket)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("bucket %q does not exist", s.bucket)
	}
	return nil
}

func (s *S3) Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error {
	_, err := s.c.PutObject(ctx, s.bucket, s.prefix+key, body, size, minio.PutObjectOptions{ContentType: contentType})
	return err
}

func (s *S3) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	o, err := s.c.GetObject(ctx, s.bucket, s.prefix+key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	// GetObject is lazy: Stat surfaces a missing key now.
	if _, err := o.Stat(); err != nil {
		o.Close()
		if minio.ToErrorResponse(err).Code == "NoSuchKey" {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return o, nil
}

func (s *S3) Delete(ctx context.Context, key string) error {
	return s.c.RemoveObject(ctx, s.bucket, s.prefix+key, minio.RemoveObjectOptions{})
}
