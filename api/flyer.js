// api/flyer.js — Admin-only "photo of a flyer -> Local flyer event".
// Actions (?action=):
//   GET  status   public booleans only (what's configured)
//   GET  me       auth check
//   POST extract  {image: dataURL} -> AI-extracted fields (nothing saved)
//   POST publish  {image, fields}  -> geocode + store image + insert row (goes live)
//   GET  list     admin's flyer events
//   POST delete   {id}
import crypto from "node:crypto";
import { sql, hasDb, ensureTable, rowToEvent, todayET, FLYER_TYPES } from "./_lib/flyers.js";

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

// Auth is verified against the same Supabase project the app signs users into.
const AUTH_URL = "https://cdhyervrwmsmquovwrwj.supabase.co";
const AUTH_KEY = "sb_publishable_U5KBIkFT7l0jSSD8QaYJPQ_dEZWQJ63";

const STORAGE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
const BUCKET = "flyers";

function adminEmails() {
  return (process.env.ADMIN_EMAILS || "").split(/[,\s;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
}
function adminPin() {
  const p = (process.env.ADMIN_PIN || "").trim();
  return p.length >= 8 ? p : "";
}
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

async function getAdmin(req) {
  const pin = adminPin();
  const givenPin = req.headers["x-admin-pin"];
  if (pin && givenPin && safeEqual(givenPin, pin)) return { email: "pin-admin", via: "pin" };

  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const allow = adminEmails();
  if (!allow.length) return null;
  try {
    const r = await fetch(`${AUTH_URL}/auth/v1/user`, { headers: { apikey: AUTH_KEY, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    const email = String(u.email || "").toLowerCase();
    if (!email || !allow.includes(email)) return null;
    if (!u.email_confirmed_at && !u.confirmed_at) return null;
    return { email, via: "supabase" };
  } catch (e) { return null; }
}

// ── AI (vision) ───────────────────────────────────────────────────────────────
function aiTargets(req) {
  const out = [];
  const oidc = req.headers["x-vercel-oidc-token"] || process.env.VERCEL_OIDC_TOKEN || "";
  const gwKey = process.env.AI_GATEWAY_API_KEY || oidc;
  if (gwKey) {
    const models = (process.env.FLYER_MODEL ? [process.env.FLYER_MODEL] : []).concat(["google/gemini-2.5-flash", "openai/gpt-4.1-mini"]);
    for (const m of [...new Set(models)]) out.push({ name: "vercel-ai-gateway" + (process.env.AI_GATEWAY_API_KEY ? "" : " (oidc)"), url: "https://ai-gateway.vercel.sh/v1/chat/completions", key: gwKey, model: m });
  }
  if (process.env.OPENAI_API_KEY) out.push({ name: "openai", url: "https://api.openai.com/v1/chat/completions", key: process.env.OPENAI_API_KEY, model: "gpt-4.1-mini" });
  if (process.env.XAI_API_KEY) out.push({ name: "xai", url: "https://api.x.ai/v1/chat/completions", key: process.env.XAI_API_KEY, model: process.env.XAI_MODEL || "grok-4" });
  return out;
}

function buildPrompt() {
  const today = todayET();
  const weekday = new Date(today + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
  return `You read photos of event flyers/posters for a local "what's going on" app.
Today is ${weekday}, ${today} (America/New_York). Resolve relative or year-less dates to the NEXT upcoming occurrence on or after today. For recurring events ("every Friday"), use the next occurrence and mention the recurrence in the description.

Return ONLY a JSON object (no markdown) with exactly these keys:
{
 "title": string,                       // short event name as people would search it
 "description": string,                 // 1-3 sentences from the flyer (performers, details, age limits)
 "start_date": "YYYY-MM-DD" | null,
 "start_time": "HH:MM" (24h) | null,
 "end_date": "YYYY-MM-DD" | null,       // only if multi-day
 "end_time": "HH:MM" (24h) | null,
 "venue_name": string | null,
 "address": string | null,              // street address only
 "city": string | null,
 "state": "2-letter" | null,
 "zip": string | null,
 "price": string | null,                // e.g. "Free", "$10", "$15 adv / $20 door"
 "category": "event" | "place",         // "event" = dated show/concert/festival/one-off; "place" = an ongoing venue/business promo with no specific date
 "event_type": one of ${JSON.stringify(FLYER_TYPES)},
 "url": string | null,                  // ticket/info URL if printed (add https://)
 "confidence": { "<field>": number 0-1 for each field above except confidence/notes },
 "notes": string                        // anything ambiguous, e.g. "year not printed", "address inferred from venue name"
}
Use null for anything not on the flyer — do not invent addresses or URLs. If the state/city is not printed but obvious from the venue, fill it with low confidence.`;
}

function parseJsonLoose(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  try { return JSON.parse(t); } catch (err) { return null; }
}

async function extractWithAI(req, dataUrl) {
  const targets = aiTargets(req);
  if (!targets.length) throw Object.assign(new Error("No vision AI configured (need AI Gateway OIDC, AI_GATEWAY_API_KEY, OPENAI_API_KEY or XAI_API_KEY)"), { status: 503 });
  const errors = [];
  for (const t of targets) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45000);
      const r = await fetch(t.url, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t.key}` },
        body: JSON.stringify({
          model: t.model,
          temperature: 0.1,
          messages: [
            { role: "system", content: buildPrompt() },
            { role: "user", content: [
              { type: "text", text: "Extract the event from this flyer." },
              { type: "image_url", image_url: { url: dataUrl } },
            ] },
          ],
        }),
      });
      clearTimeout(timer);
      const body = await r.text();
      if (!r.ok) { errors.push(`${t.name}/${t.model}: HTTP ${r.status} ${body.slice(0, 160)}`); continue; }
      const j = JSON.parse(body);
      const content = j.choices?.[0]?.message?.content;
      const text = Array.isArray(content) ? content.map(c => c.text || "").join("") : content;
      const parsed = parseJsonLoose(text);
      if (!parsed) { errors.push(`${t.name}/${t.model}: unparseable reply`); continue; }
      return { fields: parsed, provider: t.name, model: t.model };
    } catch (e) {
      errors.push(`${t.name}/${t.model}: ${e.message}`);
    }
  }
  throw Object.assign(new Error("AI extraction failed: " + errors.join(" | ")), { status: 502 });
}

function normalizeFields(f) {
  const s = (v, max = 500) => (v == null ? null : String(v).trim().slice(0, max) || null);
  const date = v => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim()) ? String(v).trim() : null);
  const time = v => {
    if (!v) return null;
    const m = String(v).trim().match(/^(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
  };
  let url = s(f.url, 500);
  if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
  if (url && !/^https?:\/\/[^\s/]+\.[^\s]+/i.test(url)) url = null;
  const category = f.category === "place" ? "place" : "event";
  const conf = {};
  if (f.confidence && typeof f.confidence === "object") {
    for (const [k, v] of Object.entries(f.confidence)) { const n = Number(v); if (!isNaN(n)) conf[k] = Math.max(0, Math.min(1, n)); }
  }
  return {
    title: s(f.title, 160),
    description: s(f.description, 1200),
    start_date: date(f.start_date),
    start_time: time(f.start_time),
    end_date: date(f.end_date),
    end_time: time(f.end_time),
    venue_name: s(f.venue_name, 160),
    address: s(f.address, 200),
    city: s(f.city, 80),
    state: s(f.state, 2) ? String(f.state).trim().slice(0, 2).toUpperCase() : null,
    zip: (String(f.zip || "").match(/\d{5}/) || [null])[0],
    price: s(f.price, 80),
    category,
    event_type: FLYER_TYPES.includes(f.event_type) ? f.event_type : (category === "place" ? "Nightlife" : "Community"),
    url,
    confidence: conf,
    notes: s(f.notes, 400),
  };
}

// ── Geocoding (Nominatim, then ZIP centroid, then city) ───────────────────────
async function nominatim(params) {
  const qs = new URLSearchParams({ format: "json", limit: "1", countrycodes: "us", ...params });
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`, { headers: { "User-Agent": "Buzzfinder/1.0 (https://buzzfinder.app)", "Accept-Language": "en" } });
  if (!r.ok) return null;
  const d = await r.json();
  if (d && d[0]) return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon), label: d[0].display_name };
  return null;
}
async function geocode(f) {
  const tries = [];
  if (f.address && (f.city || f.zip)) tries.push(["address", { street: f.address, city: f.city || "", state: f.state || "", postalcode: f.zip || "" }]);
  if (f.venue_name && f.city) tries.push(["venue", { q: [f.venue_name, f.city, f.state].filter(Boolean).join(", ") }]);
  for (const [precision, params] of tries) {
    try { const g = await nominatim(params); if (g) return { ...g, precision }; } catch (e) {}
  }
  if (f.zip) {
    try {
      const r = await fetch(`https://api.zippopotam.us/us/${f.zip}`);
      if (r.ok) { const d = await r.json(); const p = d.places && d.places[0]; if (p) return { lat: parseFloat(p.latitude), lng: parseFloat(p.longitude), precision: "zip", label: `${p["place name"]}, ${p["state abbreviation"]} ${f.zip}` }; }
    } catch (e) {}
  }
  if (f.city && f.state) {
    try { const g = await nominatim({ city: f.city, state: f.state }); if (g) return { ...g, precision: "city" }; } catch (e) {}
  }
  return null;
}

// ── Image storage (Supabase Storage, public bucket) ──────────────────────────
function storageHeaders(extra = {}) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...extra };
}
async function ensureBucket() {
  const r = await fetch(`${STORAGE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: storageHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: 5 * 1024 * 1024, allowed_mime_types: ["image/jpeg", "image/png", "image/webp"] }),
  });
  if (r.ok) return true;
  const t = await r.text();
  if (/already exists|duplicate|409/i.test(t) || r.status === 409) return true;
  throw new Error(`bucket create failed: ${r.status} ${t.slice(0, 120)}`);
}
async function uploadImage(dataUrl, id) {
  if (!STORAGE_URL || !SERVICE_KEY) throw new Error("Supabase storage not configured");
  const m = String(dataUrl || "").match(/^data:(image\/(jpeg|png|webp));base64,(.+)$/);
  if (!m) throw new Error("image must be a jpeg/png/webp data URL");
  const buf = Buffer.from(m[3], "base64");
  if (buf.length > 4.5 * 1024 * 1024) throw new Error("image too large");
  const ext = m[2] === "jpeg" ? "jpg" : m[2];
  const path = `${id}.${ext}`;
  await ensureBucket();
  const r = await fetch(`${STORAGE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: storageHeaders({ "Content-Type": m[1], "x-upsert": "true", "Cache-Control": "max-age=31536000" }),
    body: buf,
  });
  if (!r.ok) throw new Error(`upload failed: ${r.status} ${(await r.text()).slice(0, 120)}`);
  return { path, url: `${STORAGE_URL}/storage/v1/object/public/${BUCKET}/${path}` };
}
async function deleteImage(path) {
  if (!path || !STORAGE_URL || !SERVICE_KEY) return;
  try {
    await fetch(`${STORAGE_URL}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: storageHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: [path] }),
    });
  } catch (e) {}
}

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const action = String(req.query.action || "").toLowerCase();
  try {
    const admin = await getAdmin(req);
    if (action === "status") {
      let db = false, dbError = null;
      if (hasDb()) { try { await ensureTable(); await sql()`select 1`; db = true; } catch (e) { dbError = String(e.message).slice(0, 80); } }
      return res.status(200).json({
        ai: aiTargets(req).map(t => t.name).filter((v, i, a) => a.indexOf(v) === i),
        db, dbError: admin ? dbError : (dbError ? "error" : null),
        storage: !!(STORAGE_URL && SERVICE_KEY),
        storageSameProjectAsAuth: STORAGE_URL ? STORAGE_URL.includes("cdhyervrwmsmquovwrwj") : null,
        adminEmailsSet: adminEmails().length > 0,
        adminPinSet: !!adminPin(),
      });
    }

    if (!admin) return res.status(401).json({ error: "Not authorized" });

    if (action === "me") return res.status(200).json({ ok: true, email: admin.email, via: admin.via });

    if (action === "extract" && req.method === "POST") {
      const image = req.body?.image;
      if (!image || !/^data:image\//.test(image)) return res.status(400).json({ error: "image (data URL) required" });
      const out = await extractWithAI(req, image);
      const fields = normalizeFields(out.fields);
      const lowConfidence = Object.entries(fields.confidence).filter(([, v]) => v < 0.7).map(([k]) => k);
      for (const k of ["title", "start_date", "city"]) if (!fields[k] && !lowConfidence.includes(k)) lowConfidence.push(k);
      return res.status(200).json({ fields, lowConfidence, provider: out.provider, model: out.model });
    }

    if (action === "publish" && req.method === "POST") {
      const f = normalizeFields(req.body?.fields || {});
      if (!f.title) return res.status(400).json({ error: "Title is required" });
      if (f.category === "event" && !f.start_date) return res.status(400).json({ error: "Start date is required for events" });
      if (!f.city && !f.zip) return res.status(400).json({ error: "City or ZIP is required so it shows up in the right town" });
      const geo = await geocode(f);
      if (!geo) return res.status(422).json({ error: "Couldn't find that location. Check the address, city, state, or ZIP." });
      await ensureTable();
      const id = crypto.randomUUID();
      let img = { path: null, url: null };
      if (req.body?.image) img = await uploadImage(req.body.image, id);
      const rows = await sql()`
        insert into flyer_events (id, created_by, category, event_type, title, description, start_date, start_time, end_date, end_time,
          venue_name, address, city, state, zip, price, url, image_url, image_path, lat, lng, geo_precision)
        values (${id}, ${admin.email}, ${f.category}, ${f.event_type}, ${f.title}, ${f.description}, ${f.start_date}, ${f.start_time},
          ${f.end_date}, ${f.end_time}, ${f.venue_name}, ${f.address}, ${f.city}, ${f.state}, ${f.zip}, ${f.price}, ${f.url},
          ${img.url}, ${img.path}, ${geo.lat}, ${geo.lng}, ${geo.precision})
        returning *`;
      return res.status(200).json({ ok: true, event: rowToEvent(rows[0]), geo: { precision: geo.precision, label: geo.label } });
    }

    if (action === "list") {
      await ensureTable();
      const rows = await sql()`select * from flyer_events order by created_at desc limit 200`;
      const today = todayET();
      return res.status(200).json({
        events: rows.map(r => {
          const end = r.end_date || r.start_date;
          const endStr = end ? (end instanceof Date ? end.toISOString().slice(0, 10) : String(end).slice(0, 10)) : null;
          return { ...rowToEvent(r), category: r.category, geoPrecision: r.geo_precision, createdAt: r.created_at, expired: endStr ? endStr < today : false };
        }),
      });
    }

    if (action === "delete" && req.method === "POST") {
      const id = String(req.body?.id || "").replace(/^flyer_/, "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "bad id" });
      await ensureTable();
      const rows = await sql()`delete from flyer_events where id = ${id} returning image_path`;
      if (!rows.length) return res.status(404).json({ error: "not found" });
      await deleteImage(rows[0].image_path);
      return res.status(200).json({ ok: true, deleted: id });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.log("flyer error:", e.message);
    return res.status(e.status || 500).json({ error: e.message || "server error" });
  }
}
