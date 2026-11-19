const STREAM_URL = "wss://stream.aisstream.io/v0/stream";
const WINDOW_MS = 18_000;
const REFRESH_MS = 30_000;
const RETRY_MS = 60_000;
const MAX_AGE_MS = 3 * 60_000;
const MAX_SHIPS = 5_000;

interface AisPosition {
  mmsi: number;
  vessel_name: string;
  lat: number;
  lon: number;
  sog?: number;
  cog?: number;
  source: "AISSTREAM";
  category: "UNKNOWN";
  last_updated: number;
}

interface AisMessage {
  error?: unknown;
  MessageType?: string;
  MetaData?: { MMSI?: number; ShipName?: string };
  Message?: { PositionReport?: { Latitude?: number; Longitude?: number; Sog?: number; Cog?: number } };
}

const positions = new Map<number, AisPosition>();
let nextAttemptAt = 0;
let inFlight: Promise<void> | undefined;

function collectPositions(key: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new WebSocket(STREAM_URL);
    const decoder = new TextDecoder();
    socket.binaryType = "arraybuffer";
    let received = false;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      socket.close();
      resolve(received);
    };
    const deadline = setTimeout(finish, WINDOW_MS);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        APIKey: key,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ["PositionReport"],
      }));
    });
    socket.addEventListener("error", finish);
    socket.addEventListener("close", finish);
    socket.addEventListener("message", ({ data }) => {
      if (finished) return;
      let message: AisMessage | null;
      try {
        message = JSON.parse(typeof data === "string" ? data : decoder.decode(data));
      } catch {
        return;
      }
      if (message?.error) return finish();
      if (message?.MessageType !== "PositionReport") return;
      const report = message.Message?.PositionReport;
      const mmsi = message.MetaData?.MMSI;
      const lat = report?.Latitude;
      const lon = report?.Longitude;
      if (typeof mmsi !== "number" || !Number.isInteger(mmsi) || mmsi <= 0 || mmsi > 999_999_999) return;
      if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90) return;
      if (typeof lon !== "number" || !Number.isFinite(lon) || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return;
      const name = message.MetaData?.ShipName;
      const sog = report?.Sog;
      const cog = report?.Cog;
      positions.delete(mmsi);
      positions.set(mmsi, {
        mmsi,
        vessel_name: typeof name === "string" ? name.trim().slice(0, 64) || "UNKNOWN" : "UNKNOWN",
        lat,
        lon,
        sog: typeof sog === "number" && sog >= 0 && sog < 102.3 ? sog : undefined,
        cog: typeof cog === "number" && cog >= 0 && cog < 360 ? cog : undefined,
        source: "AISSTREAM",
        category: "UNKNOWN",
        last_updated: Date.now(),
      });
      received = true;
      if (positions.size > MAX_SHIPS) {
        const oldest = positions.keys().next();
        if (!oldest.done) positions.delete(oldest.value);
      }
    });
  });
}

export async function readAisSnapshot(): Promise<AisPosition[]> {
  const key = process.env.ais_stream?.trim();
  if (!key) return [];

  if (!inFlight && Date.now() >= nextAttemptAt) {
    inFlight = collectPositions(key)
      .catch(() => false)
      .then((success) => {
        nextAttemptAt = Date.now() + (success ? REFRESH_MS : RETRY_MS);
      })
      .finally(() => { inFlight = undefined; });
  }
  await inFlight;
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [id, ship] of positions) {
    if (ship.last_updated < cutoff) positions.delete(id);
  }
  return [...positions.values()];
}
