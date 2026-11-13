import { useState } from "react";
import { greatCircleKm, useEntityMedia, type Airport, type EntityMediaQuery, type FlightRoute } from "../lib/entity-media";

const MONO = "'Share Tech Mono','Courier New',monospace";
const MUTED = "rgba(180,200,220,0.5)";

interface Props {
  query: EntityMediaQuery;
  color: string;
  /** Live position, used to show how far along its route an aircraft is. */
  position?: { lat: number; lon: number };
}

export function EntityMediaSection({ query, color, position }: Props) {
  const { data, isLoading, error } = useEntityMedia(query);

  return (
    <>
      <EntityPhoto
        key={data?.photo?.src ?? "none"}
        color={color}
        loading={isLoading}
        photo={error ? null : data?.photo ?? null}
        kind={query.kind}
      />
      {query.kind === "aircraft" && (
        <RouteSection color={color} loading={isLoading} route={data?.route ?? null} position={position} />
      )}
    </>
  );
}

function EntityPhoto({
  photo,
  loading,
  color,
  kind,
}: {
  photo: { src: string; link: string; credit: string; exact: boolean; caption?: string } | null;
  loading: boolean;
  color: string;
  kind: EntityMediaQuery["kind"];
}) {
  const [failed, setFailed] = useState(false);
  const showImage = photo && !failed;

  return (
    <figure style={{ margin: "0 0 12px" }}>
      <div
        style={{
          position: "relative",
          aspectRatio: "16 / 9",
          overflow: "hidden",
          border: `1px solid ${color}33`,
          background: "rgba(255,255,255,0.03)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {showImage ? (
          <a href={photo.link} target="_blank" rel="noopener noreferrer" style={{ display: "block", width: "100%", height: "100%" }}>
            <img
              src={photo.src}
              alt={photo.caption ? `Photo: ${photo.caption}` : `Photo of the selected ${kind}`}
              referrerPolicy="no-referrer"
              loading="lazy"
              onError={() => setFailed(true)}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          </a>
        ) : (
          <span style={{ fontSize: 9, letterSpacing: "0.2em", color: MUTED }}>
            {loading ? "ACQUIRING IMAGERY…" : "NO IMAGERY AVAILABLE"}
          </span>
        )}
        {showImage && !photo.exact && (
          <span
            style={{
              position: "absolute",
              top: 6,
              left: 6,
              padding: "2px 6px",
              fontSize: 8,
              letterSpacing: "0.15em",
              color: "#020408",
              background: color,
            }}
          >
            REPRESENTATIVE
          </span>
        )}
      </div>
      {showImage && (
        <figcaption style={{ marginTop: 4, fontSize: 8, letterSpacing: "0.06em", color: MUTED, display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{photo.caption ?? ""}</span>
          <span style={{ whiteSpace: "nowrap" }}>{photo.credit}</span>
        </figcaption>
      )}
    </figure>
  );
}

function RouteSection({
  route,
  loading,
  color,
  position,
}: {
  route: FlightRoute | null;
  loading: boolean;
  color: string;
  position?: { lat: number; lon: number };
}) {
  if (!route) {
    return (
      <p style={{ margin: "0 0 12px", fontSize: 9, letterSpacing: "0.15em", color: MUTED }}>
        {loading ? "RESOLVING ROUTE…" : "ROUTE NOT PUBLISHED"}
      </p>
    );
  }

  const { origin, destination } = route;
  let progress: number | null = null;
  let remainingKm: number | null = null;
  if (position) {
    const flown = greatCircleKm(origin.lat, origin.lon, position.lat, position.lon);
    remainingKm = greatCircleKm(position.lat, position.lon, destination.lat, destination.lon);
    progress = Math.min(1, Math.max(0, flown / (flown + remainingKm)));
  }

  return (
    <section aria-label="Flight route" style={{ margin: "0 0 12px", padding: "10px", border: `1px solid ${color}33`, background: `${color}0a` }}>
      {route.airline && (
        <div style={{ fontSize: 8, letterSpacing: "0.2em", color: MUTED, marginBottom: 8, textTransform: "uppercase" }}>{route.airline}</div>
      )}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <AirportBlock airport={origin} label="FROM" color={color} align="left" />
        <AirportBlock airport={destination} label="TO" color={color} align="right" />
      </div>
      {progress !== null && (
        <div style={{ marginTop: 10 }}>
          <div
            role="progressbar"
            aria-label="Route progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            style={{ position: "relative", height: 2, background: "rgba(255,255,255,0.1)" }}
          >
            <div style={{ position: "absolute", inset: 0, width: `${progress * 100}%`, background: color, boxShadow: `0 0 6px ${color}` }} />
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                top: -3,
                left: `calc(${progress * 100}% - 4px)`,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: color,
                boxShadow: `0 0 8px ${color}`,
              }}
            />
          </div>
          <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", fontSize: 8, letterSpacing: "0.1em", color: MUTED }}>
            <span>{Math.round(progress * 100)}% FLOWN</span>
            {remainingKm !== null && <span>{Math.round(remainingKm).toLocaleString()} KM TO GO</span>}
          </div>
        </div>
      )}
      <p style={{ margin: "8px 0 0", fontSize: 7, letterSpacing: "0.1em", color: "rgba(180,200,220,0.35)" }}>
        SCHEDULED ROUTE FOR THIS CALLSIGN · ADSBDB
      </p>
    </section>
  );
}

function AirportBlock({ airport, label, color, align }: { airport: Airport; label: string; color: string; align: "left" | "right" }) {
  const code = airport.iata ?? airport.icao ?? "—";
  const place = [airport.city, airport.country].filter(Boolean).join(", ");
  return (
    <div style={{ minWidth: 0, flex: 1, textAlign: align, fontFamily: MONO }}>
      <div style={{ fontSize: 8, letterSpacing: "0.2em", color: MUTED }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "0.08em", color, textShadow: `0 0 8px ${color}66`, lineHeight: 1.2 }}>{code}</div>
      <div title={airport.name} style={{ fontSize: 9, color: "rgba(230,245,255,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {place || airport.name}
      </div>
    </div>
  );
}
