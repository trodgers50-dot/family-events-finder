// api/events.js — Multi-source Event Proxy
// Sources: Ticketmaster + SerpAPI (Google Events) + Virginia Beach City Calendar

const TM_KEY   = process.env.TM_KEY;
const SERP_KEY = process.env.SERP_KEY;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { zip } = req.query;
  if (!zip || zip.length !== 5) {
    return res.status(400).json({ error: "Valid 5-digit ZIP required" });
  }

  const results = { events: [], errors: [] };
  const VB_ZIPS = ["23451","23452","23453","23454","23455","23456","23457","23458","23459","23460","23461","23462","23463","23464","23465","23466","23467","23479"];
  const isVB = VB_ZIPS.includes(zip);

  // ── 1. Ticketmaster ──────────────────────────────────────────────────────────
  try {
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${TM_KEY}&postalCode=${zip}&countryCode=US&radius=50&unit=miles&size=20&sort=date,asc`;
    const r = await fetch(url);
    const d = await r.json();
    if (d.fault) throw new Error(d.fault.faultstring);
    const events = (d._embedded?.events || []).map(tm => {
      const venue = tm._embedded?.venues?.[0];
      const date = tm.dates?.start?.localDate || "";
      const type = classifyTM(tm);
      return {
        id: "tm_" + tm.id,
        name: tm.name,
        type,
        startDate: date,
        endDate: date,
        location: venue?.name || "See event page",
        address: [venue?.address?.line1, venue?.city?.name, venue?.state?.stateCode].filter(Boolean).join(", "),
        description: tm.info || tm.pleaseNote || "",
        familyRating: 4,
        cost: tm.priceRanges ? `$${Math.round(tm.priceRanges[0].min)}+` : "See site",
        url: tm.url,
        source: "Ticketmaster",
        subEvents: (tm._embedded?.attractions || []).slice(0, 3).map(a => ({
          time: tm.dates?.start?.localTime?.slice(0, 5) || "TBD",
          name: a.name,
          day: date ? new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }) : "TBD",
        })),
      };
    });
    results.events.push(...events);
  } catch (e) {
    results.errors.push("Ticketmaster: " + e.message);
  }

  // ── 2. SerpAPI — Google Events (general ZIP search) ──────────────────────────
  try {
    const query = encodeURIComponent(`family events near ${zip}`);
    const url = `https://serpapi.com/search.json?engine=google_events&q=${query}&api_key=${SERP_KEY}&hl=en&gl=us`;
    const r = await fetch(url);
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    const events = (d.events_results || []).slice(0, 15).map((ev, i) => {
      const dateStr = parseGoogleDate(ev.date?.start_date || ev.date?.when || "");
      return {
        id: "serp_" + i,
        name: ev.title || "Local Event",
        type: classifyByTitle(ev.title || ""),
        startDate: dateStr,
        endDate: dateStr,
        location: ev.venue?.name || ev.address?.[0] || "See event page",
        address: ev.address?.join(", ") || "",
        description: ev.description || "",
        familyRating: 4,
        cost: ev.ticket_info?.[0]?.price || "Free",
        url: ev.link || ev.ticket_info?.[0]?.link || "",
        source: "Google Events",
        subEvents: [],
      };
    });
    results.events.push(...events);
  } catch (e) {
    results.errors.push("Google Events: " + e.message);
  }

  // ── 3. SerpAPI — Virginia Beach specific search ──────────────────────────────
  if (isVB) {
    try {
      const query = encodeURIComponent(`free family events Virginia Beach farmers market festival`);
      const url = `https://serpapi.com/search.json?engine=google_events&q=${query}&api_key=${SERP_KEY}&hl=en&gl=us&location=Virginia+Beach,Virginia,United+States`;
      const r = await fetch(url);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      const existingNames = new Set(results.events.map(e => e.name.toLowerCase()));
      const events = (d.events_results || []).slice(0, 10)
        .map((ev, i) => {
          const dateStr = parseGoogleDate(ev.date?.start_date || ev.date?.when || "");
          return {
            id: "serp_vb_" + i,
            name: ev.title || "Local Event",
            type: classifyByTitle(ev.title || ""),
            startDate: dateStr,
            endDate: dateStr,
            location: ev.venue?.name || ev.address?.[0] || "Virginia Beach",
            address: ev.address?.join(", ") || "Virginia Beach, VA",
            description: ev.description || "",
            familyRating: 5,
            cost: ev.ticket_info?.[0]?.price || "Free",
            url: ev.link || "",
            source: "Google Events",
            subEvents: [],
          };
        })
        .filter(e => !existingNames.has(e.name.toLowerCase()));
      results.events.push(...events);
    } catch (e) {
      results.errors.push("VB Google Events: " + e.message);
    }

    // ── 4. Virginia Beach City Parks & Rec Calendar ──────────────────────────
    try {
      const url = `https://www.vbgov.com/government/departments/parks-recreation/pages/events.aspx`;
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 FamilyEventsApp/1.0" } });
      const html = await r.text();
      // Parse event titles and dates from the HTML
      const titleMatches = [...html.matchAll(/<h[23][^>]*class="[^"]*event[^"]*"[^>]*>([^<]+)<\/h[23]>/gi)];
      const events = titleMatches.slice(0, 8).map((m, i) => ({
        id: "vb_city_" + i,
        name: m[1].trim(),
        type: classifyByTitle(m[1]),
        startDate: "",
        endDate: "",
        location: "Virginia Beach Parks & Recreation",
        address: "Virginia Beach, VA",
        description: "City of Virginia Beach community event.",
        familyRating: 5,
        cost: "Free",
        url: "https://www.vbgov.com/government/departments/parks-recreation/pages/events.aspx",
        source: "Virginia Beach City",
        subEvents: [],
      }));
      if (events.length > 0) results.events.push(...events);
    } catch (e) {
      results.errors.push("VB City Calendar: " + e.message);
    }
  }

  // Sort by date, put undated events last
  results.events.sort((a, b) => {
    if (!a.startDate && !b.startDate) return 0;
    if (!a.startDate) return 1;
    if (!b.startDate) return -1;
    return a.startDate.localeCompare(b.startDate);
  });

  return res.status(200).json(results);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseGoogleDate(str) {
  if (!str) return "";
  try {
    if (str.match(/^\d{4}-\d{2}-\d{2}$/)) return str;
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    return "";
  } catch { return ""; }
}

