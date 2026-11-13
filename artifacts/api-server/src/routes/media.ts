import { Router, type IRouter } from "express";

// Photos + flight routes for the entity intel panel.
//   aircraft  → Planespotters (by ICAO hex, then registration) → adsbdb photo fallback;
//               route from adsbdb's callsign database (scheduled route, not live filed plan)
//   ship      → Wikipedia article whose title matches the vessel name, else a representative class image
//   satellite → Wikipedia article matching the satellite name, else its programme / constellation

const router: IRouter = Router();

// Planespotters rejects server requests without a contact URL in the User-Agent.
const USER_AGENT = "WorldviewIntel/1.0 (+https://github.com/daggerm29-oss/PLANCC)";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 3000;

export interface MediaPhoto {
  src: string;
  link: string;
  credit: string;
  /** false when the image shows the class/programme rather than this exact object */
  exact: boolean;
  caption?: string;
}

export interface Airport {
  iata: string | null;
  icao: string | null;
  name: string;
  city: string | null;
  country: string | null;
  lat: number;
  lon: number;
}

export interface FlightRoute {
  airline: string | null;
  origin: Airport;
  destination: Airport;
}

export interface EntityMediaResponse {
  photo: MediaPhoto | null;
  route: FlightRoute | null;
}

const cache = new Map<string, { at: number; value: EntityMediaResponse }>();

function cacheGet(key: string): EntityMediaResponse | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key: string, value: EntityMediaResponse) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── Aircraft ────────────────────────────────────────────────────────────────

interface PlanespottersResponse {
  photos?: Array<{
    thumbnail_large?: { src: string };
    thumbnail?: { src: string };
    link: string;
    photographer: string;
  }>;
}

async function planespotters(path: string): Promise<MediaPhoto | null> {
  const data = await getJson<PlanespottersResponse>(`https://api.planespotters.net/pub/photos/${path}`);
  const p = data?.photos?.[0];
  const src = p?.thumbnail_large?.src ?? p?.thumbnail?.src;
  if (!p || !src) return null;
  return { src, link: p.link, credit: `© ${p.photographer} / Planespotters.net`, exact: true };
}

interface AdsbdbAirport {
  iata_code?: string;
  icao_code?: string;
  name: string;
  municipality?: string;
  country_name?: string;
  latitude: number;
  longitude: number;
}

interface AdsbdbCallsignResponse {
  response?: { flightroute?: { airline?: { name?: string }; origin: AdsbdbAirport; destination: AdsbdbAirport } } | string;
}

interface AdsbdbAircraftResponse {
  response?: { aircraft?: { url_photo?: string | null; url_photo_thumbnail?: string | null; registration?: string } } | string;
}

function toAirport(a: AdsbdbAirport): Airport {
  return {
    iata: a.iata_code || null,
    icao: a.icao_code || null,
    name: a.name,
    city: a.municipality || null,
    country: a.country_name || null,
    lat: a.latitude,
    lon: a.longitude,
  };
}

