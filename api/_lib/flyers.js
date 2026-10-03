// api/_lib/flyers.js — shared storage helpers for "Local flyer" events.
// Rows live in Postgres (Supabase via the Vercel integration's POSTGRES_URL).
// Not a route: Vercel ignores files under api/_lib.
import postgres from "postgres";

const TYPES = ["Festival","Market","Music","Arts","Family","Food","Community","Brewery","Carnival","Kids","Sports","Nightlife","Outdoor","Other"];
export const FLYER_TYPES = TYPES;

let _sql = null;
let _ready = null;

function dbUrl() {
  const raw = process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING || "";
  if (!raw) return "";
  // Strip query params (sslmode / supa / pgbouncer) — set ssl explicitly instead.
  return raw.split("?")[0];
}

export function hasDb() { return !!dbUrl(); }

export function sql() {
  if (_sql) return _sql;
  const url = dbUrl();
  if (!url) throw new Error("POSTGRES_URL not configured");
  _sql = postgres(url, {
    ssl: "require",
    prepare: false,          // Supavisor transaction pooler
    max: 1,
    idle_timeout: 20,
    connect_timeout: 8,
  });
  return _sql;
}

export async function ensureTable() {
  if (_ready) return _ready;
  _ready = (async () => {
    const db = sql();
    await db`
      create table if not exists flyer_events (
        id uuid primary key default gen_random_uuid(),
        created_at timestamptz not null default now(),
        created_by text,
        status text not null default 'published',
        category text not null default 'event',
        event_type text,
        title text not null,
        description text,
        start_date date,
        start_time text,
        end_date date,
        end_time text,
        venue_name text,
        address text,
        city text,
        state text,
        zip text,
        price text,
        url text,
        image_url text,
        image_path text,
        lat double precision,
        lng double precision,
        geo_precision text
      )`;
    await db`create index if not exists flyer_events_geo_idx on flyer_events (lat, lng)`;
    // Keep it off the public Data API: RLS on, no policies (server uses Postgres directly).
    await db`alter table flyer_events enable row level security`;
  })().catch(e => { _ready = null; throw e; });
  return _ready;
}

// Today's civil date in the app's home zone (US Eastern).
export function todayET() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function toISODate(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function calcDistance(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// "19:30" -> "7:30 PM"
export function prettyTime(t) {
  if (!t) return "";
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(t);
  let h = +m[1]; const min = m[2];
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${min} ${ap}`;
}

export function rowToEvent(r) {
  const startDate = toISODate(r.start_date);
  const endDate = toISODate(r.end_date) || startDate;
  const timeLabel = prettyTime(r.start_time) + (r.end_time ? ` – ${prettyTime(r.end_time)}` : "");
  const addr = [r.address, r.city, [r.state, r.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const isPlace = r.category === "place";
  const base = {
    id: "flyer_" + r.id,
    flyerId: r.id,
    name: r.title,
    type: TYPES.includes(r.event_type) ? r.event_type : (isPlace ? "Nightlife" : "Community"),
    image: r.image_url || null,
    photo: r.image_url || null,
    location: r.venue_name || r.city || "",
    address: addr,
    description: r.description || "",
    cost: r.price || "See flyer",
    price: r.price || null,
    url: r.url || "",
    source: "Local flyer",
    isFlyer: true,
    lat: r.lat, lng: r.lng,
    familyRating: 5,
  };
  if (isPlace) {
    return { ...base, kind: "place", hours: timeLabel || null, openNow: null, startDate: startDate || null, rating: null, reviews: null };
  }
  return {
    ...base,
    startDate, endDate,
    time: timeLabel || undefined,
    startTime: r.start_time || undefined,
    subEvents: timeLabel ? [{
      time: prettyTime(r.start_time) || "TBD",
      name: r.venue_name || r.title,
      day: startDate ? new Date(startDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "TBD",
    }] : [],
  };
}

// Live (non-expired) flyer rows near a point. Never throws; bounded by timeoutMs.
export async function nearbyFlyers({ lat, lng, miles = 45, category = "event", timeoutMs = 2500 }) {
  if (!hasDb() || !(lat && lng)) return [];
  const work = (async () => {
    await ensureTable();
    const db = sql();
    const dLat = miles / 69;
    const dLng = miles / (69 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
    const today = todayET();
    const rows = await db`
      select * from flyer_events
      where status = 'published'
        and category = ${category}
        and lat between ${lat - dLat} and ${lat + dLat}
        and lng between ${lng - dLng} and ${lng + dLng}
        and (
          coalesce(end_date, start_date) >= ${today}::date
          or (start_date is null and end_date is null and created_at > now() - interval '90 days')
        )
      order by start_date nulls last
      limit 60`;
    return rows
      .map(r => ({ r, d: calcDistance(lat, lng, r.lat, r.lng) }))
      .filter(x => x.d <= miles)
      .map(x => ({ ...rowToEvent(x.r), distanceMiles: Math.round(x.d * 10) / 10 }));
  })();
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), timeoutMs));
  try {
    const out = await Promise.race([work, timeout]);
    if (out === null) console.log("Flyer lookup timed out");
    return out || [];
  } catch (e) {
    console.log("Flyer lookup failed:", e.message);
    return [];
  }
}
