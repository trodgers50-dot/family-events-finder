// api/places.js — Buzz "Things to do" places proxy (SerpAPI Google Maps)
// Mirrors api/events.js style: parallel queries, short timeouts, Supabase cache

const SERP_KEY     = process.env.SERP_KEY  || "";
const SUPABASE_URL = "https://cdhyervrwmsmquovwrwj.supabase.co";
const SUPABASE_KEY = "sb_publishable_U5KBIkFT7l0jSSD8QaYJPQ_dEZWQJ63";

const STATE_FULL_NAMES = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",
  CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",
  IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",
  ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",
  MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",
  OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",
  TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",
  WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",DC:"District of Columbia"
};

const ZIP_STATE_PREFIX = {
  "01":"MA","02":"MA","03":"NH","04":"ME","05":"VT","06":"CT","07":"NJ",
  "08":"NJ","10":"NY","11":"NY","12":"NY","13":"NY","14":"NY","15":"PA",
  "16":"PA","17":"PA","18":"PA","19":"PA","20":"DC","21":"MD","22":"VA",
  "23":"VA","24":"WV","25":"WV","26":"WV","27":"NC","28":"NC","29":"SC",
  "30":"GA","31":"NE","32":"FL","33":"FL","34":"FL","35":"AL","36":"AL",
  "37":"TN","38":"TN","39":"MS","40":"KY","41":"KY","42":"KY","43":"OH",
  "44":"OH","45":"OH","46":"IN","47":"IN","48":"MI","49":"MI","50":"IA",
  "51":"IA","52":"IA","53":"WI","54":"WI","55":"MN","56":"MN","57":"SD",
  "58":"ND","59":"MT","60":"IL","61":"IL","62":"IL","63":"MO","64":"MO",
  "65":"MO","66":"KS","67":"KS","68":"NE","69":"NE","70":"LA","71":"AR",
  "72":"AR","73":"OK","74":"OK","75":"TX","76":"TX","77":"TX","78":"TX",
  "79":"TX","80":"CO","81":"CO","82":"WY","83":"ID","84":"UT","85":"AZ",
  "86":"AZ","87":"NM","88":"NM","89":"NV","90":"CA","91":"CA","92":"CA",
  "93":"CA","94":"CA","95":"CA","96":"HI","97":"OR","98":"WA","99":"AK"
};

async function getCached(cacheKey) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/event_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=events,expires_at`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
    );
    if (!r.ok) return null;
    const d = await r.json();
    if (!d || !d[0]) return null;
    if (new Date(d[0].expires_at) < new Date()) return null;
    console.log(`Cache HIT for ${cacheKey}`);
    return d[0].events;
  } catch (e) { return null; }
}

async function setCached(cacheKey, places) {
  try {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/event_cache`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
      },
      body: JSON.stringify({ cache_key: cacheKey, events: places, expires_at: expiresAt })
    });
  } catch (e) { console.log("Cache write failed:", e.message); }
}

async function fetchWithTimeout(promise, ms = 4500) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timeout")), ms)
  );
  return Promise.race([promise, timeout]);
}

