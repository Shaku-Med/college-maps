import rawConfig from "@campus/campus.json";

export type Coordinate = { latitude: number; longitude: number };

export type Bounds = { south: number; west: number; north: number; east: number };

export const PLACE_CATEGORIES = [
  "academic",
  "student",
  "admin",
  "housing",
  "dining",
  "athletics",
  "health",
  "services",
  "parking",
  "transit",
] as const;

export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

export type Place = {
  id: string;
  label?: string;
  name: string;
  category: PlaceCategory;
  coordinate: Coordinate;
  details?: string;
  keywords?: string[];
  isBuilding: boolean;
};

export type ThemeColors = { accent?: string; accentForeground?: string };

export type FloorRule = "leadingDigits" | "firstDigit" | "none";

export type CampusConfig = {
  app: { name: string; shortName: string; description: string; disclaimer?: string; url?: string };
  college: { name: string; shortName: string; emailDomains: string[] };
  theme: ThemeColors & { dark?: ThemeColors };
  map: {
    center: Coordinate;
    zoom: number;
    bounds: Bounds;
    walkingArea: Bounds;
    onCampusRadiusMeters: number;
    styles: { light: string; dark: string };
    extraOrigins: string[];
  };
  rooms: { pattern: RegExp; scanPattern: RegExp; floor: FloorRule; example: string; help?: string };
  schedule: { portalName?: string };
  places: readonly Place[];
};

export const CATEGORY_LABELS: Record<PlaceCategory, string> = {
  academic: "Academic",
  student: "Student life",
  admin: "Administration",
  housing: "Housing",
  dining: "Dining",
  athletics: "Athletics",
  health: "Health",
  services: "Campus services",
  parking: "Parking",
  transit: "Transit",
};

const PLACE_ID = /^[A-Z0-9][A-Z0-9-]{0,15}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

class ConfigErrors {
  readonly messages: string[] = [];

  add(path: string, problem: string) {
    this.messages.push(`campus.json ${path}: ${problem}`);
  }
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function text(errors: ConfigErrors, source: Json, key: string, path: string, max: number, optional = false) {
  const value = source[key];
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    errors.add(`${path}.${key}`, `must be text up to ${max} characters`);
    return "";
  }
  return value.trim();
}

function number(errors: ConfigErrors, source: Json, key: string, path: string, min: number, max: number) {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    errors.add(`${path}.${key}`, `must be a number between ${min} and ${max}`);
    return min;
  }
  return value;
}

function coordinate(errors: ConfigErrors, source: unknown, path: string): Coordinate {
  const value = isObject(source) ? source : {};
  if (!isObject(source)) errors.add(path, "must be an object with latitude and longitude");
  return {
    latitude: number(errors, value, "latitude", path, -90, 90),
    longitude: number(errors, value, "longitude", path, -180, 180),
  };
}

function bounds(errors: ConfigErrors, source: unknown, path: string): Bounds {
  const value = isObject(source) ? source : {};
  if (!isObject(source)) errors.add(path, "must be an object with south, west, north, east");
  const box = {
    south: number(errors, value, "south", path, -90, 90),
    west: number(errors, value, "west", path, -180, 180),
    north: number(errors, value, "north", path, -90, 90),
    east: number(errors, value, "east", path, -180, 180),
  };
  if (box.south >= box.north || box.west >= box.east)
    errors.add(path, "south must be below north and west left of east");
  return box;
}

export function contains(box: Bounds, point: Coordinate) {
  return (
    point.latitude >= box.south &&
    point.latitude <= box.north &&
    point.longitude >= box.west &&
    point.longitude <= box.east
  );
}

const EMAIL_DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function emailDomains(errors: ConfigErrors, value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 10 ||
    !value.every((d) => typeof d === "string" && EMAIL_DOMAIN.test(d))
  ) {
    errors.add("college.emailDomains", "must list 1 to 10 lowercase email domains like stu-mail.csi.cuny.edu");
    return [];
  }
  return [...new Set(value as string[])];
}

function siteOrigin(errors: ConfigErrors, value: unknown) {
  try {
    const url = new URL(String(value));
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) throw new Error();
    return url.origin;
  } catch {
    errors.add("app.url", "must be your site address like https://csimap.example.com");
    return undefined;
  }
}

