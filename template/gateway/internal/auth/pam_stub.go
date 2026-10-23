// duck:file pam
//go:build !(linux && cgo && pam)

package auth

// pamCompiled: PAM needs `-tags pam`, CGO and the libpam headers
// (libpam0g-dev / pam-devel); `make build-pam` does it.
const pamCompiled = false

func pamAuthenticate(service, username, password, rhost string) error { return ErrUnavailable }