function calcDistance(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function classifyPlace(title, types) {
  const typeList = Array.isArray(types) ? types : (types ? [types] : []);
  const typeStr = typeList.join(" ").toLowerCase();
  const titleStr = (title || "").toLowerCase();
  const t = `${titleStr} ${typeStr}`;

  // Prefer SerpAPI type / types when present (bar, night_club, etc.)
  const TYPE_MAP = [
    [["bar", "night club", "nightclub", "night_club", "cocktail bar", "wine bar", "sports bar", "pub", "lounge", "tavern", "dance club", "karaoke"], "Nightlife"],
    [["brewery", "beer garden"], "Brewery"],
    [["winery", "vineyard"], "Brewery"],
    [["museum", "art gallery", "art museum", "history museum"], "Arts"],
    [["movie theater", "movie theatre", "performing arts theater", "amphitheatre", "amphitheater"], "Arts"],
    [["park", "national park", "state park", "hiking area", "tourist attraction", "zoo", "aquarium", "campground"], "Outdoor"],
    [["bowling alley", "amusement center", "amusement park", "trampoline park", "arcade", "escape room"], "Kids"],
    [["gym", "sports complex", "golf course", "stadium", "athletic field"], "Sports"],
    [["restaurant", "cafe", "coffee shop", "bakery", "pizza restaurant"], "Food"],
    [["farmers market", "market"], "Market"],
    [["library", "community center", "city hall"], "Community"],
  ];
  for (const [keys, label] of TYPE_MAP) {
    if (typeList.some(tp => {
      const s = String(tp).toLowerCase().replace(/_/g, " ");
      return keys.some(k => s === k || s.includes(k));
    })) return label;
  }

  // Distributors / grocery / wholesale are NOT breweries (avoid "beer" grocery misclass)
  if (/beverage corporation|beverage co|distributor|wholesale|grocery|supermarket|liquor store|convenience store|bottling/.test(t)) {
    return "Food";
  }
  if (t.includes("escape") || t.includes("trampoline") || t.includes("arcade") || t.includes("bowling") || t.includes("mini golf") || t.includes("laser tag") || t.includes("go-kart") || t.includes("family entertainment") || t.includes("amusement") || t.includes("kids") || t.includes("children")) return "Kids";
  // Brewery only if title/type looks like a real brewery, not bare "beer"
  if (/\bbrewery\b|\bbrewing\b|\btaproom\b|\btap house\b|\bwinery\b|\bvineyard\b/.test(t)) return "Brewery";
  if (t.includes("museum") || t.includes("gallery") || t.includes("theater") || t.includes("theatre") || t.includes("exhibit")) return "Arts";
  if (t.includes("kayak") || t.includes("outdoor") || t.includes("adventure") || t.includes("park") || t.includes("trail") || t.includes("hike") || t.includes("nature") || t.includes("beach") || t.includes("zoo") || t.includes("aquarium")) return "Outdoor";
  if (t.includes("sport") || t.includes("gym") || t.includes("fitness") || t.includes("golf") || t.includes("climb")) return "Sports";
  // Pubs, lounges, taverns, bars -> Nightlife
  if (/\bbar\b|\bpub\b|\blounge\b|\btavern\b|nightclub|night club|nightlife|cocktail|happy hour|comedy club|\bdj\b/.test(t)) return "Nightlife";
  if (t.includes("restaurant") || t.includes("cafe") || t.includes("coffee") || t.includes("food") || t.includes("bakery") || t.includes("pizza") || t.includes("diner")) return "Food";
  if (t.includes("market") || t.includes("farmers")) return "Market";
  if (t.includes("community") || t.includes("library") || t.includes("center")) return "Community";
  return "Community";
}

function formatHours(p) {
  if (p.open_state) return p.open_state;
  if (typeof p.hours === "string") return p.hours;
  if (Array.isArray(p.hours)) {
    const today = p.hours.find(h => h && (h.includes("Open") || h.includes("Closed") || h.includes(":")));
    return today || p.hours[0] || "";
  }
  if (p.hours && typeof p.hours === "object") {
    const vals = Object.values(p.hours).filter(Boolean);
    return vals[0] || "";
  }
  return "";
}

function mapLocalResult(p, i, zip, queryHint) {
  const name = p.title || p.name || "Local place";
  const types = p.types || (p.type ? [p.type] : []);
  const type = classifyPlace(name, types.length ? types : (p.type ? [p.type] : queryHint));
  const lat = p.gps_coordinates?.latitude ?? p.gps_coordinates?.lat ?? null;
  const lng = p.gps_coordinates?.longitude ?? p.gps_coordinates?.lng ?? null;
  const address = p.address || "";
  const placeId = p.place_id || p.data_id || p.data_cid || `${name}_${i}`;
  return {
    id: "place_" + String(placeId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) + "_" + i,
    name,
    type,
    image: p.thumbnail || p.serpapi_thumbnail || null,
    address,
    location: address.split(",")[0] || name,
    description: p.description || (Array.isArray(types) ? types.join(" · ") : (p.type || "")),
    rating: p.rating != null ? p.rating : null,
    reviews: p.reviews != null ? p.reviews : null,
    price: p.price || null,
    hours: formatHours(p),
    url: p.website || p.website_link || (p.links && p.links.website) || p.link || "",
    phone: p.phone || "",
    lat,
    lng,
    source: "Google Places",
    kind: "place",
    // Frontend compatibility aliases
    cost: p.price || "See site",
    photo: p.thumbnail || p.serpapi_thumbnail || null,
    startDate: null,
    date: null,
    familyRating: p.rating != null ? Math.round(p.rating) : 4,
    who: ["all"],
  };
}

async function fetchMapsQuery(q, llParam, zip) {
  if (!SERP_KEY) return [];
  const params = new URLSearchParams({
    engine: "google_maps",
    type: "search",
    q,
    api_key: SERP_KEY,
    hl: "en",
  });
  if (llParam) params.set("ll", llParam);
  const r = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  const rows = d.local_results || d.place_results || [];
  const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);
  return list.slice(0, 12).map((p, i) => mapLocalResult(p, i, zip, q));
}


