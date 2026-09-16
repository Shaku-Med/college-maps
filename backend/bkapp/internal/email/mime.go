package email

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"net/textproto"
	"strings"
	"time"
)

// buildMessage lays the email out the way mail apps expect for an HTML body with an attached logo:
//
//	multipart/alternative
//	  text/plain
//	  multipart/related
//	    text/html
//	    image/png (Content-ID matches cid: in the HTML)
func buildMessage(from *mail.Address, to string, msg Rendered, logo []byte, now time.Time) ([]byte, error) {
	for _, value := range []string{to, msg.Subject} {
		if strings.ContainsAny(value, "\r\n") {
			return nil, errors.New("send email: header contains a line break")
		}
	}

	var related bytes.Buffer
	rw := multipart.NewWriter(&related)
	if err := writeQuotedPrintable(rw, "text/html; charset=utf-8", msg.HTML); err != nil {
		return nil, err
	}
	if len(logo) > 0 {
		part, err := rw.CreatePart(textproto.MIMEHeader{
			"Content-Type":              {"image/png"},
			"Content-Transfer-Encoding": {"base64"},
			"Content-ID":                {"<" + LogoContentID + ">"},
			"Content-Disposition":       {`inline; filename="logo.png"`},
		})
		if err != nil {
			return nil, err
		}
		encoded := base64.StdEncoding.EncodeToString(logo)
		for len(encoded) > 76 {
			fmt.Fprintf(part, "%s\r\n", encoded[:76])
			encoded = encoded[76:]
		}
		fmt.Fprintf(part, "%s\r\n", encoded)
	}
	if err := rw.Close(); err != nil {
		return nil, err
	}

	var alternative bytes.Buffer
	aw := multipart.NewWriter(&alternative)
	if err := writeQuotedPrintable(aw, "text/plain; charset=utf-8", msg.Text); err != nil {
		return nil, err
	}
	part, err := aw.CreatePart(textproto.MIMEHeader{"Content-Type": {`multipart/related; boundary="` + rw.Boundary() + `"`}})
	if err != nil {
		return nil, err
	}
	if _, err := part.Write(related.Bytes()); err != nil {
		return nil, err
	}
	if err := aw.Close(); err != nil {
		return nil, err
	}

	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		return nil, err
	}
	_, domain, _ := strings.Cut(from.Address, "@")

	var out bytes.Buffer
	for _, h := range [][2]string{
		{"From", from.String()},
		{"To", "<" + to + ">"},
		{"Subject", mime.QEncoding.Encode("utf-8", msg.Subject)},
		{"Date", now.Format(time.RFC1123Z)},
		{"Message-ID", "<" + hex.EncodeToString(id) + "@" + domain + ">"},
		{"MIME-Version", "1.0"},
		{"Auto-Submitted", "auto-generated"},
		{"Content-Type", `multipart/alternative; boundary="` + aw.Boundary() + `"`},
	} {
		fmt.Fprintf(&out, "%s: %s\r\n", h[0], h[1])
	}
	out.WriteString("\r\n")
	out.Write(alternative.Bytes())
	return out.Bytes(), nil
}

func writeQuotedPrintable(w *multipart.Writer, contentType, body string) error {
	part, err := w.CreatePart(textproto.MIMEHeader{
		"Content-Type":              {contentType},
		"Content-Transfer-Encoding": {"quoted-printable"},
	})
	if err != nil {
		return err
	}
	qp := quotedprintable.NewWriter(part)
	normalized := strings.ReplaceAll(strings.ReplaceAll(body, "\r\n", "\n"), "\n", "\r\n")
	if _, err := qp.Write([]byte(normalized)); err != nil {
		return err
	}
	return qp.Close()
}
