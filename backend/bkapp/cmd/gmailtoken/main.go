// Command gmailtoken does the one time Google sign in that EMAIL_MODE=gmail needs.
//
// Run it on your own computer, not on the server:
//
//	go run ./cmd/gmailtoken -id <client id> -secret <client secret>
//
// It prints a link, waits for you to approve it in the browser, and prints the refresh token to put
// in GMAIL_REFRESH_TOKEN. The token is a password for sending mail as that account: paste it into
// the host's environment settings and nowhere else.
package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"csimap/bkapp/internal/email"
)

const (
	authorizeURL = "https://accounts.google.com/o/oauth2/v2/auth"
	tokenURL     = "https://oauth2.googleapis.com/token"
	waitFor      = 5 * time.Minute
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run() error {
	clientID := flag.String("id", "", "OAuth client id from the Google Cloud console")
	clientSecret := flag.String("secret", "", "OAuth client secret from the Google Cloud console")
	flag.Parse()

	if *clientID == "" || *clientSecret == "" {
		return errors.New("pass -id and -secret from the Desktop app OAuth client you created")
	}

	// A loopback address is the redirect Google allows for a desktop client, and the code never
	// leaves this machine. PKCE ties the code to this run so a stray copy of it is useless.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer listener.Close()
	redirect := fmt.Sprintf("http://127.0.0.1:%d/", listener.Addr().(*net.TCPAddr).Port)

	verifier, err := randomString()
	if err != nil {
		return err
	}
	state, err := randomString()
	if err != nil {
		return err
	}
	digest := sha256.Sum256([]byte(verifier))

	query := url.Values{
		"client_id":             {*clientID},
		"redirect_uri":          {redirect},
		"response_type":         {"code"},
		"scope":                 {email.GmailScope},
		"access_type":           {"offline"},
		"prompt":                {"consent"},
		"state":                 {state},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(digest[:])},
		"code_challenge_method": {"S256"},
	}

	fmt.Println("Open this link, sign in as the account that sends the codes, and allow it:")
	fmt.Println()
	fmt.Println(authorizeURL + "?" + query.Encode())
	fmt.Println()
	fmt.Println("Waiting for the browser...")

	code, err := waitForCode(listener, state)
	if err != nil {
		return err
	}

	refresh, err := exchange(*clientID, *clientSecret, code, verifier, redirect)
	if err != nil {
		return err
	}

	fmt.Println()
	fmt.Println("Done. Set these on the server:")
	fmt.Println()
	fmt.Println("EMAIL_MODE=gmail")
	fmt.Println("GMAIL_CLIENT_ID=" + *clientID)
	fmt.Println("GMAIL_CLIENT_SECRET=" + *clientSecret)
	fmt.Println("GMAIL_REFRESH_TOKEN=" + refresh)
	return nil
}

func waitForCode(listener net.Listener, state string) (string, error) {
	type result struct {
		code string
		err  error
	}
	done := make(chan result, 1)

	server := &http.Server{
		ReadHeaderTimeout: 5 * time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/" {
				http.NotFound(w, r)
				return
			}
			q := r.URL.Query()
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")

			if subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(state)) != 1 {
				http.Error(w, "That request did not come from the link this tool printed.", http.StatusBadRequest)
				return
			}
			if problem := q.Get("error"); problem != "" {
				fmt.Fprintln(w, "Google reported: "+problem)
				done <- result{err: fmt.Errorf("google reported %q", problem)}
				return
			}
			code := q.Get("code")
			if code == "" {
				http.Error(w, "No code came back.", http.StatusBadRequest)
				return
			}
			fmt.Fprintln(w, "Got it. You can close this tab and go back to the terminal.")
			done <- result{code: code}
		}),
	}
	go func() { _ = server.Serve(listener) }()

	ctx, cancel := context.WithTimeout(context.Background(), waitFor)
	defer cancel()
	defer func() {
		stop, cancelStop := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancelStop()
		_ = server.Shutdown(stop)
	}()

	select {
	case res := <-done:
		return res.code, res.err
	case <-ctx.Done():
		return "", errors.New("nothing came back from the browser in time")
	}
}

func exchange(clientID, clientSecret, code, verifier, redirect string) (string, error) {
	form := url.Values{
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"code":          {code},
		"code_verifier": {verifier},
		"grant_type":    {"authorization_code"},
		"redirect_uri":  {redirect},
	}
	res, err := (&http.Client{Timeout: 15 * time.Second}).Post(tokenURL, "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if err != nil {
		return "", err
	}
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("google refused the sign in (%d)", res.StatusCode)
	}

	var parsed struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", err
	}
	if parsed.RefreshToken == "" {
		return "", errors.New("google did not return a refresh token, remove the app at myaccount.google.com/permissions and run this again")
	}
	return parsed.RefreshToken, nil
}

func randomString() (string, error) {
	buf := make([]byte, 48)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
