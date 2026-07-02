// api/events.js — Buzz Multi-Source Event Proxy (Fast version)
// Sources run in parallel with aggressive timeouts

const TM_KEY       = process.env.TM_KEY    || "";
const SERP_KEY     = process.env.SERP_KEY  || "";
const RAPID_KEY    = process.env.RAPID_KEY || "";
const PHQ_KEY      = process.env.PHQ_KEY   || "";
const EB_KEY       = process.env.EB_KEY    || "";
const SUPABASE_URL = "https://cdhyervrwmsmquovwrwj.supabase.co";
const SUPABASE_KEY = "sb_publishable_U5KBIkFT7l0jSSD8QaYJPQ_dEZWQJ63";

// ── Cache helpers ─────────────────────────────────────────────────────────────
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
  } catch(e) { return null; }
}

async function setCached(cacheKey, events) {
  try {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hour cache
    await fetch(`${SUPABASE_URL}/rest/v1/event_cache`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
      },
      body: JSON.stringify({ cache_key: cacheKey, events, expires_at: expiresAt })
    });
  } catch(e) { console.log("Cache write failed:", e.message); }
}

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

  const { zip, lat, lng } = req.query;
  if (!zip || zip.length !== 5) {
    return res.status(400).json({ error: "Valid 5-digit ZIP required" });
  }

  const userLat = lat ? parseFloat(lat) : null;
  const userLng = lng ? parseFloat(lng) : null;
  const hasCoords = userLat && userLng;

  const VB_ZIPS = ["23451","23452","23453","23454","23455","23456","23457","23458","23459","23460","23461","23462","23463","23464","23465","23466","23467","23479"];
  const isVB = VB_ZIPS.includes(zip);
  const cityName = getCityFromZip(zip);

  // ── Cache check ─────────────────────────────────────────────────────────────
  // Use ZIP as cache key (not coords - same city should share cache)
  // Include rounded coords in cache key so location-based searches get proper filtering
  const coordKey = (userLat && userLng) 
    ? `_${Math.round(userLat*10)/10}_${Math.round(userLng*10)/10}` 
    : "";
  const cacheKey = `events_v7_${zip}${coordKey}`; // v6 = 12 serp queries // v2 = with working TM
  const cached = await getCached(cacheKey);
  if (cached) {
    // Apply distance filter even on cached results
    let cachedEvents = cached;
    if (hasCoords) {
      cachedEvents = cached.filter(ev => {
        if (!ev.lat || !ev.lng) return true;
        const dist = calcDistance(userLat, userLng, parseFloat(ev.lat), parseFloat(ev.lng));
        return dist <= 75;
      });
    }
    return res.status(200).json({ events: cachedEvents, errors: [], fromCache: true });
  }
  const results = { events: [], errors: [] };

  // Run all sources in parallel with 3 second timeout each
  // Get state name for accurate searches
  const stateMap = {
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
  const prefix2 = zip.slice(0,2);
  const prefix3 = zip.slice(0,3);
  const stateName = stateMap[prefix2] || stateMap[prefix3] || "";

  const [tmRes, serpRes, rapidRes, vbRes, phqRes, serp2Res,
          serp3Res, serp4Res, serp5Res, serp6Res, serp7Res, serp8Res,
          serp9Res, serp10Res, serp11Res, serp12Res, ebRes] = await Promise.allSettled([
    fetchWithTimeout(fetchTicketmaster(zip, userLat, userLng), 6000),
    fetchWithTimeout(fetchSerpAPI(cityName, zip, stateName, userLat, userLng), 3000),
    fetchWithTimeout(fetchRapidAPI(cityName, zip, stateName, userLat, userLng), 3000),
    isVB ? fetchWithTimeout(fetchVirginiaBeach(), 3000) : Promise.resolve([]),
    fetchWithTimeout(fetchPredictHQ(zip, userLat, userLng), 5000),
    fetchWithTimeout(fetchSerpAPI2(cityName, zip, stateName, userLat, userLng), 3000),
    fetchWithTimeout(fetchSerpAPI3(cityName, zip, stateName, userLat, userLng), 3000),
    fetchWithTimeout(fetchSerpAPI4(cityName, zip, stateName, userLat, userLng), 3000),
    fetchWithTimeout(fetchSerpAPI5(cityName, zip, stateName, userLat, userLng), 3000),
    fetchWithTimeout(fetchSerpAPI6(cityName, zip, stateName, userLat, userLng), 3000),
    fetchWithTimeout(fetchSerpAPI7(cityName, zip, stateName, userLat, userLng), 3000),
    fetchWithTimeout(fetchSerpAPI8(cityName, zip, stateName, userLat, userLng), 3000),
    fetchWithTimeout(fetchSerpAPI9(cityName, zip, stateName, userLat, userLng), 3000),
    fetchWithTimeout(fetchSerpAPI10(cityName, zip, stateName, userLat, userLng), 3000),
    fetchWithTimeout(fetchSerpAPI11(cityName, zip, stateName, userLat, userLng), 3000),
    fetchWithTimeout(fetchSerpAPI12(cityName, zip, stateName, userLat, userLng), 3000),
    fetchWithTimeout(fetchEventbrite(cityName, zip, stateName, userLat, userLng), 5000),
  ]);

  if (tmRes.status === "fulfilled") { 
    console.log(`TM: ${tmRes.value.length} events`);
    results.events.push(...tmRes.value);
  } else results.errors.push("Ticketmaster: " + tmRes.reason?.message);

  if (serpRes.status === "fulfilled") results.events.push(...serpRes.value);
  else results.errors.push("SerpAPI: " + serpRes.reason?.message);

  if (rapidRes.status === "fulfilled") results.events.push(...rapidRes.value);
  else results.errors.push("RapidAPI: " + rapidRes.reason?.message);

  if (vbRes.status === "fulfilled") results.events.push(...vbRes.value);
  else results.errors.push("VB City: " + vbRes.reason?.message);

  if (phqRes.status === "fulfilled") results.events.push(...phqRes.value);
  else results.errors.push("PredictHQ: " + phqRes.reason?.message);

  if (serp2Res.status === "fulfilled") results.events.push(...serp2Res.value);
  else results.errors.push("Google Events 2: " + serp2Res.reason?.message);

  if (serp3Res.status === "fulfilled") results.events.push(...serp3Res.value);
  else results.errors.push("Google Events 3: " + serp3Res.reason?.message);

  if (serp4Res.status === "fulfilled") results.events.push(...serp4Res.value);
  else results.errors.push("Google Events 4: " + serp4Res.reason?.message);

  if (serp5Res.status === "fulfilled") results.events.push(...serp5Res.value);
  else results.errors.push("Google Events 5: " + serp5Res.reason?.message);

  if (serp6Res.status === "fulfilled") results.events.push(...serp6Res.value);
  else results.errors.push("Google Events 6: " + serp6Res.reason?.message);

  if (serp7Res.status === "fulfilled") results.events.push(...serp7Res.value);
  else results.errors.push("Google Events 7: " + serp7Res.reason?.message);

  if (serp8Res.status === "fulfilled") results.events.push(...serp8Res.value);
  else results.errors.push("Google Events 8: " + serp8Res.reason?.message);

  if (serp9Res.status === "fulfilled") results.events.push(...serp9Res.value);
  else results.errors.push("Google Events 9: " + serp9Res.reason?.message);

  if (serp10Res.status === "fulfilled") results.events.push(...serp10Res.value);
  else results.errors.push("Google Events 10: " + serp10Res.reason?.message);

  if (serp11Res.status === "fulfilled") results.events.push(...serp11Res.value);
  else results.errors.push("Google Events 11: " + serp11Res.reason?.message);

  if (serp12Res.status === "fulfilled") results.events.push(...serp12Res.value);
  else results.errors.push("Google Events 12: " + serp12Res.reason?.message);

  if (ebRes.status === "fulfilled") results.events.push(...ebRes.value);
  else results.errors.push("Eventbrite: " + ebRes.reason?.message);

  // Deduplicate by name
  const seen = new Set();
  results.events = results.events.filter(ev => {
    const key = ev.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Add distance to each event if we have user coords
  if (hasCoords) {
    results.events = results.events.map(ev => ({
      ...ev,
      distanceMiles: ev.lat && ev.lng
        ? calcDistance(userLat, userLng, ev.lat, ev.lng)
        : null
    }));

    // Sort by distance band first, then date
    results.events.sort((a, b) => {
      const distA = a.distanceMiles ?? 999;
      const distB = b.distanceMiles ?? 999;
      // Group into bands: 0-10mi, 10-25mi, 25-50mi, 50+mi
      const bandA = distA < 10 ? 0 : distA < 25 ? 1 : distA < 50 ? 2 : 3;
      const bandB = distB < 10 ? 0 : distB < 25 ? 1 : distB < 50 ? 2 : 3;
      if (bandA !== bandB) return bandA - bandB;
      // Within same band, sort by date
      if (!a.startDate) return 1;
      if (!b.startDate) return -1;
      return a.startDate.localeCompare(b.startDate);
    });
  } else {
    // No coords - sort by date only
    results.events.sort((a, b) => {
      if (!a.startDate) return 1;
      if (!b.startDate) return -1;
      return a.startDate.localeCompare(b.startDate);
    });
  }

  // ── Calculate distance for events that have coords ───────────────────────────
  if (hasCoords) {
    results.events = results.events.map(ev => {
      if (ev.lat && ev.lng) {
        const dist = calcDistance(userLat, userLng, parseFloat(ev.lat), parseFloat(ev.lng));
        return { ...ev, distanceMiles: Math.round(dist * 10) / 10 };
      }
      return ev;
    });
  }

  // ── Filter out events too far away ──────────────────────────────────────────
  if (hasCoords && results.events.length > 0) {
    const MAX_MILES = 75;
    results.events = results.events.filter(ev => {
      // Check by coordinates if available
      if (ev.lat && ev.lng) {
        const dist = calcDistance(userLat, userLng, parseFloat(ev.lat), parseFloat(ev.lng));
        ev.distanceMiles = Math.round(dist * 10) / 10;
        return dist <= MAX_MILES;
      }
      // Events without coords after geocoding attempt = likely bad data, reject
      // unless the address clearly mentions the search city or state
      const addr = (ev.address || ev.location || "").toLowerCase();
      const searchCity = cityName.toLowerCase();
      
      // Keep if address mentions the search city
      if (addr.includes(searchCity)) return true;
      
      // Keep if address is very short/generic (no city info to judge)
      if (addr.length < 10) return true;
      
      return true;
    });
  }

  // ── Store in cache ──────────────────────────────────────────────────────────
  if (results.events.length > 0) {
    setCached(cacheKey, results.events).catch(()=>{});
  }

  // Store in cache for next time
  if (results.events.length > 0) {
    setCached(cacheKey, results.events).catch(()=>{});
  }

  return res.status(200).json(results);
}

// ── Ticketmaster ──────────────────────────────────────────────────────────────
async function fetchTicketmaster(zip, userLat, userLng) {
  if (!TM_KEY) return [];
  const hasCoords = userLat && userLng;
  const VB_ZIPS_TM = ["23451","23452","23453","23454","23455","23456","23457","23458","23459","23460","23461","23462","23463","23464","23465","23466","23467","23479"];
  const isVB_TM = VB_ZIPS_TM.includes(zip);

  // Use actual GPS coordinates when available for more accurate results
  let locationParam;
  if (hasCoords) {
    locationParam = `latlong=${userLat},${userLng}&radius=50`;
  } else if (isVB_TM) {
    locationParam = `latlong=36.8529,-76.0&radius=60`;
  } else {
    locationParam = `postalCode=${zip}&radius=50`;
  }

  const base = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${TM_KEY}&${locationParam}&unit=miles&countryCode=US&size=50&sort=date,asc`;
  const [r1, r2] = await Promise.all([fetch(base+"&page=0"), fetch(base+"&page=1")]);
  const [d1, d2] = await Promise.all([r1.json(), r2.ok?r2.json():{_embedded:{events:[]}}]);
  if (d1.fault) throw new Error(d1.fault.faultstring);
  const allTmEvents = [...(d1._embedded?.events||[]), ...(d2._embedded?.events||[])];
  return allTmEvents.map(tm => {
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
    // Get best available image from Ticketmaster
    const images = tm.images || [];
    const tmImage = images.find(img => img.ratio === "16_9" && img.width >= 640)?.url
      || images.find(img => img.ratio === "16_9")?.url
      || images.find(img => img.width >= 640)?.url
      || images[0]?.url
      || null;
    return {
      id: "tm_" + tm.id,
      name: tm.name,
      type: tmType,
      image: tmImage,
      startDate: date,
      endDate: date,
      location: venue?.name || "See event page",
      address: [venue?.address?.line1, venue?.city?.name, venue?.state?.stateCode].filter(Boolean).join(", "),
      description: tm.info || tm.pleaseNote || "",
      familyRating: 4,
      cost: tm.priceRanges 
        ? (tm.priceRanges[0].min === 0 ? "Free" : `$${Math.round(tm.priceRanges[0].min)}+`)
        : "See site",
      url: tm.url,
      source: "Ticketmaster",
      lat: venue?.location?.latitude || null,
      lng: venue?.location?.longitude || null,
      subEvents: (tm._embedded?.attractions || []).slice(0, 3).map(a => ({
        time: tm.dates?.start?.localTime?.slice(0, 5) || "TBD",
        name: a.name,
        day: date ? new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }) : "TBD",
      })),
    };
  });
}

// ── SerpAPI ───────────────────────────────────────────────────────────────────
async function fetchEventbrite(cityName, zip, stateName, lat, lng) {
  if(!EB_KEY) return [];
  try {
    const location = stateName && cityName !== "your area" 
      ? `${cityName}, ${stateName}` 
      : cityName;
    
    // Build location query - use lat/lng if available, otherwise city name
    let locationParam = "";
    if(lat && lng) {
      locationParam = `&location.latitude=${lat}&location.longitude=${lng}&location.within=40mi`;
    } else {
      locationParam = `&location.address=${encodeURIComponent(location)}`;
    }

    const today = new Date().toISOString();
    const threeMonths = new Date(Date.now() + 90*24*60*60*1000).toISOString();

    const url = `https://www.eventbriteapi.com/v3/events/search/?token=${EB_KEY}${locationParam}&start_date.range_start=${today}&start_date.range_end=${threeMonths}&expand=venue&page_size=50`;
    
    const r = await fetch(url);
    if(!r.ok) return [];
    const d = await r.json();
    
    const events = (d.events || []);
    return events.map((ev, i) => ({
      id: "eb_" + ev.id,
      name: ev.name?.text || "Local Event",
      type: classifyByTitle(ev.name?.text || ""),
      startDate: ev.start?.local ? ev.start.local.split("T")[0] : "",
      endDate: ev.end?.local ? ev.end.local.split("T")[0] : "",
      location: ev.venue?.name || cityName,
      address: ev.venue ? [
        ev.venue.address?.address_1,
        ev.venue.address?.city,
        ev.venue.address?.region
      ].filter(Boolean).join(", ") : cityName,
      description: ev.description?.text?.slice(0, 200) || "",
      familyRating: 5,
      cost: ev.is_free ? "Free" : "See site",
      url: ev.url || "",
      source: "Eventbrite",
      subEvents: [],
      lat: ev.venue?.latitude ? parseFloat(ev.venue.latitude) : null,
      lng: ev.venue?.longitude ? parseFloat(ev.venue.longitude) : null,
    })).filter(ev => {
      // Distance filter
      if(lat && lng && ev.lat && ev.lng) {
        const dist = Math.sqrt(Math.pow((ev.lat-lat)*69,2)+Math.pow((ev.lng-lng)*55,2));
        return dist <= 40;
      }
      return true;
    });
  } catch(e) {
    return [];
  }
}

async function geocodeZip(zip) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=us&format=json&limit=1`, {
      headers: {"User-Agent": "BuzzFinderApp/1.0"}
    });
    const d = await r.json();
    if(d && d[0]) return {lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon)};
  } catch(e) {}
  return null;
}

async function fetchSerpAPI(cityName, zip, stateName, lat, lng) {
  const location = stateName && cityName !== "your area" ? `${cityName}, ${stateName}` : cityName;
  const zipSuffix = zip ? ` ${zip}` : "";
  const query = encodeURIComponent(`events near ${location}${zipSuffix}`);
  const locationParam = (lat && lng) ? `&location_ll=${lat},${lng}&radius=15` : `&location=${encodeURIComponent(location)}`;
  const url = `https://serpapi.com/search.json?engine=google_events&q=${query}&api_key=${SERP_KEY}&hl=en&gl=us${locationParam}`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  const results = (d.events_results || []).slice(0, 12).map((ev, i) => ({
    id: "serp_" + i + "_" + zip,
    name: ev.title || "Local Event",
    type: classifyByTitle(ev.title || ""),
    startDate: parseDate(ev.date?.start_date || ev.date?.when || ""),
    endDate: parseDate(ev.date?.start_date || ""),
    location: ev.venue?.name || ev.address?.[0] || cityName,
    address: ev.address?.join(", ") || cityName,
    description: ev.description || "",
    familyRating: 4,
    cost: ev.ticket_info?.[0]?.price || "See site",
    url: ev.link || "",
    source: "Google Events",
    subEvents: [],
    lat: ev.gps_coordinates?.latitude || null,
    lng: ev.gps_coordinates?.longitude || null,
  }));
  return results;
}