function classifyTM(e) {
  const seg = e.classifications?.[0]?.segment?.name || "";
  const n = (e.name || "").toLowerCase();
  if (seg === "Sports") return "Sports";
  if (seg === "Music") return "Music";
  if (seg === "Arts & Theatre") return "Arts";
  if (n.includes("family") || n.includes("kid") || n.includes("children")) return "Family";
  if (n.includes("festival") || n.includes("fest")) return "Festival";
  if (n.includes("carnival") || n.includes("fair")) return "Carnival";
  if (n.includes("market")) return "Market";
  return "Other";
}

function classifyByTitle(title) {
  const t = title.toLowerCase();
  if (t.includes("brewery") || t.includes("brewing") || t.includes("beer")) return "Brewery";
  if (t.includes("farmer") || t.includes("market") || t.includes("produce")) return "Market";
  if (t.includes("food") || t.includes("truck") || t.includes("taste")) return "Food";
  if (t.includes("kid") || t.includes("children") || t.includes("toddler") || t.includes("stem") || t.includes("splash")) return "Kids";
  if (t.includes("festival") || t.includes("fest")) return "Festival";
  if (t.includes("carnival") || t.includes("fair")) return "Carnival";
  if (t.includes("concert") || t.includes("music") || t.includes("jazz") || t.includes("band")) return "Music";
  if (t.includes("art") || t.includes("craft") || t.includes("gallery")) return "Arts";
  if (t.includes("family")) return "Family";
  return "Community";
}
