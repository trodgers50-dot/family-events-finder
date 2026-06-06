// api/events.js — Buzz Multi-Source Event Proxy (Fast version)
// Sources run in parallel with aggressive timeouts

const TM_KEY    = process.env.TM_KEY;
const SERP_KEY  = process.env.SERP_KEY;
const RAPID_KEY = process.env.RAPID_KEY;

// Wrap any fetch with a timeout so slow APIs don't hold up results
async function fetchWithTimeout(promise, ms = 3000) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timeout")), ms)
  );
  return Promise.race([promise, timeout]);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { zip } = req.query;
  if (!zip || zip.length !== 5) {
    return res.status(400).json({ error: "Valid 5-digit ZIP required" });
  }

  const VB_ZIPS = ["23451","23452","23453","23454","23455","23456","23457","23458","23459","23460","23461","23462","23463","23464","23465","23466","23467","23479"];
  const isVB = VB_ZIPS.includes(zip);
  const cityName = getCityFromZip(zip);
  const results = { events: [], errors: [] };

  // Run all sources in parallel with 3 second timeout each
  const [tmRes, serpRes, rapidRes, vbRes] = await Promise.allSettled([
    fetchWithTimeout(fetchTicketmaster(zip), 3000),
    fetchWithTimeout(fetchSerpAPI(cityName, zip), 3000),
    fetchWithTimeout(fetchRapidAPI(cityName, zip), 3000),
    isVB ? fetchWithTimeout(fetchVirginiaBeach(), 3000) : Promise.resolve([]),
  ]);

  if (tmRes.status === "fulfilled") results.events.push(...tmRes.value);
  else results.errors.push("Ticketmaster: " + tmRes.reason?.message);

  if (serpRes.status === "fulfilled") results.events.push(...serpRes.value);
  else results.errors.push("SerpAPI: " + serpRes.reason?.message);

  if (rapidRes.status === "fulfilled") results.events.push(...rapidRes.value);
  else results.errors.push("RapidAPI: " + rapidRes.reason?.message);

  if (vbRes.status === "fulfilled") results.events.push(...vbRes.value);
  else results.errors.push("VB City: " + vbRes.reason?.message);

  // Deduplicate by name
  const seen = new Set();
  results.events = results.events.filter(ev => {
    const key = ev.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by date
  results.events.sort((a, b) => {
    if (!a.startDate) return 1;
    if (!b.startDate) return -1;
    return a.startDate.localeCompare(b.startDate);
  });

  return res.status(200).json(results);
}

// ── Ticketmaster ──────────────────────────────────────────────────────────────
async function fetchTicketmaster(zip) {
  const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${TM_KEY}&postalCode=${zip}&countryCode=US&radius=50&unit=miles&size=25&sort=date,asc`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.fault) throw new Error(d.fault.faultstring);
  return (d._embedded?.events || []).map(tm => {
    const venue = tm._embedded?.venues?.[0];
    const date = tm.dates?.start?.localDate || "";
    // Use Ticketmaster's own segment/genre data first for accuracy
    const seg = tm.classifications?.[0]?.segment?.name || "";
    const genre = tm.classifications?.[0]?.genre?.name || "";
    const subGenre = tm.classifications?.[0]?.subGenre?.name || "";
    const tmType = seg === "Music" ? "Music"
      : seg === "Sports" ? "Sports"
      : seg === "Arts & Theatre" ? "Arts"
      : genre === "Family" || subGenre === "Family" ? "Family"
      : classifyByTitle(tm.name);
    return {
      id: "tm_" + tm.id,
      name: tm.name,
      type: tmType,
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
}

// ── SerpAPI ───────────────────────────────────────────────────────────────────
async function fetchSerpAPI(cityName, zip) {
  const query = encodeURIComponent(`events in ${cityName} this month`);
  const url = `https://serpapi.com/search.json?engine=google_events&q=${query}&api_key=${SERP_KEY}&hl=en&gl=us`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return (d.events_results || []).slice(0, 12).map((ev, i) => ({
    id: "serp_" + i + "_" + zip,
    name: ev.title || "Local Event",
    type: classifyByTitle(ev.title || ""),
    startDate: parseDate(ev.date?.start_date || ev.date?.when || ""),
    endDate: parseDate(ev.date?.start_date || ""),
    location: ev.venue?.name || ev.address?.[0] || cityName,
    address: ev.address?.join(", ") || cityName,
    description: ev.description || "",
    familyRating: 4,
    cost: ev.ticket_info?.[0]?.price || "Free",
    url: ev.link || "",
    source: "Google Events",
    subEvents: [],
  }));
}