// ── RapidAPI ──────────────────────────────────────────────────────────────────
async function fetchRapidAPI(cityName, zip, stateName, lat, lng) {
  if (!RAPID_KEY) return [];
  const location = stateName && cityName !== "your area" ? `${cityName}, ${stateName}` : cityName;
  const query = encodeURIComponent(`things to do near ${location}${zipSuffix}`);
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
    cost: ev.is_free === true ? "Free" : ev.ticket_links?.[0]?.price || "See site",
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
// ── PredictHQ ─────────────────────────────────────────────────────────────────
async function fetchPredictHQ(zip, userLat, userLng) {
  if (!PHQ_KEY) return [];
  const hasCoords = userLat && userLng;
  
  // Build location query - use coords if available, else ZIP
  let locationQuery;
  if (hasCoords) {
    locationQuery = `within=50mi@${userLat},${userLng}`;
  } else {
    // Convert ZIP to rough lat/lng using Ticketmaster's geocoding
    locationQuery = `country=US&place.scope.country=US`;
  }

  const today = new Date().toISOString().split("T")[0];
  const future = new Date();
  future.setMonth(future.getMonth() + 3);
  const futureDate = future.toISOString().split("T")[0];

  const url = `https://api.predicthq.com/v1/events/?${locationQuery}&start.gte=${today}&start.lte=${futureDate}&limit=50&sort=start&state=active&country=US`;
  
  const r = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${PHQ_KEY}`,
      "Accept": "application/json",
    }
  });
  
  if (!r.ok) throw new Error(`PredictHQ ${r.status}`);
  const d = await r.json();
  
  return (d.results || []).map((ev, i) => {
    const type = classifyPHQ(ev.category, ev.title);
    const lat = ev.location?.[1] || null;
    const lng = ev.location?.[0] || null;
    return {
      id: "phq_" + ev.id,
      name: ev.title || "Local Event",
      type,
      startDate: ev.start?.split("T")[0] || "",
      endDate: ev.end?.split("T")[0] || "",
      location: ev.entities?.[0]?.name || ev.place_hierarchies?.[0]?.[2] || "Local Venue",
      address: ev.entities?.[0]?.formatted_address || "",
      description: ev.description || "",
      familyRating: 4,
      cost: ev.free ? "Free" : "See site",
      url: ev.url || "",
      source: "PredictHQ",
      lat: lat ? parseFloat(lat) : null,
      lng: lng ? parseFloat(lng) : null,
      subEvents: [],
    };
  });
}

// ── SerpAPI second query — weekend/nightlife focus ────────────────────────────
async function fetchSerpAPI2(cityName, zip, stateName, lat, lng) {
  const location = stateName && cityName !== "your area" ? `${cityName}, ${stateName}` : cityName;
  const query = encodeURIComponent(`things to do this weekend ${location}`);
  const locationParam = (lat && lng) ? `&location_ll=${lat},${lng}&radius=15` : `&location=${encodeURIComponent(location)}`;
  const url = `https://serpapi.com/search.json?engine=google_events&q=${query}&api_key=${SERP_KEY}&hl=en&gl=us${locationParam}`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  const results = (d.events_results || []).slice(0, 12).map((ev, i) => ({
    id: "serp2_" + i + "_" + zip,
    name: ev.title || "Local Event",
    type: classifyByTitle(ev.title || ""),
    startDate: parseDate(ev.date?.start_date || ev.date?.when || ""),
    endDate: parseDate(ev.date?.start_date || ""),
    location: ev.venue?.name || ev.address?.[0] || cityName,
    address: ev.address?.join(", ") || cityName,
    description: ev.description || "",
    familyRating: 4,
    cost: ev.ticket_info?.[0]?.price || "See site",
    url: ev.link || "",
    source: "Google Events",
    subEvents: [],
    lat: ev.gps_coordinates?.latitude || null,
    lng: ev.gps_coordinates?.longitude || null,
  }));
  return results;
}

