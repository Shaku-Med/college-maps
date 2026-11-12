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
	"time"

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

// Renderer builds emails from templates/: one layout, shared components, and a content file per email.
type Renderer struct {
	brand campus.Brand
	html  map[string]*htmltemplate.Template
	text  map[string]*texttemplate.Template
}

var emails = []string{"login_code", "signin_alert", "report_alert"}

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

// SignIn is what the owner sees about a new sign in. Location is empty when it is not known.
type SignIn struct {
	When     time.Time
	Device   string
	Location string
	IP       string
}

type detailRow struct {
	Label string
	Value string
}

// SignInAlert tells the owner their account was signed in to, the way big providers do, so a stolen code shows.
func (r *Renderer) SignInAlert(to string, in SignIn, logoSrc string) (Rendered, error) {
	src, err := logoSource(logoSrc)
	if err != nil {
		return Rendered{}, err
	}
	when := in.When
	if r.brand.Location != nil {
		when = when.In(r.brand.Location)
	}
	rows := []detailRow{{"When", when.Format("Mon, Jan 2, 2006 at 3:04 PM MST")}}
	if in.Device != "" {
		rows = append(rows, detailRow{"Device", in.Device})
	}
	if in.Location != "" {
		rows = append(rows, detailRow{"Near", in.Location})
	}
	if in.IP != "" {
		rows = append(rows, detailRow{"IP address", in.IP})
	}
	account := ""
	if r.brand.URL != "" {
		account = r.brand.URL + "/?account=1"
	}
	return r.render("signin_alert", page{
		Subject:   fmt.Sprintf("New sign-in to %s", r.brand.AppName),
		Preheader: "If this was you, there's nothing to do.",
		Reason:    fmt.Sprintf("You got this email because %s, your %s account, was just signed in to.", to, r.brand.AppName),
		LogoSrc:   src,
		Data: struct {
			Rows       []detailRow
			AccountURL string
		}{rows, account},
	})
}

// ContentReport is a student's report about a person or an event, sent to the support inbox to act on.
type ContentReport struct {
	When     time.Time
	Reporter string
	About    string
	Reason   string
	Details  string
}

// ReportAlert tells the support inbox about a new report, since the stores expect one to be looked at within a day.
func (r *Renderer) ReportAlert(to string, in ContentReport, logoSrc string) (Rendered, error) {
	src, err := logoSource(logoSrc)
	if err != nil {
		return Rendered{}, err
	}
	when := in.When
	if r.brand.Location != nil {
		when = when.In(r.brand.Location)
	}
	rows := []detailRow{
		{"When", when.Format("Mon, Jan 2, 2006 at 3:04 PM MST")},
		{"From", in.Reporter},
		{"About", in.About},
		{"Reason", in.Reason},
	}
	if in.Details != "" {
		rows = append(rows, detailRow{"Details", in.Details})
	}
	return r.render("report_alert", page{
		Subject:   fmt.Sprintf("New %s report about %s", in.Reason, in.About),
		Preheader: "Look at it within 24 hours.",
		Reason:    fmt.Sprintf("You got this email because %s is the support address for %s.", to, r.brand.AppName),
		LogoSrc:   src,
		Data:      struct{ Rows []detailRow }{rows},
	})
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

// logoSource marks the logo address as trusted for the template.
func logoSource(src string) (htmltemplate.URL, error) {
	if src == "" || src == "cid:"+LogoContentID || strings.HasPrefix(src, "https://") {
		return htmltemplate.URL(src), nil
	}
	return "", fmt.Errorf("email logo source %q must be cid:%s or an https URL", src, LogoContentID)
}