// ── RapidAPI ──────────────────────────────────────────────────────────────────
async function fetchRapidAPI(cityName, zip) {
  const query = encodeURIComponent(`things to do in ${cityName}`);
  const url = `https://real-time-events-search.p.rapidapi.com/search-events?query=${query}&date=any&is_virtual=false&start=0`;
  const r = await fetch(url, {
    headers: {
      "x-rapidapi-key": RAPID_KEY,
      "x-rapidapi-host": "real-time-events-search.p.rapidapi.com",
      "Content-Type": "application/json",
    }
  });
  const d = await r.json();
  return (d.data || []).slice(0, 12).map((ev, i) => ({
    id: "rapid_" + i + "_" + zip,
    name: ev.name || ev.title || "Local Event",
    type: classifyByTitle(ev.name || ev.title || ""),
    startDate: parseDate(ev.start_time || ev.date || ""),
    endDate: parseDate(ev.end_time || ev.date || ""),
    location: ev.venue?.name || ev.location?.name || cityName,
    address: ev.venue?.full_address || ev.location?.address || cityName,
    description: ev.description || "",
    familyRating: 4,
    cost: ev.is_free ? "Free" : ev.ticket_links?.[0]?.price || "See site",
    url: ev.link || ev.ticket_links?.[0]?.link || "",
    source: "RapidAPI Events",
    subEvents: [],
  }));
}

