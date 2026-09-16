package email

import (
	"strings"
	"testing"

	"csimap/bkapp/internal/campus"
)

func testRenderer(t *testing.T) *Renderer {
	t.Helper()
	site, err := campus.Load()
	if err != nil {
		t.Fatal(err)
	}
	r, err := NewRenderer(site.Brand)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestLoginCodeEmail(t *testing.T) {
	r := testRenderer(t)
	msg, err := r.LoginCode("jane.doe12@stu-mail.csi.cuny.edu", "73870601", 10, "cid:"+LogoContentID)
	if err != nil {
		t.Fatal(err)
	}

	for _, want := range []string{"7387 0601", "cid:" + LogoContentID, r.brand.CollegeName, "Sign in to CSI Map", "expires in 10 minutes"} {
		if !strings.Contains(msg.HTML, want) {
			t.Errorf("html is missing %q", want)
		}
	}
	for _, want := range []string{"7387 0601", r.brand.AppName, "expires in 10 minutes"} {
		if !strings.Contains(msg.Text, want) {
			t.Errorf("text is missing %q", want)
		}
	}
	if strings.Contains(msg.HTML, "ZgotmplZ") {
		t.Fatal("a template value was blocked by html/template, so a style or link is broken")
	}
	if strings.Contains(msg.Subject, "7387") {
		t.Fatal("the code must stay out of the subject")
	}
	preheaderEnd := strings.Index(msg.HTML, "<table")
	if preheaderEnd < 0 || strings.Contains(msg.HTML[:preheaderEnd], "7387") {
		t.Fatal("the code must stay out of the inbox preview line")
	}
}

func TestBrandTextIsEscaped(t *testing.T) {
	site, err := campus.Load()
	if err != nil {
		t.Fatal(err)
	}
	brand := site.Brand
	brand.AppName = `Map <script>alert(1)</script>`
	brand.Disclaimer = `"><img src=x onerror=alert(1)>`
	r, err := NewRenderer(brand)
	if err != nil {
		t.Fatal(err)
	}
	msg, err := r.LoginCode("a+b@stu-mail.csi.cuny.edu", "12345678", 10, "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(msg.HTML, "<script>") || strings.Contains(msg.HTML, "<img src=x") {
		t.Fatal("brand text must be escaped in html")
	}
	if strings.Contains(msg.HTML, "<img") {
		t.Fatal("no logo tag should render without a logo source")
	}
}

func TestRejectsUnsafeBrandColors(t *testing.T) {
	brand := campus.Brand{AppName: "Map", CollegeName: "College", Accent: "red; background:url(x)", AccentText: "#FFFFFF", AccentDark: "#FFFFFF"}
	if _, err := NewRenderer(brand); err == nil {
		t.Fatal("colors must be plain hex values")
	}
}