async function aircraftRoute(callsign: string): Promise<FlightRoute | null> {
  // Airline-style callsigns only (e.g. ARG1132); private/military callsigns have no published route.
  if (!/^[A-Z]{2,3}\d{1,4}[A-Z]{0,2}$/.test(callsign)) return null;
  const data = await getJson<AdsbdbCallsignResponse>(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`);
  const fr = typeof data?.response === "object" ? data.response.flightroute : undefined;
  if (!fr?.origin || !fr?.destination) return null;
  return { airline: fr.airline?.name ?? null, origin: toAirport(fr.origin), destination: toAirport(fr.destination) };
}

async function aircraftPhoto(hex: string, reg: string): Promise<MediaPhoto | null> {
  if (hex) {
    const byHex = await planespotters(`hex/${encodeURIComponent(hex)}`);
    if (byHex) return byHex;
  }
  if (reg) {
    const byReg = await planespotters(`reg/${encodeURIComponent(reg)}`);
    if (byReg) return byReg;
  }
  if (!hex) return null;
  const data = await getJson<AdsbdbAircraftResponse>(`https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(hex)}`);
  const ac = typeof data?.response === "object" ? data.response.aircraft : undefined;
  const src = ac?.url_photo || ac?.url_photo_thumbnail;
  if (!src) return null;
  return { src, link: src, credit: "airport-data.com", exact: true };
}

// ── Wikipedia (ships, satellites) ───────────────────────────────────────────

interface WikiPage {
  title: string;
  index?: number;
  description?: string;
  fullurl?: string;
  thumbnail?: { source: string };
}

interface WikiQueryResponse {
  query?: { pages?: Record<string, WikiPage> };
}

const WIKI_PROPS = "action=query&format=json&prop=pageimages|description|info&piprop=thumbnail&pithumbsize=640&inprop=url&redirects=1";

// SVG lead images are logos, flags and diagrams — not a picture of the object.
const hasPhoto = (p: WikiPage | undefined): p is WikiPage =>
  !!p?.thumbnail && !/\.svg/i.test(p.thumbnail.source);

async function wikiSearch(search: string, limit = 6): Promise<WikiPage[]> {
  const url = `https://en.wikipedia.org/w/api.php?${WIKI_PROPS}&generator=search&gsrlimit=${limit}&gsrsearch=${encodeURIComponent(search)}`;
  const data = await getJson<WikiQueryResponse>(url);
  return Object.values(data?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

async function wikiTitle(title: string): Promise<WikiPage | null> {
  const url = `https://en.wikipedia.org/w/api.php?${WIKI_PROPS}&titles=${encodeURIComponent(title)}`;
  const data = await getJson<WikiQueryResponse>(url);
  const page = Object.values(data?.query?.pages ?? {})[0];
  return hasPhoto(page) ? page : null;
}

function wikiPhoto(page: WikiPage, exact: boolean): MediaPhoto | null {
  if (!page.thumbnail) return null;
  return {
    src: page.thumbnail.source,
    link: page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
    credit: "Wikipedia / Wikimedia Commons",
    exact,
    caption: page.title,
  };
}

const normalize = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]/g, "");

/** Finds an article that is about this exact named object, guarded by a description check. */
async function exactWikiMatch(name: string, hint: string, describes: RegExp, stripPrefix?: RegExp): Promise<WikiPage | null> {
  const target = normalize(name);
  if (target.length < 3) return null;
  const pages = await wikiSearch(`${name} ${hint}`);
  return (
    pages.find((p) => {
      const title = stripPrefix ? p.title.replace(stripPrefix, "") : p.title;
      return hasPhoto(p) && normalize(title) === target && describes.test(p.description ?? "");
    }) ?? null
  );
}

const SHIP_PREFIX = /^(MV|MS|MT|SS|RV|FV|HMS|USS|USNS|HMAS|HMCS|INS|JS|RFS|CMA CGM|M\/V|M\/T)\s+/i;
const SHIP_DESCRIPTION = /ship|vessel|tanker|carrier|frigate|destroyer|corvette|ferry|freighter|liner|submarine|cruiser|tug|icebreaker|yacht|boat/i;
const SHIP_CLASS_ARTICLE: Record<string, string> = {
  TANKER: "Oil tanker",
  MILITARY: "Arleigh Burke-class destroyer",
};

async function shipPhoto(name: string, category: string): Promise<MediaPhoto | null> {
  const cleaned = name.replace(SHIP_PREFIX, "").trim();
  if (cleaned && !/^MMSI\b/i.test(cleaned)) {
    const exact = await exactWikiMatch(cleaned, "ship", SHIP_DESCRIPTION, SHIP_PREFIX);
    if (exact) return wikiPhoto(exact, true);
  }
  const representative = await wikiTitle(SHIP_CLASS_ARTICLE[category] ?? "Container ship");
  return representative ? wikiPhoto(representative, false) : null;
}