function httpsUrl(errors: ConfigErrors, value: unknown, path: string) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    errors.add(path, "must be an https URL");
    return "https://invalid.example";
  }
}

function roomPatterns(errors: ConfigErrors, source: unknown) {
  try {
    if (typeof source !== "string" || source.length > 300) throw new Error("must be text up to 300 characters");
    if (source.startsWith("^") || source.endsWith("$"))
      throw new Error("must not include ^ or $, they are added for you");
    const pattern = new RegExp(`^(?:${source})$`, "i");
    if (!source.includes("(?<building>") || !source.includes("(?<room>")) {
      throw new Error("needs named groups (?<building>...) and (?<room>...)");
    }
    return { pattern, scanPattern: new RegExp(`(?<![A-Za-z0-9])(?:${source})(?![A-Za-z0-9])`, "i") };
  } catch (error) {
    errors.add("rooms.pattern", error instanceof Error && error.message ? error.message : "is not a valid pattern");
    return { pattern: /$^/, scanPattern: /$^/ };
  }
}

function places(errors: ConfigErrors, source: unknown, area: Bounds): Place[] {
  if (!Array.isArray(source) || source.length === 0 || source.length > 500) {
    errors.add("places", "must be a list of 1 to 500 places");
    return [];
  }

  const seen = new Set<string>();
  return source.flatMap((item, index) => {
    const path = `places[${index}]`;
    if (!isObject(item)) {
      errors.add(path, "must be an object");
      return [];
    }

    const id = typeof item.id === "string" ? item.id.toUpperCase() : "";
    if (!PLACE_ID.test(id)) errors.add(`${path}.id`, "must be 1 to 16 letters, numbers, or dashes");
    if (seen.has(id)) errors.add(`${path}.id`, `"${id}" is used twice`);
    seen.add(id);

    const category = item.category as PlaceCategory;
    if (!PLACE_CATEGORIES.includes(category))
      errors.add(`${path}.category`, `must be one of ${PLACE_CATEGORIES.join(", ")}`);

    const point = coordinate(errors, item, path);
    if (!contains(area, point)) errors.add(path, "is outside map.walkingArea");

    const keywords = item.keywords;
    if (
      keywords !== undefined &&
      (!Array.isArray(keywords) || keywords.length > 20 || keywords.some((k) => typeof k !== "string" || k.length > 40))
    ) {
      errors.add(`${path}.keywords`, "must be up to 20 words, each up to 40 characters");
    }
    if (typeof item.isBuilding !== "boolean") errors.add(`${path}.isBuilding`, "must be true or false");

    return [
      {
        id,
        label: text(errors, item, "label", path, 10, true),
        name: text(errors, item, "name", path, 80) ?? "",
        category,
        coordinate: point,
        details: text(errors, item, "details", path, 200, true),
        keywords: Array.isArray(keywords) ? keywords.map((k) => String(k).toLowerCase()) : undefined,
        isBuilding: item.isBuilding === true,
      },
    ];
  });
}

