package email

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

const smtpTimeout = 20 * time.Second

// SMTP sends through any mail server with a login, such as a free Gmail account with an app password.
// Port 465 uses TLS from the first byte; any other port must upgrade with STARTTLS, and the password
// is never sent over an unencrypted connection.
type SMTP struct {
	host      string
	port      int
	username  string
	password  string
	from      *mail.Address
	renderer  *Renderer
	tlsConfig *tls.Config
}

func NewSMTP(host string, port int, username, password, from string, renderer *Renderer) (*SMTP, error) {
	sender, err := mail.ParseAddress(from)
	if err != nil {
		return nil, fmt.Errorf("parse EMAIL_FROM: %w", err)
	}
	return &SMTP{
		host:      host,
		port:      port,
		username:  username,
		password:  password,
		from:      sender,
		renderer:  renderer,
		tlsConfig: &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12},
	}, nil
}

func (s *SMTP) SendLoginCode(ctx context.Context, to, code string) error {
	if strings.ContainsAny(to, "\r\n") {
		return errors.New("send email: invalid recipient")
	}
	msg, err := s.renderer.LoginCode(to, code, CodeMinutes, "cid:"+LogoContentID)
	if err != nil {
		return err
	}
	body, err := buildMessage(s.from, to, msg, Logo, time.Now())
	if err != nil {
		return err
	}
	if err := s.deliver(ctx, to, body); err != nil {
		return fmt.Errorf("send email: %w", err)
	}
	return nil
}

func (s *SMTP) deliver(ctx context.Context, to string, body []byte) error {
	ctx, cancel := context.WithTimeout(ctx, smtpTimeout)
	defer cancel()

	addr := net.JoinHostPort(s.host, strconv.Itoa(s.port))
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	var conn net.Conn
	var err error
	if s.port == 465 {
		conn, err = (&tls.Dialer{NetDialer: dialer, Config: s.tlsConfig}).DialContext(ctx, "tcp", addr)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return err
	}
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}

	client, err := smtp.NewClient(conn, s.host)
	if err != nil {
		_ = conn.Close()
		return err
	}
	defer client.Close()

	if s.port != 465 {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			return errors.New("server does not offer STARTTLS, refusing to send the password unencrypted")
		}
		if err := client.StartTLS(s.tlsConfig); err != nil {
			return err
		}
	}
	if err := client.Auth(smtp.PlainAuth("", s.username, s.password, s.host)); err != nil {
		return err
	}
	if err := client.Mail(s.from.Address); err != nil {
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(body); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return client.Quit()
}