async function geocodeZip(zip) {
  if (!zip || String(zip).length !== 5) return null;
  try {
    const r = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!r.ok) return null;
    const d = await r.json();
    const p = d.places && d.places[0];
    if (p) return { lat: parseFloat(p.latitude), lng: parseFloat(p.longitude) };
  } catch (e) {}
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { zip, lat, lng, city, state } = req.query;
  const hasZip = zip && String(zip).length === 5;
  if (!hasZip && !(lat && lng)) {
    return res.status(400).json({ error: "A ZIP or coordinates are required" });
  }

  if (!SERP_KEY) {
    return res.status(200).json({
      places: [],
      errors: ["SERP_KEY missing — places unavailable"],
    });
  }

  let userLat = lat ? parseFloat(lat) : null;
  let userLng = lng ? parseFloat(lng) : null;
  let hasCoords = !!(userLat && userLng);

  if (!hasCoords && hasZip) {
    const geo = await geocodeZip(zip);
    if (geo && geo.lat && geo.lng) {
      userLat = geo.lat;
      userLng = geo.lng;
      hasCoords = true;
      console.log(`Places geocoded ZIP ${zip} -> ${userLat},${userLng}`);
    }
  }

  const passedCity = (city || "").trim();
  const prefix2 = hasZip ? String(zip).slice(0, 2) : "";
  const stateAbbr = ((state || "").trim().toUpperCase()) || ZIP_STATE_PREFIX[prefix2] || "";
  const stateFull = STATE_FULL_NAMES[stateAbbr] || stateAbbr;
  const cityName = (passedCity && passedCity.toLowerCase() !== "your area")
    ? passedCity
    : (passedCity || "your area");

  const locationLabel = (cityName !== "your area" && stateFull)
    ? `${cityName}, ${stateFull}`
    : (cityName !== "your area" ? cityName : (hasZip ? zip : "nearby"));

  const coordKey = hasCoords
    ? `_${Math.round(userLat * 10) / 10}_${Math.round(userLng * 10) / 10}`
    : "";
  const cacheKey = `places_v3_${zip || "coords"}${coordKey}`;
  const cached = await getCached(cacheKey);
  if (cached) {
    let places = Array.isArray(cached) ? cached : [];
    if (hasCoords) {
      places = places.filter(p => {
        if (!p.lat || !p.lng) return true;
        return calcDistance(userLat, userLng, parseFloat(p.lat), parseFloat(p.lng)) <= 120;
      });
    }
    return res.status(200).json({ places, errors: [], fromCache: true });
  }

  const llParam = hasCoords ? `@${userLat},${userLng},14z` : "";
  const near = `${locationLabel}${hasZip ? " " + zip : ""}`.trim();

  const queries = [
    `things to do near ${near}`,
    `escape room near ${near}`,
    `museum near ${near}`,
    `bowling alley OR mini golf near ${near}`,
    `trampoline park OR arcade near ${near}`,
    `kayak rental OR outdoor adventure near ${near}`,
    `brewery near ${near}`,
    `family entertainment near ${near}`,
    // Nightlife density — bars, clubs, live music for Tonight / date night
    `bars near ${near}`,
    `cocktail bars near ${near}`,
    `live music bars near ${near}`,
    `nightclubs near ${near}`,
    `dance clubs near ${near}`,
    `sports bars near ${near}`,
    `wine bars near ${near}`,
    `happy hour near ${near}`,
  ];

  const settled = await Promise.allSettled(
    queries.map(q => fetchWithTimeout(fetchMapsQuery(q, llParam, zip || ""), 4500))
  );

  const results = { places: [], errors: [] };
  settled.forEach((s, idx) => {
    if (s.status === "fulfilled") results.places.push(...s.value);
    else results.errors.push(`Maps "${queries[idx].split(" near")[0]}": ${s.reason?.message || "failed"}`);
  });

  // Dedupe by name+address (case-insensitive)
  const seen = new Set();
  results.places = results.places.filter(p => {
    const key = `${(p.name || "").toLowerCase()}|${(p.address || "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let maxDist = 75;
  if (hasCoords) {
    results.places = results.places.map(p => ({
      ...p,
      distanceMiles: p.lat && p.lng
        ? calcDistance(userLat, userLng, parseFloat(p.lat), parseFloat(p.lng))
        : null,
    })).filter(p => p.distanceMiles == null || p.distanceMiles <= maxDist);
  }

  // Sparse small-town expansion: broader queries + wider radius
  if (results.places.length < 20) {
    const broader = [
      `park near ${near}`,
      `museum near ${near}`,
      `attraction near ${near}`,
      `bowling near ${near}`,
      `movie theater near ${near}`,
      `winery near ${near}`,
      `things to do near ${near}`,
      `bars near ${near}`,
      `pubs near ${near}`,
      `live music near ${near}`,
    ];
    const llWide = hasCoords ? `@${userLat},${userLng},11z` : llParam;
    const more = await Promise.allSettled(
      broader.map(q => fetchWithTimeout(fetchMapsQuery(q, llWide, zip || ""), 4500))
    );
    more.forEach((s) => {
      if (s.status === "fulfilled") results.places.push(...s.value);
    });
    const seen2 = new Set();
    results.places = results.places.filter(p => {
      const key = `${(p.name || "").toLowerCase()}|${(p.address || "").toLowerCase()}`;
      if (seen2.has(key)) return false;
      seen2.add(key);
      return true;
    });
    maxDist = 120;
    if (hasCoords) {
      results.places = results.places.map(p => ({
        ...p,
        distanceMiles: p.lat && p.lng
          ? calcDistance(userLat, userLng, parseFloat(p.lat), parseFloat(p.lng))
          : null,
      })).filter(p => p.distanceMiles == null || p.distanceMiles <= maxDist);
    }
  }

  if (hasCoords) {
    results.places.sort((a, b) => {
      const ra = a.rating != null ? a.rating : -1;
      const rb = b.rating != null ? b.rating : -1;
      const da = a.distanceMiles ?? 999;
      const db = b.distanceMiles ?? 999;
      const band = d => (d < 10 ? 0 : d < 25 ? 1 : d < 50 ? 2 : 3);
      if (band(da) !== band(db)) return band(da) - band(db);
      if (rb !== ra) return rb - ra;
      return (b.reviews || 0) - (a.reviews || 0);
    });
  } else {
    results.places.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  if (results.places.length > 0) {
    await setCached(cacheKey, results.places);
  }
  return res.status(200).json(results);
}