const SAT_DESCRIPTION = /satellite|spacecraft|space station|telescope|observatory|probe|cubesat|constellation/i;
// Representative image when the individual satellite has no article: a Wikipedia article whose lead
// image is a photo of that spacecraft type, or a Commons file ("File:…") where no such article exists.
// Each entry was checked to resolve to an actual spacecraft photo rather than a logo or diagram.
const SAT_FAMILIES: Array<[RegExp, string]> = [
  [/^STARLINK/, "File:Starlink Mission (47926144123).jpg"],
  [/^ONEWEB/, "OneWeb"],
  [/^KUIPER/, "Project Kuiper"],
  [/^(NAVSTAR|GPS)/, "GPS Block III"],
  [/^(COSMOS|KOSMOS).*GLONASS|^GLONASS/, "GLONASS-K"],
  [/^(BEIDOU|GSAT0|GALILEO|QZS)/, "Satellite navigation"],
  [/^IRIDIUM/, "Iridium NEXT"],
  [/^ISS\b|ZARYA/, "International Space Station"],
  [/^(CSS|TIANHE|TIANGONG|WENTIAN|MENGTIAN)/, "Tiangong space station"],
  [/^HST\b|HUBBLE/, "Hubble Space Telescope"],
  [/^GOES/, "GOES-16"],
  [/^NOAA/, "NOAA-20"],
  [/^METEOSAT|^MSG/, "Meteosat Second Generation"],
  [/^SENTINEL/, "Sentinel-1"],
  [/^LANDSAT/, "Landsat 9"],
  [/^TDRS/, "TDRS-M"],
];

const COMMONS_FILE = /^File:/;

function commonsPhoto(file: string): MediaPhoto {
  const name = file.replace(COMMONS_FILE, "");
  return {
    src: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=640`,
    link: `https://commons.wikimedia.org/wiki/${encodeURIComponent(file)}`,
    credit: "Wikimedia Commons",
    exact: false,
    caption: name.replace(/\.[a-z]+$/i, "").replace(/\s*\(\d+\)$/, ""),
  };
}

async function satellitePhoto(name: string): Promise<MediaPhoto | null> {
  const cleaned = name.replace(/\([^)]*\)/g, "").trim();
  const exact = await exactWikiMatch(cleaned, "satellite", SAT_DESCRIPTION);
  if (exact) return wikiPhoto(exact, true);

  const family = SAT_FAMILIES.find(([re]) => re.test(cleaned.toUpperCase()))?.[1];
  if (family && COMMONS_FILE.test(family)) return commonsPhoto(family);
  const page = (family && (await wikiTitle(family))) || (await wikiTitle("Satellite"));
  return page ? wikiPhoto(page, false) : null;
}

// ── Route ───────────────────────────────────────────────────────────────────

const str = (v: unknown, max = 80) => (typeof v === "string" ? v.trim().slice(0, max) : "");

router.get("/entity-media", async (req, res) => {
  const kind = str(req.query.kind);
  let key: string;
  let resolve: () => Promise<EntityMediaResponse>;

  if (kind === "aircraft") {
    const hex = str(req.query.hex, 8).toLowerCase().replace(/[^0-9a-f]/g, "");
    const callsign = str(req.query.callsign, 10).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const reg = str(req.query.reg, 12).toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (!hex && !reg) return res.status(400).json({ error: "hex or reg required" });
    key = `a:${hex}:${reg}:${callsign}`;
    resolve = async () => {
      const [photo, route] = await Promise.all([aircraftPhoto(hex, reg), callsign ? aircraftRoute(callsign) : null]);
      return { photo, route };
    };
  } else if (kind === "ship") {
    const name = str(req.query.name);
    const category = str(req.query.category, 20).toUpperCase();
    key = `s:${name.toLowerCase()}:${category}`;
    resolve = async () => ({ photo: await shipPhoto(name, category), route: null });
  } else if (kind === "satellite") {
    const name = str(req.query.name);
    if (!name) return res.status(400).json({ error: "name required" });
    key = `o:${name.toLowerCase()}`;
    resolve = async () => ({ photo: await satellitePhoto(name), route: null });
  } else {
    return res.status(400).json({ error: "kind must be aircraft, ship or satellite" });
  }

  const cached = cacheGet(key);
  if (cached) return res.json(cached);
  const value = await resolve();
  cacheSet(key, value);
  res.set("Cache-Control", "public, max-age=3600");
  res.json(value);
});

export default router;