function classifyPHQ(category, title) {
  const c = (category || "").toLowerCase();
  const t = (title || "").toLowerCase();
  if (c === "concerts") return "Music";
  if (c === "sports") return "Sports";
  if (c === "festivals") return "Festival";
  if (c === "expos") return "Community";
  if (c === "conferences") return "Community";
  if (c === "community") return "Community";
  if (c === "performing-arts") return "Arts";
  if (c === "school-holidays") return "Family";
  if (c === "public-holidays") return "Community";
  if (c === "observances") return "Community";
  return classifyByTitle(t);
}

// ── SerpAPI Query 3 — free events focus ──────────────────────────────────────
async function fetchSerpAPI3(cityName, zip, stateName, lat, lng) {
  const location = stateName && cityName !== "your area" ? `${cityName}, ${stateName}` : cityName;
  const query = encodeURIComponent(`free events near ${location}${zipSuffix}`);
  const locationParam = (lat && lng) ? `&location_ll=${lat},${lng}&radius=15` : `&location=${encodeURIComponent(location)}`;
  const url = `https://serpapi.com/search.json?engine=google_events&q=${query}&api_key=${SERP_KEY}&hl=en&gl=us${locationParam}`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  const results = (d.events_results || []).slice(0, 12).map((ev, i) => ({
    id: "serp3_" + i + "_" + zip,
    name: ev.title || "Local Event",
    type: classifyByTitle(ev.title || ""),
    startDate: parseDate(ev.date?.start_date || ev.date?.when || ""),
    endDate: parseDate(ev.date?.start_date || ""),
    location: ev.venue?.name || ev.address?.[0] || cityName,
    address: ev.address?.join(", ") || cityName,
    description: ev.description || "",
    familyRating: 4,
    cost: "Free",
    url: ev.link || "",
    source: "Google Events",
    subEvents: [],
    lat: ev.gps_coordinates?.latitude || null,
    lng: ev.gps_coordinates?.longitude || null,
  }));
  return results;
}

