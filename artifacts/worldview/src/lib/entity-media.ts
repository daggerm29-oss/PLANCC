import useSWR from "swr";

export type EntityMediaQuery =
  | { kind: "aircraft"; hex: string; callsign?: string; reg?: string }
  | { kind: "ship"; name: string; category?: string }
  | { kind: "satellite"; name: string };

export interface MediaPhoto {
  src: string;
  link: string;
  credit: string;
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

export interface EntityMedia {
  photo: MediaPhoto | null;
  route: FlightRoute | null;
}

function mediaUrl(q: EntityMediaQuery): string {
  const base = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/entity-media`;
  const params = new URLSearchParams({ kind: q.kind });
  if (q.kind === "aircraft") {
    params.set("hex", q.hex);
    if (q.callsign) params.set("callsign", q.callsign.trim());
    if (q.reg) params.set("reg", q.reg);
  } else {
    params.set("name", q.name);
    if (q.kind === "ship" && q.category) params.set("category", q.category);
  }
  return `${base}?${params}`;
}

const fetchMedia = async (url: string): Promise<EntityMedia> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`entity-media ${res.status}`);
  return res.json();
};

export function useEntityMedia(query: EntityMediaQuery | undefined) {
  return useSWR(query ? mediaUrl(query) : null, fetchMedia, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    dedupingInterval: 60 * 60 * 1000,
  });
}

const EARTH_RADIUS_KM = 6371;

export function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
