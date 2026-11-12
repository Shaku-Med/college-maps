package email

import (
	"strings"
	"testing"
	"time"

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

	for _, want := range []string{"73870601", "cid:" + LogoContentID, r.brand.CollegeName, "Sign in to CSI Map", "expires in 10 minutes"} {
		if !strings.Contains(msg.HTML, want) {
			t.Errorf("html is missing %q", want)
		}
	}
	for _, want := range []string{"73870601", r.brand.AppName, "expires in 10 minutes"} {
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

func TestSignInAlert(t *testing.T) {
	r := testRenderer(t)
	when := time.Date(2026, 11, 12, 1, 15, 0, 0, time.UTC)
	msg, err := r.SignInAlert("jane.doe12@stu-mail.csi.cuny.edu", SignIn{
		When: when, Device: "Chrome on <Windows>", Location: "Staten Island, New York, US", IP: "203.0.113.9",
	}, "cid:"+LogoContentID)
	if err != nil {
		t.Fatal(err)
	}
	// 01:15 UTC is 8:15 PM the evening before on campus.
	for _, want := range []string{"Wed, Nov 11, 2026 at 8:15 PM EST", "Staten Island, New York, US", "203.0.113.9", "Sign out everywhere", "/?account=1"} {
		if !strings.Contains(msg.HTML, want) || !strings.Contains(msg.Text, want) {
			t.Errorf("alert is missing %q", want)
		}
	}
	if strings.Contains(msg.HTML, "<Windows>") || !strings.Contains(msg.HTML, "Chrome on &lt;Windows&gt;") {
		t.Error("the device name must be escaped in the HTML")
	}
	if msg.Subject != "New sign-in to CSI Map" {
		t.Errorf("subject = %q", msg.Subject)
	}
}

func TestSignInAlertLeavesOutUnknowns(t *testing.T) {
	r := testRenderer(t)
	msg, err := r.SignInAlert("jane.doe12@stu-mail.csi.cuny.edu", SignIn{When: time.Now(), IP: "203.0.113.9"}, "cid:"+LogoContentID)
	if err != nil {
		t.Fatal(err)
	}
	for _, missing := range []string{"Device", "Near"} {
		if strings.Contains(msg.Text, missing+":") {
			t.Errorf("an unknown %s should be left out", missing)
		}
	}
}