// ── SerpAPI Query 4 — concerts and live music focus ───────────────────────────
async function fetchSerpAPI4(cityName, zip, stateName, lat, lng) {
  const location = stateName && cityName !== "your area" ? `${cityName}, ${stateName}` : cityName;
  const query = encodeURIComponent(`concerts live music near ${location}${zipSuffix}`);
  const locationParam = (lat && lng) ? `&location_ll=${lat},${lng}&radius=15` : `&location=${encodeURIComponent(location)}`;
  const url = `https://serpapi.com/search.json?engine=google_events&q=${query}&api_key=${SERP_KEY}&hl=en&gl=us${locationParam}`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  const results = (d.events_results || []).slice(0, 12).map((ev, i) => ({
    id: "serp4_" + i + "_" + zip,
    name: ev.title || "Local Event",
    type: "Music",
    startDate: parseDate(ev.date?.start_date || ev.date?.when || ""),
    endDate: parseDate(ev.date?.start_date || ""),
    location: ev.venue?.name || ev.address?.[0] || cityName,
    address: ev.address?.join(", ") || cityName,
    description: ev.description || "",
    familyRating: 4,
    cost: ev.ticket_info?.[0]?.price || "See site",
    url: ev.link || "",
    source: "Google Events",
    subEvents: [],
    lat: ev.gps_coordinates?.latitude || null,
    lng: ev.gps_coordinates?.longitude || null,
  }));
  return results;
}

