package email

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"io"
	"math/big"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"strconv"
	"strings"
	"testing"
	"time"
)

type fakeServer struct {
	addr     string
	tls      *tls.Config
	client   *tls.Config
	auth     chan string
	data     chan string
	starttls bool
}

func selfSignedTLS(t *testing.T) (server, client *tls.Config) {
	t.Helper()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "127.0.0.1"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, _ := x509.ParseCertificate(der)
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	return &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}},
		&tls.Config{ServerName: "127.0.0.1", RootCAs: pool, MinVersion: tls.VersionTLS12}
}

func startFakeServer(t *testing.T, starttls bool) *fakeServer {
	t.Helper()
	serverTLS, clientTLS := selfSignedTLS(t)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	fs := &fakeServer{addr: ln.Addr().String(), tls: serverTLS, client: clientTLS, auth: make(chan string, 1), data: make(chan string, 1), starttls: starttls}
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		fs.serve(conn)
	}()
	return fs
}

func (fs *fakeServer) serve(conn net.Conn) {
	defer conn.Close()
	r := bufio.NewReader(conn)
	write := func(s string) { _, _ = io.WriteString(conn, s+"\r\n") }
	secure := false
	write("220 fake ready")
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		cmd := strings.TrimSpace(line)
		switch upper := strings.ToUpper(cmd); {
		case strings.HasPrefix(upper, "EHLO"):
			if fs.starttls && !secure {
				write("250-fake")
				write("250-STARTTLS")
			} else {
				write("250-fake")
			}
			write("250 AUTH PLAIN")
		case upper == "STARTTLS":
			write("220 go ahead")
			tlsConn := tls.Server(conn, fs.tls)
			if tlsConn.Handshake() != nil {
				return
			}
			conn, r, secure = tlsConn, bufio.NewReader(tlsConn), true
			write = func(s string) { _, _ = io.WriteString(tlsConn, s+"\r\n") }
		case strings.HasPrefix(upper, "AUTH PLAIN"):
			fs.auth <- strings.TrimSpace(cmd[len("AUTH PLAIN"):])
			write("235 ok")
		case strings.HasPrefix(upper, "MAIL FROM"), strings.HasPrefix(upper, "RCPT TO"):
			write("250 ok")
		case upper == "DATA":
			write("354 send it")
			var body strings.Builder
			for {
				l, err := r.ReadString('\n')
				if err != nil {
					return
				}
				if l == ".\r\n" {
					break
				}
				body.WriteString(l)
			}
			fs.data <- body.String()
			write("250 queued")
		case upper == "QUIT":
			write("221 bye")
			return
		default:
			write("500 unknown")
		}
	}
}

func newTestSMTP(t *testing.T, fs *fakeServer) *SMTP {
	t.Helper()
	host, portText, _ := net.SplitHostPort(fs.addr)
	port, _ := strconv.Atoi(portText)
	s, err := NewSMTP(host, port, "csimap.signin@gmail.com", "app-password", "CSI Map <csimap.signin@gmail.com>", testRenderer(t))
	if err != nil {
		t.Fatal(err)
	}
	s.tlsConfig = fs.client
	return s
}

func TestSMTPSendsOverTLS(t *testing.T) {
	fs := startFakeServer(t, true)
	s := newTestSMTP(t, fs)

	if err := s.SendLoginCode(context.Background(), "jane.doe12@stu-mail.csi.cuny.edu", "12345678"); err != nil {
		t.Fatal(err)
	}

	decoded, _ := base64.StdEncoding.DecodeString(<-fs.auth)
	if string(decoded) != "\x00csimap.signin@gmail.com\x00app-password" {
		t.Fatalf("unexpected credentials: %q", decoded)
	}

	raw := <-fs.data
	msg, err := mail.ReadMessage(strings.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	subject, _ := new(mime.WordDecoder).DecodeHeader(msg.Header.Get("Subject"))
	if subject != "Your CSI Map sign-in code" || strings.Contains(subject, "12345678") {
		t.Fatalf("subject %q", subject)
	}
	if msg.Header.Get("To") != "<jane.doe12@stu-mail.csi.cuny.edu>" || !strings.Contains(msg.Header.Get("From"), "csimap.signin@gmail.com") {
		t.Fatalf("headers %v", msg.Header)
	}

	_, params, _ := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	alternative := multipart.NewReader(msg.Body, params["boundary"])

	textPart, err := alternative.NextPart()
	if err != nil {
		t.Fatal(err)
	}
	text, _ := io.ReadAll(quotedprintable.NewReader(textPart))
	if !strings.Contains(string(text), "1234 5678") {
		t.Fatalf("plain text part is missing the code: %s", text)
	}

	relatedPart, err := alternative.NextPart()
	if err != nil {
		t.Fatal(err)
	}
	_, relatedParams, _ := mime.ParseMediaType(relatedPart.Header.Get("Content-Type"))
	related := multipart.NewReader(relatedPart, relatedParams["boundary"])
	htmlPart, err := related.NextPart()
	if err != nil {
		t.Fatal(err)
	}
	html, _ := io.ReadAll(quotedprintable.NewReader(htmlPart))
	if !strings.Contains(string(html), "1234 5678") || !strings.Contains(string(html), "cid:"+LogoContentID) {
		t.Fatal("html part should show the code and point at the attached logo")
	}

	logoPart, err := related.NextPart()
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := io.ReadAll(logoPart)
	logo, err := base64.StdEncoding.DecodeString(strings.Join(strings.Fields(string(encoded)), ""))
	if logoPart.Header.Get("Content-Id") != "<"+LogoContentID+">" || err != nil || !bytes.Equal(logo, Logo) {
		t.Fatalf("logo attachment is wrong: %v %v", logoPart.Header, err)
	}
}

func TestSMTPRefusesPlaintextServers(t *testing.T) {
	fs := startFakeServer(t, false)
	s := newTestSMTP(t, fs)
	err := s.SendLoginCode(context.Background(), "jane@stu-mail.csi.cuny.edu", "12345678")
	if err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatalf("expected a STARTTLS refusal, got %v", err)
	}
	select {
	case <-fs.auth:
		t.Fatal("the password must not be sent without TLS")
	default:
	}
}

func TestBuildMessageRejectsHeaderInjection(t *testing.T) {
	from, _ := mail.ParseAddress("CSI Map <a@b.com>")
	msg, err := testRenderer(t).LoginCode("victim@x.com", "12345678", 10, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := buildMessage(from, "victim@x.com\r\nBcc: everyone@x.com", msg, nil, time.Now()); err == nil {
		t.Fatal("line breaks in headers must be rejected")
	}
}
