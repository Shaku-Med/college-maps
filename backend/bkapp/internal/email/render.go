package email

import (
	"bytes"
	"embed"
	"errors"
	"fmt"
	htmltemplate "html/template"
	"net/url"
	"regexp"
	"strings"
	texttemplate "text/template"

	"csimap/bkapp/internal/campus"
)

//go:embed templates/*.html templates/*.txt
var templateFiles embed.FS

// Logo is the app icon, copied from app/public/icons by `npm run campus:sync`.
//
//go:embed assets/logo.png
var Logo []byte

// LogoContentID ties the attached logo to <img src="cid:...">, so it shows without loading remote images.
const LogoContentID = "logo@csimap"

var hexColor = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

// Rendered is one finished email in both formats.
type Rendered struct {
	Subject string
	Text    string
	HTML    string
}

type page struct {
	Subject   string
	Preheader string
	Reason    string
	LogoSrc   htmltemplate.URL
	Brand     campus.Brand
	Data      any
}

// Renderer builds emails from templates/: layout.html wraps every email, components.html holds the
// shared blocks, and each email adds its own content file. A new email is a new content file plus a
// method here, never new layout markup.
type Renderer struct {
	brand campus.Brand
	html  map[string]*htmltemplate.Template
	text  map[string]*texttemplate.Template
}

var emails = []string{"login_code"}

func NewRenderer(brand campus.Brand) (*Renderer, error) {
	for _, color := range []string{brand.Accent, brand.AccentText, brand.AccentDark} {
		if !hexColor.MatchString(color) {
			return nil, fmt.Errorf("email brand color %q must look like #1268D2", color)
		}
	}

	funcs := map[string]any{
		"accent":     func() htmltemplate.CSS { return htmltemplate.CSS(brand.Accent) },
		"accentText": func() htmltemplate.CSS { return htmltemplate.CSS(brand.AccentText) },
		"accentDark": func() htmltemplate.CSS { return htmltemplate.CSS(brand.AccentDark) },
		"groupCode":  groupCode,
		"hostOf":     hostOf,
		"dict":       dict,
	}

	r := &Renderer{brand: brand, html: map[string]*htmltemplate.Template{}, text: map[string]*texttemplate.Template{}}
	htmlBase, err := htmltemplate.New("email").Funcs(funcs).ParseFS(templateFiles, "templates/layout.html", "templates/components.html")
	if err != nil {
		return nil, err
	}
	textBase, err := texttemplate.New("email").Funcs(funcs).ParseFS(templateFiles, "templates/layout.txt")
	if err != nil {
		return nil, err
	}
	for _, name := range emails {
		h, err := htmlBase.Clone()
		if err == nil {
			h, err = h.ParseFS(templateFiles, "templates/"+name+".html")
		}
		if err != nil {
			return nil, fmt.Errorf("email template %s: %w", name, err)
		}
		t, err := textBase.Clone()
		if err == nil {
			t, err = t.ParseFS(templateFiles, "templates/"+name+".txt")
		}
		if err != nil {
			return nil, fmt.Errorf("email template %s: %w", name, err)
		}
		r.html[name], r.text[name] = h, t
	}
	return r, nil
}

func (r *Renderer) render(name string, p page) (Rendered, error) {
	p.Brand = r.brand
	var htmlOut, textOut bytes.Buffer
	if err := r.html[name].ExecuteTemplate(&htmlOut, "layout", p); err != nil {
		return Rendered{}, err
	}
	if err := r.text[name].ExecuteTemplate(&textOut, "layout", p); err != nil {
		return Rendered{}, err
	}
	return Rendered{Subject: p.Subject, HTML: htmlOut.String(), Text: strings.TrimSpace(textOut.String()) + "\n"}, nil
}

// LoginCode keeps the code out of the subject and preview line so it never shows on a locked phone.
// logoSrc is "cid:" plus LogoContentID for attached logos, an https URL, or empty to leave it out.
func (r *Renderer) LoginCode(to, code string, minutes int, logoSrc string) (Rendered, error) {
	src, err := logoSource(logoSrc)
	if err != nil {
		return Rendered{}, err
	}
	return r.render("login_code", page{
		Subject:   fmt.Sprintf("Your %s sign-in code", r.brand.AppName),
		Preheader: fmt.Sprintf("Use it within %d minutes to finish signing in.", minutes),
		Reason:    fmt.Sprintf("You got this email because someone asked to sign in to %s with %s.", r.brand.AppName, to),
		LogoSrc:   src,
		Data: struct {
			Code    string
			Minutes int
		}{code, minutes},
	})
}

// groupCode splits a code into pairs of four, which is easier to read and type: 7387 0601.
func groupCode(code string) string {
	if len(code) != 8 {
		return code
	}
	return code[:4] + " " + code[4:]
}

func hostOf(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	return parsed.Host
}

func dict(pairs ...any) (map[string]any, error) {
	if len(pairs)%2 != 0 {
		return nil, errors.New("dict needs key and value pairs")
	}
	out := make(map[string]any, len(pairs)/2)
	for i := 0; i < len(pairs); i += 2 {
		key, ok := pairs[i].(string)
		if !ok {
			return nil, errors.New("dict keys must be strings")
		}
		out[key] = pairs[i+1]
	}
	return out, nil
}

// LogoURL is the hosted app icon, for senders that cannot attach images. Empty until app.url is set.
func (r *Renderer) LogoURL() string {
	if r.brand.URL == "" {
		return ""
	}
	return r.brand.URL + "/icons/icon-192.png"
}

// logoSource marks the logo address as trusted for the template. Only an attachment reference or an
// https URL is accepted, since html/template would otherwise drop cid: links as unsafe.
func logoSource(src string) (htmltemplate.URL, error) {
	if src == "" || src == "cid:"+LogoContentID || strings.HasPrefix(src, "https://") {
		return htmltemplate.URL(src), nil
	}
	return "", fmt.Errorf("email logo source %q must be cid:%s or an https URL", src, LogoContentID)
}