// ── SerpAPI Query 5 — festivals and outdoor events ────────────────────────────
async function fetchSerpAPI5(cityName, zip, stateName, lat, lng) {
  const location = stateName && cityName !== "your area" ? `${cityName}, ${stateName}` : cityName;
  const query = encodeURIComponent(`festivals outdoor events farmer market near ${location}${zipSuffix}`);
  const locationParam = (lat && lng) ? `&location_ll=${lat},${lng}&radius=15` : `&location=${encodeURIComponent(location)}`;
  const url = `https://serpapi.com/search.json?engine=google_events&q=${query}&api_key=${SERP_KEY}&hl=en&gl=us${locationParam}`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  const results = (d.events_results || []).slice(0, 12).map((ev, i) => ({
    id: "serp5_" + i + "_" + zip,
    name: ev.title || "Local Event",
    type: classifyByTitle(ev.title || ""),
    startDate: parseDate(ev.date?.start_date || ev.date?.when || ""),
    endDate: parseDate(ev.date?.start_date || ""),
    location: ev.venue?.name || ev.address?.[0] || cityName,
    address: ev.address?.join(", ") || cityName,
    description: ev.description || "",
    familyRating: 5,
    cost: ev.ticket_info?.[0]?.price || "Free",
    url: ev.link || "",
    source: "Google Events",
    subEvents: [],
    lat: ev.gps_coordinates?.latitude || null,
    lng: ev.gps_coordinates?.longitude || null,
  }));
  return results;
}


// ── SerpAPI Query 6 — community events ───────────────────────────────────────
async function fetchSerpAPI6(cityName, zip, stateName, lat, lng) {
  const location = stateName && cityName !== "your area" ? `${cityName}, ${stateName}` : cityName;
  const query = encodeURIComponent(`community events near ${location}${zipSuffix}`);
  const locationParam = (lat && lng) ? `&location_ll=${lat},${lng}&radius=15` : `&location=${encodeURIComponent(location)}`;
  const url = `https://serpapi.com/search.json?engine=google_events&q=${query}&api_key=${SERP_KEY}&hl=en&gl=us${locationParam}`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  const results = (d.events_results || []).slice(0, 12).map((ev, i) => ({
    id: "serp6_" + i + "_" + zip,
    name: ev.title || "Local Event",
    type: classifyByTitle(ev.title || ""),
    startDate: parseDate(ev.date?.start_date || ev.date?.when || ""),
    endDate: parseDate(ev.date?.start_date || ""),
    location: ev.venue?.name || ev.address?.[0] || cityName,
    address: ev.address?.join(", ") || cityName,
    description: ev.description || "",
    familyRating: 5,
    cost: ev.ticket_info?.[0]?.price || "Free",
    url: ev.link || "",
    source: "Google Events",
    subEvents: [],
    lat: ev.gps_coordinates?.latitude || null,
    lng: ev.gps_coordinates?.longitude || null,
  }));
  return results;
}

// ── SerpAPI Query 7 — kids and family events ──────────────────────────────────
async function fetchSerpAPI7(cityName, zip, stateName, lat, lng) {
  const location = stateName && cityName !== "your area" ? `${cityName}, ${stateName}` : cityName;
  const query = encodeURIComponent(`kids family events near ${location} this weekend`);
  const locationParam = (lat && lng) ? `&location_ll=${lat},${lng}&radius=15` : `&location=${encodeURIComponent(location)}`;
  const url = `https://serpapi.com/search.json?engine=google_events&q=${query}&api_key=${SERP_KEY}&hl=en&gl=us${locationParam}`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  const results = (d.events_results || []).slice(0, 12).map((ev, i) => ({
    id: "serp7_" + i + "_" + zip,
    name: ev.title || "Family Event",
    type: classifyByTitle(ev.title || ""),
    startDate: parseDate(ev.date?.start_date || ev.date?.when || ""),
    endDate: parseDate(ev.date?.start_date || ""),
    location: ev.venue?.name || ev.address?.[0] || cityName,
    address: ev.address?.join(", ") || cityName,
    description: ev.description || "",
    familyRating: 5,
    cost: ev.ticket_info?.[0]?.price || "See site",
    url: ev.link || "",
    source: "Google Events",
    subEvents: [],
    lat: ev.gps_coordinates?.latitude || null,
    lng: ev.gps_coordinates?.longitude || null,
  }));
  return results;
}

