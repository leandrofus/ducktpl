// duck:file pam
//go:build linux && cgo && pam

package auth

import (
	"errors"
	"fmt"
	"sync"

	"github.com/msteinert/pam/v2"
)

const pamCompiled = true

// some PAM modules are not thread-safe; logins are rare, serialize them
var pamMu sync.Mutex

// pamAuthenticate runs the auth and account stacks of service.
func pamAuthenticate(service, username, password, rhost string) error {
	pamMu.Lock()
	defer pamMu.Unlock()
	t, err := pam.StartFunc(service, username, func(s pam.Style, msg string) (string, error) {
		switch s {
		case pam.PromptEchoOff:
			return password, nil
		case pam.PromptEchoOn:
			return username, nil
		case pam.ErrorMsg, pam.TextInfo:
			return "", nil
		}
		return "", errors.New("unsupported PAM conversation")
	})
	if err != nil {
		return err
	}
	defer t.End()
	if rhost != "" {
		_ = t.SetItem(pam.Rhost, rhost)
	}
	if err := t.Authenticate(pam.DisallowNullAuthtok); err != nil {
		return ErrBadPassword
	}
	if err := t.AcctMgmt(pam.DisallowNullAuthtok); err != nil {
		return fmt.Errorf("account not valid: %v", err)
	}
	return nil
}