function relativeLuminance(hex: string) {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string) {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// Button labels sit on the accent color, so the pair must meet WCAG AA for normal text.
const MIN_TEXT_CONTRAST = 4.5;

function readThemeColors(errors: ConfigErrors, source: Json, path: string): ThemeColors {
  const colors: ThemeColors = {};
  for (const key of ["accent", "accentForeground"] as const) {
    const value = source[key];
    if (value === undefined) continue;
    if (typeof value === "string" && HEX_COLOR.test(value)) colors[key] = value;
    else errors.add(`${path}.${key}`, "must be a hex color like #1d4ed8");
  }
  if (Boolean(colors.accent) !== Boolean(colors.accentForeground)) {
    errors.add(path, "set accent and accentForeground together so button text stays readable");
  } else if (colors.accent && colors.accentForeground) {
    const ratio = contrastRatio(colors.accent, colors.accentForeground);
    if (ratio < MIN_TEXT_CONTRAST) {
      errors.add(
        path,
        `accentForeground on accent has contrast ${ratio.toFixed(2)}:1, needs at least ${MIN_TEXT_CONTRAST}:1`,
      );
    }
  }
  return colors;
}

export function loadCampus(raw: unknown): CampusConfig {
  const errors = new ConfigErrors();
  const root = isObject(raw) ? raw : {};
  const section = (key: string) => {
    if (!isObject(root[key])) errors.add(key, "is missing");
    return isObject(root[key]) ? (root[key] as Json) : {};
  };

  const app = section("app");
  const college = section("college");
  const theme = isObject(root.theme) ? root.theme : {};
  const map = section("map");
  const rooms = section("rooms");
  const schedule = isObject(root.schedule) ? root.schedule : {};
  const styles = isObject(map.styles) ? map.styles : {};

  const themeColors = readThemeColors(errors, theme, "theme");
  const darkColors = isObject(theme.dark) ? readThemeColors(errors, theme.dark, "theme.dark") : undefined;
  if (theme.dark !== undefined && !isObject(theme.dark)) errors.add("theme.dark", "must be an object");

  const floor = rooms.floor as FloorRule;
  if (!["leadingDigits", "firstDigit", "none"].includes(floor)) {
    errors.add("rooms.floor", "must be leadingDigits, firstDigit, or none");
  }

  const walkingArea = bounds(errors, map.walkingArea, "map.walkingArea");
  const mapBounds = bounds(errors, map.bounds, "map.bounds");
  const center = coordinate(errors, map.center, "map.center");
  if (!contains(mapBounds, center)) errors.add("map.center", "must be inside map.bounds");

  const config: CampusConfig = {
    app: {
      name: text(errors, app, "name", "app", 40) ?? "",
      shortName: text(errors, app, "shortName", "app", 20) ?? "",
      description: text(errors, app, "description", "app", 160) ?? "",
      disclaimer: text(errors, app, "disclaimer", "app", 200, true),
      url: app.url === undefined ? undefined : siteOrigin(errors, app.url),
    },
    college: {
      name: text(errors, college, "name", "college", 100) ?? "",
      shortName: text(errors, college, "shortName", "college", 20) ?? "",
      emailDomains: emailDomains(errors, college.emailDomains),
    },
    theme: { ...themeColors, dark: darkColors },
    map: {
      center,
      zoom: number(errors, map, "zoom", "map", 10, 19),
      bounds: mapBounds,
      walkingArea,
      onCampusRadiusMeters: number(errors, map, "onCampusRadiusMeters", "map", 100, 50_000),
      styles: {
        light: httpsUrl(errors, styles.light, "map.styles.light"),
        dark: httpsUrl(errors, styles.dark, "map.styles.dark"),
      },
      extraOrigins: (Array.isArray(map.extraOrigins) ? map.extraOrigins : []).map(
        (origin, i) => new URL(httpsUrl(errors, origin, `map.extraOrigins[${i}]`)).origin,
      ),
    },
    rooms: {
      ...roomPatterns(errors, rooms.pattern),
      floor,
      example: text(errors, rooms, "example", "rooms", 20) ?? "",
      help: text(errors, rooms, "help", "rooms", 200, true),
    },
    schedule: { portalName: text(errors, schedule, "portalName", "schedule", 40, true) },
    places: places(errors, root.places, walkingArea),
  };

  if (config.rooms.example && !config.rooms.pattern.test(config.rooms.example)) {
    errors.add("rooms.example", "does not match rooms.pattern");
  }

  // Fail the build loudly instead of shipping a half-configured campus.
  if (errors.messages.length > 0) {
    throw new Error(`Campus config is invalid:\n- ${errors.messages.join("\n- ")}`);
  }
  return config;
}

export const CAMPUS = loadCampus(rawConfig);
export const PLACES = CAMPUS.places;
export const CAMPUS_CENTER = CAMPUS.map.center;

export const MAP_ORIGINS = [
  ...new Set([
    new URL(CAMPUS.map.styles.light).origin,
    new URL(CAMPUS.map.styles.dark).origin,
    ...CAMPUS.map.extraOrigins,
  ]),
];

const PLACE_BY_ID = new Map(PLACES.map((place) => [place.id, place]));

export function getPlace(id: unknown): Place | undefined {
  if (typeof id !== "string" || id.length > 16) return undefined;
  return PLACE_BY_ID.get(id.toUpperCase());
}