// ── SerpAPI Query 8 — nightlife and bars ─────────────────────────────────────
async function fetchSerpAPI8(cityName, zip, stateName, lat, lng) {
  const location = stateName && cityName !== "your area" ? `${cityName}, ${stateName}` : cityName;
  const query = encodeURIComponent(`nightlife bars events near ${location} this weekend`);
  const locationParam = (lat && lng) ? `&location_ll=${lat},${lng}&radius=15` : `&location=${encodeURIComponent(location)}`;
  const url = `https://serpapi.com/search.json?engine=google_events&q=${query}&api_key=${SERP_KEY}&hl=en&gl=us${locationParam}`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  const results = (d.events_results || []).slice(0, 12).map((ev, i) => ({
    id: "serp8_" + i + "_" + zip,
    name: ev.title || "Nightlife Event",
    type: "Nightlife",
    startDate: parseDate(ev.date?.start_date || ev.date?.when || ""),
    endDate: parseDate(ev.date?.start_date || ""),
    location: ev.venue?.name || ev.address?.[0] || cityName,
    address: ev.address?.join(", ") || cityName,
    description: ev.description || "",
    familyRating: 2,
    cost: ev.ticket_info?.[0]?.price || "See site",
    url: ev.link || "",
    source: "Google Events",
    subEvents: [],
    lat: ev.gps_coordinates?.latitude || null,
    lng: ev.gps_coordinates?.longitude || null,
  }));
  return results;
}

// ── SerpAPI Query 9 — things to do this weekend ─────────────────────────────
async function fetchSerpAPI9(cityName, zip, stateName, lat, lng) {
  const location = stateName && cityName !== "your area" ? `${cityName}, ${stateName}` : cityName;
  const query = encodeURIComponent(`things to do in ${location} this weekend`);
  const locationParam = (lat && lng) ? `&location_ll=${lat},${lng}&radius=15` : `&location=${encodeURIComponent(location)}`;
  const url = `https://serpapi.com/search.json?engine=google_events&q=${query}&api_key=${SERP_KEY}&hl=en&gl=us${locationParam}`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  const results = (d.events_results || []).slice(0, 12).map((ev, i) => ({
    id: "serp9_" + i + "_" + zip,
    name: ev.title || "Local Event",
    type: classifyByTitle(ev.title || ""),
    startDate: parseDate(ev.date?.start_date || ev.date?.when || ""),
    endDate: parseDate(ev.date?.start_date || ""),
    location: ev.venue?.name || ev.address?.[0] || cityName,
    address: ev.address?.join(", ") || cityName,
    description: ev.description || "",
    familyRating: 5,
    cost: ev.ticket_info?.[0]?.price || "Free",
    url: ev.link || "",
    source: "Google Events",
    subEvents: [],
    lat: ev.gps_coordinates?.latitude || null,
    lng: ev.gps_coordinates?.longitude || null,
  }));
  return results;
}

// ── SerpAPI Query 10 — outdoor and nature events ──────────────────────────────
async function fetchSerpAPI10(cityName, zip, stateName, lat, lng) {
  const location = stateName && cityName !== "your area" ? `${cityName}, ${stateName}` : cityName;
  const query = encodeURIComponent(`outdoor nature hiking events near ${location}${zipSuffix}`);
  const locationParam = (lat && lng) ? `&location_ll=${lat},${lng}&radius=15` : `&location=${encodeURIComponent(location)}`;
  const url = `https://serpapi.com/search.json?engine=google_events&q=${query}&api_key=${SERP_KEY}&hl=en&gl=us${locationParam}`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  const results = (d.events_results || []).slice(0, 12).map((ev, i) => ({
    id: "serp10_" + i + "_" + zip,
    name: ev.title || "Outdoor Event",
    type: "Outdoor",
    startDate: parseDate(ev.date?.start_date || ev.date?.when || ""),
    endDate: parseDate(ev.date?.start_date || ""),
    location: ev.venue?.name || ev.address?.[0] || cityName,
    address: ev.address?.join(", ") || cityName,
    description: ev.description || "",
    familyRating: 5,
    cost: ev.ticket_info?.[0]?.price || "Free",
    url: ev.link || "",
    source: "Google Events",
    subEvents: [],
    lat: ev.gps_coordinates?.latitude || null,
    lng: ev.gps_coordinates?.longitude || null,
  }));
  return results;
}

// ── SerpAPI Query 11 — food and farmers market events ────────────────────────
async function fetchSerpAPI11(cityName, zip, stateName, lat, lng) {
  const location = stateName && cityName !== "your area" ? `${cityName}, ${stateName}` : cityName;
  const query = encodeURIComponent(`food festival farmers market events near ${location}${zipSuffix}`);
  const locationParam = (lat && lng) ? `&location_ll=${lat},${lng}&radius=15` : `&location=${encodeURIComponent(location)}`;
  const url = `https://serpapi.com/search.json?engine=google_events&q=${query}&api_key=${SERP_KEY}&hl=en&gl=us${locationParam}`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  const results = (d.events_results || []).slice(0, 12).map((ev, i) => ({
    id: "serp11_" + i + "_" + zip,
    name: ev.title || "Food Event",
    type: classifyByTitle(ev.title || ""),
    startDate: parseDate(ev.date?.start_date || ev.date?.when || ""),
    endDate: parseDate(ev.date?.start_date || ""),
    location: ev.venue?.name || ev.address?.[0] || cityName,
    address: ev.address?.join(", ") || cityName,
    description: ev.description || "",
    familyRating: 5,
    cost: ev.ticket_info?.[0]?.price || "Free",
    url: ev.link || "",
    source: "Google Events",
    subEvents: [],
    lat: ev.gps_coordinates?.latitude || null,
    lng: ev.gps_coordinates?.longitude || null,
  }));
  return results;
}