// ── Virginia Beach City ───────────────────────────────────────────────────────
async function fetchVirginiaBeach() {
  const r = await fetch("https://www.vbgov.com/api/events?format=json", {
    headers: { "User-Agent": "Mozilla/5.0 BuzzApp/1.0", "Accept": "application/json" }
  });
  if (!r.ok) throw new Error(`VB returned ${r.status}`);
  const d = await r.json();
  const events = Array.isArray(d) ? d : d.events || d.data || [];
  return events.slice(0, 10).map((ev, i) => ({
    id: "vb_" + i,
    name: ev.title || ev.name || "City Event",
    type: classifyByTitle(ev.title || ev.name || ""),
    startDate: parseDate(ev.date || ev.start_date || ev.startDate || ""),
    endDate: parseDate(ev.end_date || ev.endDate || ""),
    location: ev.location || ev.venue || "Virginia Beach",
    address: ev.address || "Virginia Beach, VA",
    description: ev.description || ev.summary || "",
    familyRating: 5,
    cost: ev.cost || ev.price || "Free",
    url: ev.url || ev.link || "https://www.vbgov.com",
    source: "Virginia Beach City",
    subEvents: [],
  }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseDate(str) {
  if (!str) return "";
  try {
    const currentYear = new Date().getFullYear();
    const today = new Date(); today.setHours(0,0,0,0);

    // Handle YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const year = parseInt(str.slice(0, 4));
      // If year is wrong (before 2020), replace with correct year
      if (year < 2020) {
        const fixed = `${currentYear}${str.slice(4)}`;
        const d = new Date(fixed + "T00:00:00");
        if (!isNaN(d.getTime())) {
          if (d < today) d.setFullYear(currentYear + 1);
          return d.toISOString().split("T")[0];
        }
      }
      return str;
    }

    // Handle short dates like "Jun 6" or "June 6"
    if (/^[A-Za-z]+ \d{1,2}$/.test(str.trim())) {
      const d = new Date(`${str.trim()} ${currentYear}`);
      if (!isNaN(d.getTime())) {
        if (d < today) d.setFullYear(currentYear + 1);
        return d.toISOString().split("T")[0];
      }
    }

    // Handle "Jun 6, 2026" or ISO strings
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      if (d.getFullYear() < 2020) {
        d.setFullYear(currentYear);
        if (d < today) d.setFullYear(currentYear + 1);
      }
      return d.toISOString().split("T")[0];
    }
    return "";
  } catch { return ""; }
}

function getCityFromZip(zip) {
  const z = parseInt(zip);
  if (z>=20000&&z<=24699) return "Virginia Beach";
  if (z>=10000&&z<=14999) return "New York";
  if (z>=90000&&z<=96199) return "Los Angeles";
  if (z>=75000&&z<=79999) return "Houston";
  if (z>=32000&&z<=34999) return "Miami";
  if (z>=60000&&z<=62999) return "Chicago";
  if (z>=30000&&z<=31999) return "Atlanta";
  if (z>=98000&&z<=98199) return "Seattle";
  if (z>=80000&&z<=80299) return "Denver";
  if (z>=85000&&z<=85099) return "Phoenix";
  if (z>=37000&&z<=38599) return "Nashville";
  if (z>=70000&&z<=71199) return "New Orleans";
  if (z>=28200&&z<=28299) return "Charlotte";
  if (z>=94100&&z<=94199) return "San Francisco";
  if (z>=75200&&z<=75299) return "Dallas";
  if (z>=78700&&z<=78799) return "Austin";
  if (z>=97200&&z<=97299) return "Portland";
  if (z>=89100&&z<=89199) return "Las Vegas";
  if (z>=33600&&z<=33699) return "Tampa";
  if (z>=32800&&z<=32899) return "Orlando";
  if (z>=92100&&z<=92199) return "San Diego";
  return "your area";
}

function classifyByTitle(title) {
  const t = (title || "").toLowerCase();
  if (t.includes("comedy")||t.includes("stand-up")||t.includes("karaoke")||t.includes("bar crawl")||t.includes("nightclub")||t.includes("rooftop bar")||t.includes("edm")||t.includes("dj ")) return "Nightlife";
  if (t.includes("brewery")||t.includes("brewing")||t.includes("beer")||t.includes("whiskey")||t.includes("wine tasting")||t.includes("cocktail")) return "Brewery";
  if (t.includes("farmer")||t.includes("farmers market")||t.includes("market")) return "Market";
  if (t.includes("food truck")||t.includes("taste")||t.includes("culinary")||t.includes("restaurant")) return "Food";
  if (t.includes("concert")||t.includes("music")||t.includes("jazz")||t.includes("band")||t.includes("live music")||t.includes("symphony")) return "Music";
  if (t.includes("festival")||t.includes("fest")) return "Festival";
  if (t.includes("art")||t.includes("gallery")||t.includes("exhibition")||t.includes("improv")||t.includes("theatre")||t.includes("theater")||t.includes("murder mystery")) return "Arts";
  if (t.includes("sport")||t.includes("5k")||t.includes("run")||t.includes("race")||t.includes("marathon")||t.includes("volleyball")||t.includes("basketball")||t.includes("soccer")) return "Sports";
  if (t.includes("hike")||t.includes("kayak")||t.includes("yoga")||t.includes("outdoor")||t.includes("nature")||t.includes("beach")) return "Outdoor";
  if (t.includes("kid")||t.includes("children")||t.includes("toddler")||t.includes("stem")||t.includes("carnival")||t.includes("family fun")) return "Kids";
  if (t.includes("speed dating")||t.includes("singles")||t.includes("mixer")||t.includes("dating")) return "Community";
  return "Community";
}
