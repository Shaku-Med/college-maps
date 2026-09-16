package campus

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

// Copied from app/campus/campus.json by `npm run campus:sync` in the app folder.
//
//go:embed campus.json
var rawCampus []byte

type Place struct {
	ID         string   `json:"id"`
	Label      string   `json:"label,omitempty"`
	Name       string   `json:"name"`
	Category   string   `json:"category"`
	Latitude   float64  `json:"latitude"`
	Longitude  float64  `json:"longitude"`
	Details    string   `json:"details,omitempty"`
	Keywords   []string `json:"keywords,omitempty"`
	IsBuilding bool     `json:"isBuilding"`
}

type Campus struct {
	AppName      string
	Places       []Place
	EmailDomains []string
	Brand        Brand
	WalkingArea  Area
}

// Area is a south, west, north, east box of coordinates.
type Area struct {
	South, West, North, East float64
}

func (a Area) Contains(lat, lng float64) bool {
	return lat >= a.South && lat <= a.North && lng >= a.West && lng <= a.East
}

// Brand is what emails and other server-rendered pages need to look like the app.
type Brand struct {
	AppName     string
	CollegeName string
	Disclaimer  string
	URL         string
	Accent      string
	AccentText  string
	AccentDark  string
}

type bounds struct {
	South *float64 `json:"south"`
	West  *float64 `json:"west"`
	North *float64 `json:"north"`
	East  *float64 `json:"east"`
}

type campusFile struct {
	App struct {
		Name       string `json:"name"`
		Disclaimer string `json:"disclaimer"`
		URL        string `json:"url"`
	} `json:"app"`
	College struct {
		Name         string   `json:"name"`
		EmailDomains []string `json:"emailDomains"`
	} `json:"college"`
	Theme struct {
		Accent           string `json:"accent"`
		AccentForeground string `json:"accentForeground"`
		Dark             struct {
			Accent string `json:"accent"`
		} `json:"dark"`
	} `json:"theme"`
	Map struct {
		WalkingArea bounds `json:"walkingArea"`
	} `json:"map"`
	Places []Place `json:"places"`
}

var (
	hexColor      = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
	idPattern     = regexp.MustCompile(`^[A-Z0-9][A-Z0-9-]{0,15}$`)
	domainPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)
	categories    = map[string]bool{
		"academic": true, "student": true, "admin": true, "housing": true, "dining": true,
		"athletics": true, "health": true, "services": true, "parking": true, "transit": true,
	}
)

func Load() (*Campus, error) {
	return parse(rawCampus)
}

func parse(data []byte) (*Campus, error) {
	var file campusFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("parse campus.json: %w", err)
	}

	name := strings.TrimSpace(file.App.Name)
	if name == "" || len(name) > 40 {
		return nil, fmt.Errorf("campus.json app.name must be 1 to 40 characters")
	}

	domains := file.College.EmailDomains
	if len(domains) == 0 || len(domains) > 10 {
		return nil, fmt.Errorf("campus.json college.emailDomains must list 1 to 10 domains")
	}
	for _, domain := range domains {
		if !domainPattern.MatchString(domain) {
			return nil, fmt.Errorf("campus.json college.emailDomains has an invalid domain %q", domain)
		}
	}

	area := file.Map.WalkingArea
	if area.South == nil || area.West == nil || area.North == nil || area.East == nil ||
		*area.South >= *area.North || *area.West >= *area.East {
		return nil, fmt.Errorf("campus.json map.walkingArea is missing or inverted")
	}
	if len(file.Places) == 0 || len(file.Places) > 500 {
		return nil, fmt.Errorf("campus.json must list 1 to 500 places")
	}

	seen := make(map[string]bool, len(file.Places))
	for i := range file.Places {
		p := &file.Places[i]
		p.ID = strings.ToUpper(p.ID)
		if err := validate(*p, area); err != nil {
			return nil, fmt.Errorf("place %q: %w", p.ID, err)
		}
		if seen[p.ID] {
			return nil, fmt.Errorf("place %q is duplicated", p.ID)
		}
		seen[p.ID] = true
	}
	brand, err := parseBrand(name, file)
	if err != nil {
		return nil, err
	}
	walking := Area{South: *area.South, West: *area.West, North: *area.North, East: *area.East}
	return &Campus{AppName: name, Places: file.Places, EmailDomains: domains, Brand: brand, WalkingArea: walking}, nil
}

func parseBrand(appName string, file campusFile) (Brand, error) {
	brand := Brand{
		AppName:     appName,
		CollegeName: strings.TrimSpace(file.College.Name),
		Disclaimer:  strings.TrimSpace(file.App.Disclaimer),
		URL:         strings.TrimRight(strings.TrimSpace(file.App.URL), "/"),
		Accent:      "#1F2937",
		AccentText:  "#FFFFFF",
	}
	if brand.CollegeName == "" || len(brand.CollegeName) > 100 {
		return Brand{}, fmt.Errorf("campus.json college.name must be 1 to 100 characters")
	}
	if len(brand.Disclaimer) > 300 {
		return Brand{}, fmt.Errorf("campus.json app.disclaimer must be at most 300 characters")
	}
	if brand.URL != "" {
		parsed, err := url.Parse(brand.URL)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
			return Brand{}, fmt.Errorf("campus.json app.url must be an https address")
		}
	}
	for field, value := range map[string]*string{
		"theme.accent":           &file.Theme.Accent,
		"theme.accentForeground": &file.Theme.AccentForeground,
		"theme.dark.accent":      &file.Theme.Dark.Accent,
	} {
		if *value != "" && !hexColor.MatchString(*value) {
			return Brand{}, fmt.Errorf("campus.json %s must be a color like #1268D2", field)
		}
	}
	if file.Theme.Accent != "" {
		brand.Accent = strings.ToUpper(file.Theme.Accent)
	}
	if file.Theme.AccentForeground != "" {
		brand.AccentText = strings.ToUpper(file.Theme.AccentForeground)
	}
	brand.AccentDark = brand.Accent
	if file.Theme.Dark.Accent != "" {
		brand.AccentDark = strings.ToUpper(file.Theme.Dark.Accent)
	}
	return brand, nil
}

func validate(p Place, area bounds) error {
	switch {
	case !idPattern.MatchString(p.ID):
		return fmt.Errorf("invalid id")
	case len(p.Label) > 10:
		return fmt.Errorf("label must be at most 10 characters")
	case p.Name == "" || len(p.Name) > 80:
		return fmt.Errorf("name must be 1 to 80 characters")
	case !categories[p.Category]:
		return fmt.Errorf("unknown category %q", p.Category)
	case p.Latitude < *area.South || p.Latitude > *area.North || p.Longitude < *area.West || p.Longitude > *area.East:
		return fmt.Errorf("coordinates are outside map.walkingArea")
	case len(p.Details) > 200:
		return fmt.Errorf("details must be at most 200 characters")
	case len(p.Keywords) > 20:
		return fmt.Errorf("too many keywords")
	}
	return nil
}