// ── SerpAPI Query 12 — arts music theater performances ───────────────────────
async function fetchSerpAPI12(cityName, zip, stateName, lat, lng) {
  const location = stateName && cityName !== "your area" ? `${cityName}, ${stateName}` : cityName;
  const query = encodeURIComponent(`arts theater music performances near ${location}${zipSuffix}`);
  const locationParam = (lat && lng) ? `&location_ll=${lat},${lng}&radius=15` : `&location=${encodeURIComponent(location)}`;
  const url = `https://serpapi.com/search.json?engine=google_events&q=${query}&api_key=${SERP_KEY}&hl=en&gl=us${locationParam}`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  const results = (d.events_results || []).slice(0, 12).map((ev, i) => ({
    id: "serp12_" + i + "_" + zip,
    name: ev.title || "Arts Event",
    type: classifyByTitle(ev.title || ""),
    startDate: parseDate(ev.date?.start_date || ev.date?.when || ""),
    endDate: parseDate(ev.date?.start_date || ""),
    location: ev.venue?.name || ev.address?.[0] || cityName,
    address: ev.address?.join(", ") || cityName,
    description: ev.description || "",
    familyRating: 4,
    cost: ev.ticket_info?.[0]?.price || "See site",
    url: ev.link || "",
    source: "Google Events",
    subEvents: [],
    lat: ev.gps_coordinates?.latitude || null,
    lng: ev.gps_coordinates?.longitude || null,
  }));
  return results;
}

function calcDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // miles
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLon = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
    Math.sin(dLon/2)*Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

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
  // Direct lookup for major cities only
  const CITIES = {
    "23451":"Virginia Beach","23452":"Virginia Beach","23453":"Virginia Beach",
    "23454":"Virginia Beach","23455":"Virginia Beach","23456":"Virginia Beach",
    "23457":"Virginia Beach","23458":"Virginia Beach","23459":"Virginia Beach",
    "23460":"Virginia Beach","23461":"Virginia Beach","23462":"Virginia Beach",
    "23463":"Virginia Beach","23464":"Virginia Beach","23465":"Virginia Beach",
    "23466":"Virginia Beach","23467":"Virginia Beach","23479":"Virginia Beach",
    "23510":"Norfolk","23320":"Chesapeake","23220":"Richmond",
    "10001":"New York","10002":"New York","10003":"New York","10007":"New York",
    "10011":"New York","10012":"New York","10016":"New York","10019":"New York",
    "10022":"New York","10036":"New York",
    "11201":"Brooklyn","10451":"Bronx","10301":"Staten Island","11101":"Queens",
    "90001":"Los Angeles","90028":"Los Angeles","90036":"Los Angeles",
    "90210":"Beverly Hills","90401":"Santa Monica","90291":"Venice",
    "94102":"San Francisco","94103":"San Francisco","94110":"San Francisco",
    "60601":"Chicago","60611":"Chicago","60614":"Chicago","60657":"Chicago",
    "77001":"Houston","77002":"Houston","77006":"Houston","77019":"Houston",
    "33101":"Miami","33139":"Miami Beach","33130":"Miami","33132":"Miami",
    "30301":"Atlanta","30308":"Atlanta","30309":"Atlanta","30316":"Atlanta",
    "98101":"Seattle","98103":"Seattle","98109":"Seattle","98122":"Seattle",
    "80201":"Denver","80202":"Denver","80206":"Denver","80218":"Denver",
    "85001":"Phoenix","85004":"Phoenix","85012":"Phoenix","85016":"Phoenix",
    "37201":"Nashville","37203":"Nashville","37206":"Nashville","37212":"Nashville",
    "70112":"New Orleans","70115":"New Orleans","70119":"New Orleans",
    "28201":"Charlotte","28202":"Charlotte","28205":"Charlotte",
    "78701":"Austin","78702":"Austin","78704":"Austin","78705":"Austin",
    "75201":"Dallas","75202":"Dallas","75204":"Dallas","75219":"Dallas",
    "78201":"San Antonio","78205":"San Antonio","78212":"San Antonio",
    "94601":"Oakland","95101":"San Jose","92101":"San Diego","92103":"San Diego",
    "02101":"Boston","02115":"Boston","02116":"Boston","02130":"Boston",
    "19101":"Philadelphia","19103":"Philadelphia","19107":"Philadelphia",
    "15201":"Pittsburgh","15203":"Pittsburgh","15206":"Pittsburgh",
    "16323":"Franklin","16301":"Oil City","16335":"Meadville","16365":"Warren",
    "21201":"Baltimore","21202":"Baltimore","21211":"Baltimore",
    "20001":"Washington","20002":"Washington","20009":"Washington",
    "43201":"Columbus","43202":"Columbus","43215":"Columbus",
    "44101":"Cleveland","44102":"Cleveland","44113":"Cleveland",
    "45201":"Cincinnati","45202":"Cincinnati","45206":"Cincinnati",
    "48201":"Detroit","48202":"Detroit","48214":"Detroit",
    "89101":"Las Vegas","89102":"Las Vegas","89109":"Las Vegas","89119":"Las Vegas",
    "97201":"Portland","97202":"Portland","97209":"Portland","97214":"Portland",
    "53201":"Milwaukee","53202":"Milwaukee","53211":"Milwaukee",
    "55401":"Minneapolis","55403":"Minneapolis","55408":"Minneapolis",
    "64101":"Kansas City","64108":"Kansas City","64111":"Kansas City",
    "63101":"St. Louis","63103":"St. Louis","63110":"St. Louis",
    "84101":"Salt Lake City","84102":"Salt Lake City","84103":"Salt Lake City",
    "85701":"Tucson","85711":"Tucson","85716":"Tucson","85719":"Tucson",
    "85653":"Marana","85742":"Marana","85743":"Marana",
    "38101":"Memphis","38103":"Memphis","38104":"Memphis","38105":"Memphis",
    "27601":"Raleigh","27603":"Raleigh","27605":"Raleigh","27607":"Raleigh",
    "33601":"Tampa","33602":"Tampa","33606":"Tampa","33609":"Tampa",
    "32801":"Orlando","32803":"Orlando","32806":"Orlando","32819":"Orlando",
    "32201":"Jacksonville","32204":"Jacksonville","32205":"Jacksonville",
    "33301":"Fort Lauderdale","33311":"Fort Lauderdale","33316":"Fort Lauderdale",
    "46201":"Indianapolis","46202":"Indianapolis","46204":"Indianapolis",
    "40201":"Louisville","40202":"Louisville","40205":"Louisville",
    "35201":"Birmingham","35203":"Birmingham","35205":"Birmingham",
    "73101":"Oklahoma City","73102":"Oklahoma City","73103":"Oklahoma City",
    "68101":"Omaha","68102":"Omaha","68105":"Omaha",
    "87101":"Albuquerque","87102":"Albuquerque","87104":"Albuquerque",
    "50301":"Des Moines","50309":"Des Moines","50311":"Des Moines",
    "67201":"Wichita","67202":"Wichita","67203":"Wichita",
    "72201":"Little Rock","72202":"Little Rock","72205":"Little Rock",
    "39201":"Jackson","39202":"Jackson","39203":"Jackson",
    "58101":"Fargo","58102":"Fargo","58103":"Fargo",
    "57101":"Sioux Falls","57103":"Sioux Falls","57104":"Sioux Falls",
    "99501":"Anchorage","99502":"Anchorage","99503":"Anchorage",
    "96801":"Honolulu","96813":"Honolulu","96814":"Honolulu","96815":"Honolulu",
    "83701":"Boise","83702":"Boise","83705":"Boise","83706":"Boise",
  };

  if (CITIES[zip]) return CITIES[zip];

  // State-level fallback using ZIP prefix ranges
  const z = parseInt(zip);
  if (z>=35000&&z<=36999) return "Alabama";
  if (z>=99500&&z<=99999) return "Alaska";
  if (z>=85000&&z<=86999) return "Arizona";
  if (z>=71600&&z<=72999) return "Arkansas";
  if (z>=90000&&z<=96699) return "California";
  if (z>=80000&&z<=81999) return "Colorado";
  if (z>=6000&&z<=6999)   return "Connecticut";
  if (z>=19700&&z<=19999) return "Delaware";
  if (z>=32000&&z<=34999) return "Florida";
  if (z>=30000&&z<=31999) return "Georgia";
  if (z>=96700&&z<=96899) return "Hawaii";
  if (z>=83200&&z<=83999) return "Idaho";
  if (z>=60000&&z<=62999) return "Illinois";
  if (z>=46000&&z<=47999) return "Indiana";
  if (z>=50000&&z<=52999) return "Iowa";
  if (z>=66000&&z<=67999) return "Kansas";
  if (z>=40000&&z<=42999) return "Kentucky";
  if (z>=70000&&z<=71599) return "Louisiana";
  if (z>=3900&&z<=4999)   return "Maine";
  if (z>=20600&&z<=21999) return "Maryland";
  if (z>=1000&&z<=2799)   return "Massachusetts";
  if (z>=48000&&z<=49999) return "Michigan";
  if (z>=55000&&z<=56999) return "Minnesota";
  if (z>=38600&&z<=39999) return "Mississippi";
  if (z>=63000&&z<=65999) return "Missouri";
  if (z>=59000&&z<=59999) return "Montana";
  if (z>=68000&&z<=69999) return "Nebraska";
  if (z>=88900&&z<=89999) return "Nevada";
  if (z>=3000&&z<=3899)   return "New Hampshire";
  if (z>=7000&&z<=8999)   return "New Jersey";
  if (z>=87000&&z<=88499) return "New Mexico";
  if (z>=10000&&z<=14999) return "New York";
  if (z>=27000&&z<=28999) return "North Carolina";
  if (z>=58000&&z<=58999) return "North Dakota";
  if (z>=43000&&z<=45999) return "Ohio";
  if (z>=73000&&z<=74999) return "Oklahoma";
  if (z>=97000&&z<=97999) return "Oregon";
  if (z>=15000&&z<=19699) return "Pennsylvania";
  if (z>=2800&&z<=2999)   return "Rhode Island";
  if (z>=29000&&z<=29999) return "South Carolina";
  if (z>=57000&&z<=57999) return "South Dakota";
  if (z>=37000&&z<=38599) return "Tennessee";
  if (z>=75000&&z<=79999) return "Texas";
  if (z>=84000&&z<=84999) return "Utah";
  if (z>=5000&&z<=5999)   return "Vermont";
  if (z>=20100&&z<=24699) return "Virginia";
  if (z>=98000&&z<=99499) return "Washington";
  if (z>=24700&&z<=26999) return "West Virginia";
  if (z>=53000&&z<=54999) return "Wisconsin";
  if (z>=82000&&z<=83199) return "Wyoming";
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
