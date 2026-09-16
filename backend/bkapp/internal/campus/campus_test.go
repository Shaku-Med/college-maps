package campus

import (
	"testing"
)

func TestEmbeddedCampusLoads(t *testing.T) {
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Places) == 0 || len(c.EmailDomains) == 0 || c.AppName == "" {
		t.Fatalf("incomplete campus: %+v", c)
	}
}

func TestRejectsBadCampus(t *testing.T) {
	const head = `"app":{"name":"Map"},"college":{"name":"Example College","emailDomains":["stu.example.edu"]},"map":{"walkingArea":{"south":1,"west":1,"north":2,"east":2}}`
	place := `{"id":"A","name":"A","category":"academic","latitude":1.5,"longitude":1.5}`
	cases := map[string]string{
		"missing area":   `{"app":{"name":"Map"},"college":{"name":"Example College","emailDomains":["stu.example.edu"]},"places":[` + place + `]}`,
		"missing domain": `{"app":{"name":"Map"},"map":{"walkingArea":{"south":1,"west":1,"north":2,"east":2}},"places":[` + place + `]}`,
		"bad domain":     `{"app":{"name":"Map"},"college":{"name":"Example College","emailDomains":["not a domain"]},"map":{"walkingArea":{"south":1,"west":1,"north":2,"east":2}},"places":[` + place + `]}`,
		"missing name":   `{"college":{"name":"Example College","emailDomains":["stu.example.edu"]},"map":{"walkingArea":{"south":1,"west":1,"north":2,"east":2}},"places":[` + place + `]}`,
		"outside area":   `{` + head + `,"places":[{"id":"A","name":"A","category":"academic","latitude":5,"longitude":5}]}`,
		"bad category":   `{` + head + `,"places":[{"id":"A","name":"A","category":"moon","latitude":1.5,"longitude":1.5}]}`,
		"duplicate id":   `{` + head + `,"places":[` + place + `,{"id":"a","name":"B","category":"academic","latitude":1.5,"longitude":1.5}]}`,
		"invalid id":     `{` + head + `,"places":[{"id":"<b>","name":"A","category":"academic","latitude":1.5,"longitude":1.5}]}`,
		"no places":      `{` + head + `,"places":[]}`,
		"bad accent":     `{` + head + `,"theme":{"accent":"red"},"places":[` + place + `]}`,
		"http url":       `{"app":{"name":"Map","url":"http://map.example.edu"},"college":{"name":"Example College","emailDomains":["stu.example.edu"]},"map":{"walkingArea":{"south":1,"west":1,"north":2,"east":2}},"places":[` + place + `]}`,
	}
	for name, data := range cases {
		if _, err := parse([]byte(data)); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
	if _, err := parse([]byte(`{` + head + `,"places":[` + place + `]}`)); err != nil {
		t.Errorf("valid campus rejected: %v", err)
	}
}

func TestBrandComesFromCampus(t *testing.T) {
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	b := c.Brand
	if b.AppName != c.AppName || b.CollegeName == "" || !hexColor.MatchString(b.Accent) || !hexColor.MatchString(b.AccentText) || !hexColor.MatchString(b.AccentDark) {
		t.Fatalf("incomplete brand: %+v", b)
	}
}
