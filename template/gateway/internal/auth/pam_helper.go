// duck:file pam
package auth

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"time"
)

// HelperSocket is where the socket-activated root helper listens
// (duckapp-pam.socket, root:duckapp 0660). The gateway itself runs
// unprivileged and only asks the helper "is this password right?".
const HelperSocket = "/run/duckapp/pam.sock"

var ErrBadPassword = errors.New("wrong username or password")

type helperReq struct {
	User     string `json:"user"`
	Password string `json:"password"`
	Rhost    string `json:"rhost"`
}

type helperResp struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// checkPassword asks the helper when running unprivileged and it is there,
// else PAM in-process.
func checkPassword(service, user, password, rhost string) error {
	if user == "" || password == "" {
		return ErrBadPassword
	}
	if os.Geteuid() != 0 && fileExists(HelperSocket) {
		return viaHelper(helperReq{user, password, rhost})
	}
	if !pamCompiled {
		return ErrUnavailable
	}
	return pamAuthenticate(service, user, password, rhost)
}

func viaHelper(req helperReq) error {
	conn, err := net.DialTimeout("unix", HelperSocket, 5*time.Second)
	if err != nil {
		return err
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(40 * time.Second))
	if err := json.NewEncoder(conn).Encode(req); err != nil {
		return err
	}
	var resp helperResp
	if err := json.NewDecoder(conn).Decode(&resp); err != nil {
		return errors.New("invalid response from the PAM helper")
	}
	switch {
	case resp.OK:
		return nil
	case resp.Error == ErrBadPassword.Error():
		return ErrBadPassword
	}
	return errors.New(resp.Error)
}

// ServeHelper answers one request on rw (stdin/stdout under systemd socket
// activation with Accept=yes). The PAM service comes from the helper's own
// command line, never from the less trusted client, so a caller cannot pick
// a permissive stack. Failures are delayed.
func ServeHelper(service string, r io.Reader, w io.Writer) error {
	var req helperReq
	if err := json.NewDecoder(bufio.NewReader(io.LimitReader(r, 64<<10))).Decode(&req); err != nil {
		return json.NewEncoder(w).Encode(helperResp{Error: "invalid request"})
	}
	if !pamCompiled {
		return json.NewEncoder(w).Encode(helperResp{Error: ErrUnavailable.Error()})
	}
	if err := pamAuthenticate(service, req.User, req.Password, req.Rhost); err != nil {
		time.Sleep(time.Second)
		return json.NewEncoder(w).Encode(helperResp{Error: err.Error()})
	}
	return json.NewEncoder(w).Encode(helperResp{OK: true})
}
