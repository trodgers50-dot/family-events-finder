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
  const results = { events: [], errors: [] };

  // Run all sources in parallel with 3 second timeout each
  // Get state name for accurate searches
  const stateMap = {
    "23":"VA","10":"NY","11":"NY","90":"CA","94":"CA","92":"CA","60":"IL",
    "77":"TX","75":"TX","78":"TX","76":"TX","33":"FL","32":"FL","30":"GA",
    "98":"WA","80":"CO","85":"AZ","37":"TN","38":"TN","70":"LA","28":"NC",
    "27":"NC","15":"PA","16":"PA","19":"PA","02":"MA","21":"MD","20":"DC",
    "43":"OH","44":"OH","45":"OH","48":"MI","89":"NV","97":"OR","53":"WI",
    "55":"MN","64":"MO","63":"MO","46":"IN","40":"KY","29":"SC","35":"AL",
    "73":"OK","74":"OK","68":"NE","84":"UT","87":"NM","96":"HI","99":"AK",
    "83":"ID","59":"MT","82":"WY","58":"ND","57":"SD","50":"IA","66":"KS",
    "72":"AR","39":"MS","24":"WV","05":"VT","03":"NH","04":"ME","06":"CT",
    "02":"RI","07":"NJ","08":"NJ","19":"DE","54":"WI","56":"MN","65":"MO"
  };
  const prefix2 = zip.slice(0,2);
  const prefix3 = zip.slice(0,3);
  const stateName = stateMap[prefix2] || stateMap[prefix3] || "";

  const [tmRes, serpRes, rapidRes, vbRes, phqRes, serp2Res] = await Promise.allSettled([
    fetchWithTimeout(fetchTicketmaster(zip, userLat, userLng), 3000),
    fetchWithTimeout(fetchSerpAPI(cityName, zip, stateName, userLat, userLng), 3000),
    fetchWithTimeout(fetchRapidAPI(cityName, zip, stateName, userLat, userLng), 3000),
    isVB ? fetchWithTimeout(fetchVirginiaBeach(), 3000) : Promise.resolve([]),
    fetchWithTimeout(fetchPredictHQ(zip, userLat, userLng), 4000),
    fetchWithTimeout(fetchSerpAPI2(cityName, zip, stateName, userLat, userLng), 3000),
  ]);

  if (tmRes.status === "fulfilled") results.events.push(...tmRes.value);
  else results.errors.push("Ticketmaster: " + tmRes.reason?.message);

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

  return res.status(200).json(results);
}

// ── Ticketmaster ──────────────────────────────────────────────────────────────
async function fetchTicketmaster(zip, userLat, userLng) {
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

  const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${TM_KEY}&${locationParam}&unit=miles&countryCode=US&size=25&sort=date,asc`;
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
      subEvents: (tm._embedded?.attractions || []).slice(0, 3).map(a => ({
        time: tm.dates?.start?.localTime?.slice(0, 5) || "TBD",
        name: a.name,
        day: date ? new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }) : "TBD",
      })),
    };
  });
}

// ── SerpAPI ───────────────────────────────────────────────────────────────────
async function fetchSerpAPI(cityName, zip, stateName, lat, lng) {
  const location = stateName && cityName !== "your area" ? `${cityName}, ${stateName}` : cityName;
  const query = encodeURIComponent(`events near ${location} this month`);
  // Use GPS coordinates for more precise local results
  const locationParam = (lat && lng) ? `&location_ll=${lat},${lng}&radius=50` : "";
  const url = `https://serpapi.com/search.json?engine=google_events&q=${query}&api_key=${SERP_KEY}&hl=en&gl=us${locationParam}`;
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
    cost: ev.ticket_info?.[0]?.price || "See site",
    url: ev.link || "",
    source: "Google Events",
    subEvents: [],
  }));
}

// ── RapidAPI ──────────────────────────────────────────────────────────────────
async function fetchRapidAPI(cityName, zip, stateName, lat, lng) {
  const location = stateName && cityName !== "your area" ? `${cityName}, ${stateName}` : cityName;
  const query = encodeURIComponent(`things to do near ${location}`);
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
  const locationParam = (lat && lng) ? `&location_ll=${lat},${lng}&radius=50` : "";
  const url = `https://serpapi.com/search.json?engine=google_events&q=${query}&api_key=${SERP_KEY}&hl=en&gl=us${locationParam}`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return (d.events_results || []).slice(0, 10).map((ev, i) => ({
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
  }));
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
  // Direct ZIP lookup for accuracy
  const ZIP_CITY = {
    // Virginia
    "23451":"Virginia Beach","23452":"Virginia Beach","23453":"Virginia Beach",
    "23454":"Virginia Beach","23455":"Virginia Beach","23456":"Virginia Beach",
    "23457":"Virginia Beach","23458":"Virginia Beach","23459":"Virginia Beach",
    "23460":"Virginia Beach","23461":"Virginia Beach","23462":"Virginia Beach",
    "23463":"Virginia Beach","23464":"Virginia Beach","23465":"Virginia Beach",
    "23466":"Virginia Beach","23467":"Virginia Beach","23479":"Virginia Beach",
    "23510":"Norfolk","23511":"Norfolk","23513":"Norfolk","23517":"Norfolk",
    "23320":"Chesapeake","23321":"Chesapeake","23322":"Chesapeake","23323":"Chesapeake",
    "23220":"Richmond","23221":"Richmond","23222":"Richmond","23223":"Richmond",
    "23224":"Richmond","23225":"Richmond","23226":"Richmond","23227":"Richmond",
    // New York
    "10001":"New York","10002":"New York","10003":"New York","10004":"New York",
    "10005":"New York","10006":"New York","10007":"New York","10009":"New York",
    "10010":"New York","10011":"New York","10012":"New York","10013":"New York",
    "10014":"New York","10016":"New York","10017":"New York","10018":"New York",
    "10019":"New York","10020":"New York","10021":"New York","10022":"New York",
    "10023":"New York","10024":"New York","10025":"New York","10026":"New York",
    "10027":"New York","10028":"New York","10029":"New York","10030":"New York",
    "10031":"New York","10032":"New York","10033":"New York","10034":"New York",
    "10035":"New York","10036":"New York","10037":"New York","10038":"New York",
    "10039":"New York","10040":"New York","11201":"Brooklyn","11205":"Brooklyn",
    "11206":"Brooklyn","11207":"Brooklyn","11208":"Brooklyn","11209":"Brooklyn",
    "11210":"Brooklyn","11211":"Brooklyn","11213":"Brooklyn","11215":"Brooklyn",
    "11216":"Brooklyn","11217":"Brooklyn","11218":"Brooklyn","11219":"Brooklyn",
    "11220":"Brooklyn","11221":"Brooklyn","11222":"Brooklyn","11223":"Brooklyn",
    "11224":"Brooklyn","11225":"Brooklyn","11226":"Brooklyn","11228":"Brooklyn",
    "11229":"Brooklyn","11230":"Brooklyn","11231":"Brooklyn","11232":"Brooklyn",
    "11233":"Brooklyn","11234":"Brooklyn","11235":"Brooklyn","11236":"Brooklyn",
    "11237":"Brooklyn","11238":"Brooklyn","11239":"Brooklyn",
    "10451":"Bronx","10452":"Bronx","10453":"Bronx","10454":"Bronx","10455":"Bronx",
    "10456":"Bronx","10457":"Bronx","10458":"Bronx","10459":"Bronx","10460":"Bronx",
    "10461":"Bronx","10462":"Bronx","10463":"Bronx","10464":"Bronx","10465":"Bronx",
    "10466":"Bronx","10467":"Bronx","10468":"Bronx","10469":"Bronx","10470":"Bronx",
    "10471":"Bronx","10472":"Bronx","10473":"Bronx","10474":"Bronx","10475":"Bronx",
    "10301":"Staten Island","10302":"Staten Island","10303":"Staten Island",
    "10304":"Staten Island","10305":"Staten Island","10306":"Staten Island",
    "10307":"Staten Island","10308":"Staten Island","10309":"Staten Island",
    "10310":"Staten Island","10311":"Staten Island","10312":"Staten Island",
    "10314":"Staten Island",
    "11101":"Queens","11102":"Queens","11103":"Queens","11104":"Queens",
    "11105":"Queens","11106":"Queens","11354":"Queens","11355":"Queens",
    "11356":"Queens","11357":"Queens","11358":"Queens","11359":"Queens",
    "11360":"Queens","11361":"Queens","11362":"Queens","11363":"Queens",
    "11364":"Queens","11365":"Queens","11366":"Queens","11367":"Queens",
    "11368":"Queens","11369":"Queens","11370":"Queens","11371":"Queens",
    "11372":"Queens","11373":"Queens","11374":"Queens","11375":"Queens",
    "11377":"Queens","11378":"Queens","11379":"Queens","11385":"Queens",
    "11411":"Queens","11412":"Queens","11413":"Queens","11414":"Queens",
    "11415":"Queens","11416":"Queens","11417":"Queens","11418":"Queens",
    "11419":"Queens","11420":"Queens","11421":"Queens","11422":"Queens",
    "11423":"Queens","11426":"Queens","11427":"Queens","11428":"Queens",
    "11429":"Queens","11432":"Queens","11433":"Queens","11434":"Queens",
    "11435":"Queens","11436":"Queens","11691":"Queens","11692":"Queens",
    "11693":"Queens","11694":"Queens","11695":"Queens","11697":"Queens",
    // Los Angeles
    "90001":"Los Angeles","90002":"Los Angeles","90003":"Los Angeles",
    "90004":"Los Angeles","90005":"Los Angeles","90006":"Los Angeles",
    "90007":"Los Angeles","90008":"Los Angeles","90010":"Los Angeles",
    "90011":"Los Angeles","90012":"Los Angeles","90013":"Los Angeles",
    "90014":"Los Angeles","90015":"Los Angeles","90016":"Los Angeles",
    "90017":"Los Angeles","90018":"Los Angeles","90019":"Los Angeles",
    "90020":"Los Angeles","90021":"Los Angeles","90022":"Los Angeles",
    "90023":"Los Angeles","90024":"Los Angeles","90025":"Los Angeles",
    "90026":"Los Angeles","90027":"Los Angeles","90028":"Los Angeles",
    "90029":"Los Angeles","90031":"Los Angeles","90032":"Los Angeles",
    "90033":"Los Angeles","90034":"Los Angeles","90035":"Los Angeles",
    "90036":"Los Angeles","90037":"Los Angeles","90038":"Los Angeles",
    "90039":"Los Angeles","90041":"Los Angeles","90042":"Los Angeles",
    "90043":"Los Angeles","90044":"Los Angeles","90045":"Los Angeles",
    "90046":"Los Angeles","90047":"Los Angeles","90048":"Los Angeles",
    "90049":"Los Angeles","90056":"Los Angeles","90057":"Los Angeles",
    "90058":"Los Angeles","90059":"Los Angeles","90061":"Los Angeles",
    "90062":"Los Angeles","90063":"Los Angeles","90064":"Los Angeles",
    "90065":"Los Angeles","90066":"Los Angeles","90067":"Los Angeles",
    "90068":"Los Angeles","90069":"Los Angeles","90071":"Los Angeles",
    "90077":"Los Angeles","90089":"Los Angeles","90094":"Los Angeles",
    "90095":"Los Angeles","90210":"Beverly Hills","90211":"Beverly Hills",
    "90212":"Beverly Hills","90230":"Culver City","90232":"Culver City",
    "90291":"Venice","90292":"Marina del Rey","90402":"Santa Monica",
    "90403":"Santa Monica","90404":"Santa Monica","90405":"Santa Monica",
    // Chicago
    "60601":"Chicago","60602":"Chicago","60603":"Chicago","60604":"Chicago",
    "60605":"Chicago","60606":"Chicago","60607":"Chicago","60608":"Chicago",
    "60609":"Chicago","60610":"Chicago","60611":"Chicago","60612":"Chicago",
    "60613":"Chicago","60614":"Chicago","60615":"Chicago","60616":"Chicago",
    "60617":"Chicago","60618":"Chicago","60619":"Chicago","60620":"Chicago",
    "60621":"Chicago","60622":"Chicago","60623":"Chicago","60624":"Chicago",
    "60625":"Chicago","60626":"Chicago","60628":"Chicago","60629":"Chicago",
    "60630":"Chicago","60631":"Chicago","60632":"Chicago","60633":"Chicago",
    "60634":"Chicago","60636":"Chicago","60637":"Chicago","60638":"Chicago",
    "60639":"Chicago","60640":"Chicago","60641":"Chicago","60642":"Chicago",
    "60643":"Chicago","60644":"Chicago","60645":"Chicago","60646":"Chicago",
    "60647":"Chicago","60649":"Chicago","60651":"Chicago","60652":"Chicago",
    "60653":"Chicago","60654":"Chicago","60655":"Chicago","60656":"Chicago",
    "60657":"Chicago","60659":"Chicago","60660":"Chicago","60661":"Chicago",
    // Houston
    "77001":"Houston","77002":"Houston","77003":"Houston","77004":"Houston",
    "77005":"Houston","77006":"Houston","77007":"Houston","77008":"Houston",
    "77009":"Houston","77010":"Houston","77011":"Houston","77012":"Houston",
    "77013":"Houston","77014":"Houston","77015":"Houston","77016":"Houston",
    "77017":"Houston","77018":"Houston","77019":"Houston","77020":"Houston",
    "77021":"Houston","77022":"Houston","77023":"Houston","77024":"Houston",
    "77025":"Houston","77026":"Houston","77027":"Houston","77028":"Houston",
    "77029":"Houston","77030":"Houston","77031":"Houston","77032":"Houston",
    "77033":"Houston","77034":"Houston","77035":"Houston","77036":"Houston",
    "77037":"Houston","77038":"Houston","77039":"Houston","77040":"Houston",
    "77041":"Houston","77042":"Houston","77043":"Houston","77044":"Houston",
    "77045":"Houston","77046":"Houston","77047":"Houston","77048":"Houston",
    "77049":"Houston","77050":"Houston","77051":"Houston","77053":"Houston",
    "77054":"Houston","77055":"Houston","77056":"Houston","77057":"Houston",
    "77058":"Houston","77059":"Houston","77060":"Houston","77061":"Houston",
    "77062":"Houston","77063":"Houston","77064":"Houston","77065":"Houston",
    "77066":"Houston","77067":"Houston","77068":"Houston","77069":"Houston",
    "77070":"Houston","77071":"Houston","77072":"Houston","77073":"Houston",
    "77074":"Houston","77075":"Houston","77076":"Houston","77077":"Houston",
    "77078":"Houston","77079":"Houston","77080":"Houston","77081":"Houston",
    "77082":"Houston","77083":"Houston","77084":"Houston","77085":"Houston",
    "77086":"Houston","77087":"Houston","77088":"Houston","77089":"Houston",
    "77090":"Houston","77091":"Houston","77092":"Houston","77093":"Houston",
    "77094":"Houston","77095":"Houston","77096":"Houston","77098":"Houston",
    "77099":"Houston",
    // Miami
    "33101":"Miami","33109":"Miami Beach","33119":"Miami Beach",
    "33125":"Miami","33126":"Miami","33127":"Miami","33128":"Miami",
    "33129":"Miami","33130":"Miami","33131":"Miami","33132":"Miami",
    "33133":"Miami","33134":"Coral Gables","33135":"Miami","33136":"Miami",
    "33137":"Miami","33138":"Miami","33139":"Miami Beach","33140":"Miami Beach",
    "33141":"Miami Beach","33142":"Miami","33143":"Miami","33144":"Miami",
    "33145":"Miami","33146":"Miami","33147":"Miami","33149":"Key Biscayne",
    "33150":"Miami","33154":"Bal Harbour","33155":"Miami","33156":"Miami",
    "33157":"Miami","33158":"Miami","33160":"North Miami Beach",
    "33161":"North Miami","33162":"North Miami Beach","33163":"Miami",
    "33165":"Miami","33166":"Miami","33167":"Miami","33168":"Miami",
    "33169":"Miami","33170":"Miami","33172":"Miami","33173":"Miami",
    "33174":"Miami","33175":"Miami","33176":"Miami","33177":"Miami",
    "33178":"Miami","33179":"North Miami Beach","33180":"Aventura",
    "33181":"North Miami Beach","33182":"Miami","33183":"Miami",
    "33184":"Miami","33185":"Miami","33186":"Miami","33187":"Miami",
    "33189":"Miami","33190":"Miami","33193":"Miami","33194":"Miami",
    "33196":"Miami",
    // Atlanta
    "30301":"Atlanta","30302":"Atlanta","30303":"Atlanta","30304":"Atlanta",
    "30305":"Atlanta","30306":"Atlanta","30307":"Atlanta","30308":"Atlanta",
    "30309":"Atlanta","30310":"Atlanta","30311":"Atlanta","30312":"Atlanta",
    "30313":"Atlanta","30314":"Atlanta","30315":"Atlanta","30316":"Atlanta",
    "30317":"Atlanta","30318":"Atlanta","30319":"Atlanta","30320":"Atlanta",
    "30321":"Atlanta","30322":"Atlanta","30324":"Atlanta","30325":"Atlanta",
    "30326":"Atlanta","30327":"Atlanta","30328":"Atlanta","30329":"Atlanta",
    "30331":"Atlanta","30332":"Atlanta","30333":"Atlanta","30334":"Atlanta",
    "30336":"Atlanta","30337":"Atlanta","30338":"Atlanta","30339":"Atlanta",
    "30340":"Atlanta","30341":"Atlanta","30342":"Atlanta","30343":"Atlanta",
    "30344":"Atlanta","30345":"Atlanta","30346":"Atlanta","30349":"Atlanta",
    "30350":"Atlanta","30354":"Atlanta","30355":"Atlanta","30356":"Atlanta",
    "30357":"Atlanta","30358":"Atlanta","30359":"Atlanta","30360":"Atlanta",
    "30361":"Atlanta","30362":"Atlanta","30363":"Atlanta","30364":"Atlanta",
    "30366":"Atlanta","30368":"Atlanta","30369":"Atlanta","30370":"Atlanta",
    "30371":"Atlanta","30374":"Atlanta","30375":"Atlanta","30376":"Atlanta",
    "30377":"Atlanta","30378":"Atlanta","30379":"Atlanta","30380":"Atlanta",
    "30381":"Atlanta","30384":"Atlanta","30385":"Atlanta","30386":"Atlanta",
    "30387":"Atlanta","30388":"Atlanta","30389":"Atlanta","30390":"Atlanta",
    "30392":"Atlanta","30394":"Atlanta","30395":"Atlanta","30396":"Atlanta",
    "30398":"Atlanta",
    // Seattle
    "98101":"Seattle","98102":"Seattle","98103":"Seattle","98104":"Seattle",
    "98105":"Seattle","98106":"Seattle","98107":"Seattle","98108":"Seattle",
    "98109":"Seattle","98110":"Seattle","98112":"Seattle","98115":"Seattle",
    "98116":"Seattle","98117":"Seattle","98118":"Seattle","98119":"Seattle",
    "98121":"Seattle","98122":"Seattle","98125":"Seattle","98126":"Seattle",
    "98133":"Seattle","98134":"Seattle","98136":"Seattle","98144":"Seattle",
    "98146":"Seattle","98148":"Seattle","98154":"Seattle","98155":"Seattle",
    "98158":"Seattle","98161":"Seattle","98164":"Seattle","98166":"Seattle",
    "98168":"Seattle","98174":"Seattle","98177":"Seattle","98178":"Seattle",
    "98188":"Seattle","98195":"Seattle","98199":"Seattle",
    // Denver
    "80201":"Denver","80202":"Denver","80203":"Denver","80204":"Denver",
    "80205":"Denver","80206":"Denver","80207":"Denver","80208":"Denver",
    "80209":"Denver","80210":"Denver","80211":"Denver","80212":"Denver",
    "80214":"Denver","80215":"Denver","80216":"Denver","80217":"Denver",
    "80218":"Denver","80219":"Denver","80220":"Denver","80221":"Denver",
    "80222":"Denver","80223":"Denver","80224":"Denver","80225":"Denver",
    "80226":"Denver","80227":"Denver","80228":"Denver","80229":"Denver",
    "80230":"Denver","80231":"Denver","80232":"Denver","80233":"Denver",
    "80234":"Denver","80235":"Denver","80236":"Denver","80237":"Denver",
    "80238":"Denver","80239":"Denver","80241":"Denver","80243":"Denver",
    "80244":"Denver","80246":"Denver","80247":"Denver","80248":"Denver",
    "80249":"Denver","80250":"Denver","80251":"Denver","80252":"Denver",
    "80256":"Denver","80257":"Denver","80259":"Denver","80260":"Denver",
    "80261":"Denver","80262":"Denver","80263":"Denver","80264":"Denver",
    "80265":"Denver","80266":"Denver","80271":"Denver","80273":"Denver",
    "80274":"Denver","80281":"Denver","80290":"Denver","80291":"Denver",
    "80293":"Denver","80294":"Denver","80295":"Denver","80299":"Denver",
    // Phoenix
    "85001":"Phoenix","85002":"Phoenix","85003":"Phoenix","85004":"Phoenix",
    "85005":"Phoenix","85006":"Phoenix","85007":"Phoenix","85008":"Phoenix",
    "85009":"Phoenix","85010":"Phoenix","85011":"Phoenix","85012":"Phoenix",
    "85013":"Phoenix","85014":"Phoenix","85015":"Phoenix","85016":"Phoenix",
    "85017":"Phoenix","85018":"Phoenix","85019":"Phoenix","85020":"Phoenix",
    "85021":"Phoenix","85022":"Phoenix","85023":"Phoenix","85024":"Phoenix",
    "85025":"Phoenix","85026":"Phoenix","85027":"Phoenix","85028":"Phoenix",
    "85029":"Phoenix","85030":"Phoenix","85031":"Phoenix","85032":"Phoenix",
    "85033":"Phoenix","85034":"Phoenix","85035":"Phoenix","85036":"Phoenix",
    "85037":"Phoenix","85038":"Phoenix","85039":"Phoenix","85040":"Phoenix",
    "85041":"Phoenix","85042":"Phoenix","85043":"Phoenix","85044":"Phoenix",
    "85045":"Phoenix","85048":"Phoenix","85050":"Phoenix","85051":"Phoenix",
    "85053":"Phoenix","85054":"Phoenix","85060":"Phoenix","85061":"Phoenix",
    "85062":"Phoenix","85063":"Phoenix","85064":"Phoenix","85065":"Phoenix",
    "85066":"Phoenix","85067":"Phoenix","85068":"Phoenix","85069":"Phoenix",
    "85070":"Phoenix","85071":"Phoenix","85072":"Phoenix","85073":"Phoenix",
    "85074":"Phoenix","85075":"Phoenix","85076":"Phoenix","85078":"Phoenix",
    "85079":"Phoenix","85080":"Phoenix","85082":"Phoenix","85083":"Phoenix",
    "85085":"Phoenix","85086":"Phoenix","85087":"Phoenix",
    // Nashville
    "37201":"Nashville","37202":"Nashville","37203":"Nashville","37204":"Nashville",
    "37205":"Nashville","37206":"Nashville","37207":"Nashville","37208":"Nashville",
    "37209":"Nashville","37210":"Nashville","37211":"Nashville","37212":"Nashville",
    "37213":"Nashville","37214":"Nashville","37215":"Nashville","37216":"Nashville",
    "37217":"Nashville","37218":"Nashville","37219":"Nashville","37220":"Nashville",
    "37221":"Nashville","37222":"Nashville","37224":"Nashville","37227":"Nashville",
    "37228":"Nashville","37229":"Nashville","37232":"Nashville","37234":"Nashville",
    "37235":"Nashville","37236":"Nashville","37238":"Nashville","37240":"Nashville",
    "37241":"Nashville","37242":"Nashville","37243":"Nashville","37244":"Nashville",
    "37246":"Nashville","37247":"Nashville","37248":"Nashville","37249":"Nashville",
    // New Orleans
    "70112":"New Orleans","70113":"New Orleans","70114":"New Orleans",
    "70115":"New Orleans","70116":"New Orleans","70117":"New Orleans",
    "70118":"New Orleans","70119":"New Orleans","70121":"New Orleans",
    "70122":"New Orleans","70123":"New Orleans","70124":"New Orleans",
    "70125":"New Orleans","70126":"New Orleans","70127":"New Orleans",
    "70128":"New Orleans","70129":"New Orleans","70130":"New Orleans",
    "70131":"New Orleans","70139":"New Orleans","70140":"New Orleans",
    "70141":"New Orleans","70142":"New Orleans","70143":"New Orleans",
    "70145":"New Orleans","70146":"New Orleans","70148":"New Orleans",
    "70150":"New Orleans","70151":"New Orleans","70152":"New Orleans",
    "70153":"New Orleans","70154":"New Orleans","70156":"New Orleans",
    "70157":"New Orleans","70158":"New Orleans","70159":"New Orleans",
    "70160":"New Orleans","70161":"New Orleans","70162":"New Orleans",
    "70163":"New Orleans","70164":"New Orleans","70165":"New Orleans",
    "70166":"New Orleans","70167":"New Orleans","70170":"New Orleans",
    "70172":"New Orleans","70174":"New Orleans","70175":"New Orleans",
    "70176":"New Orleans","70177":"New Orleans","70178":"New Orleans",
    "70179":"New Orleans","70181":"New Orleans","70182":"New Orleans",
    "70183":"New Orleans","70184":"New Orleans","70185":"New Orleans",
    "70186":"New Orleans","70187":"New Orleans","70189":"New Orleans",
    "70190":"New Orleans","70195":"New Orleans",
    // Las Vegas
    "89101":"Las Vegas","89102":"Las Vegas","89103":"Las Vegas","89104":"Las Vegas",
    "89105":"Las Vegas","89106":"Las Vegas","89107":"Las Vegas","89108":"Las Vegas",
    "89109":"Las Vegas","89110":"Las Vegas","89111":"Las Vegas","89112":"Las Vegas",
    "89113":"Las Vegas","89114":"Las Vegas","89115":"Las Vegas","89116":"Las Vegas",
    "89117":"Las Vegas","89118":"Las Vegas","89119":"Las Vegas","89120":"Las Vegas",
    "89121":"Las Vegas","89122":"Las Vegas","89123":"Las Vegas","89124":"Las Vegas",
    "89125":"Las Vegas","89126":"Las Vegas","89127":"Las Vegas","89128":"Las Vegas",
    "89129":"Las Vegas","89130":"Las Vegas","89131":"Las Vegas","89132":"Las Vegas",
    "89133":"Las Vegas","89134":"Las Vegas","89135":"Las Vegas","89136":"Las Vegas",
    "89137":"Las Vegas","89138":"Las Vegas","89139":"Las Vegas","89140":"Las Vegas",
    "89141":"Las Vegas","89142":"Las Vegas","89143":"Las Vegas","89144":"Las Vegas",
    "89145":"Las Vegas","89146":"Las Vegas","89147":"Las Vegas","89148":"Las Vegas",
    "89149":"Las Vegas","89150":"Las Vegas","89151":"Las Vegas","89152":"Las Vegas",
    "89153":"Las Vegas","89154":"Las Vegas","89155":"Las Vegas","89156":"Las Vegas",
    "89157":"Las Vegas","89158":"Las Vegas","89159":"Las Vegas","89160":"Las Vegas",
    "89161":"Las Vegas","89162":"Las Vegas","89163":"Las Vegas","89164":"Las Vegas",
    "89165":"Las Vegas","89166":"Las Vegas","89169":"Las Vegas","89170":"Las Vegas",
    "89173":"Las Vegas","89177":"Las Vegas","89178":"Las Vegas","89179":"Las Vegas",
    "89180":"Las Vegas","89183":"Las Vegas","89185":"Las Vegas","89193":"Las Vegas",
    "89195":"Las Vegas","89199":"Las Vegas",
    // San Francisco
    "94102":"San Francisco","94103":"San Francisco","94104":"San Francisco",
    "94105":"San Francisco","94107":"San Francisco","94108":"San Francisco",
    "94109":"San Francisco","94110":"San Francisco","94111":"San Francisco",
    "94112":"San Francisco","94114":"San Francisco","94115":"San Francisco",
    "94116":"San Francisco","94117":"San Francisco","94118":"San Francisco",
    "94121":"San Francisco","94122":"San Francisco","94123":"San Francisco",
    "94124":"San Francisco","94127":"San Francisco","94128":"San Francisco",
    "94129":"San Francisco","94130":"San Francisco","94131":"San Francisco",
    "94132":"San Francisco","94133":"San Francisco","94134":"San Francisco",
    "94158":"San Francisco","94159":"San Francisco","94160":"San Francisco",
    "94161":"San Francisco","94163":"San Francisco","94164":"San Francisco",
    "94172":"San Francisco","94177":"San Francisco","94188":"San Francisco",
    // Dallas
    "75201":"Dallas","75202":"Dallas","75203":"Dallas","75204":"Dallas",
    "75205":"Dallas","75206":"Dallas","75207":"Dallas","75208":"Dallas",
    "75209":"Dallas","75210":"Dallas","75211":"Dallas","75212":"Dallas",
    "75214":"Dallas","75215":"Dallas","75216":"Dallas","75217":"Dallas",
    "75218":"Dallas","75219":"Dallas","75220":"Dallas","75221":"Dallas",
    "75222":"Dallas","75223":"Dallas","75224":"Dallas","75225":"Dallas",
    "75226":"Dallas","75227":"Dallas","75228":"Dallas","75229":"Dallas",
    "75230":"Dallas","75231":"Dallas","75232":"Dallas","75233":"Dallas",
    "75234":"Dallas","75235":"Dallas","75236":"Dallas","75237":"Dallas",
    "75238":"Dallas","75240":"Dallas","75241":"Dallas","75242":"Dallas",
    "75243":"Dallas","75244":"Dallas","75245":"Dallas","75246":"Dallas",
    "75247":"Dallas","75248":"Dallas","75249":"Dallas","75250":"Dallas",
    "75251":"Dallas","75252":"Dallas","75253":"Dallas","75254":"Dallas",
    // Austin
    "78701":"Austin","78702":"Austin","78703":"Austin","78704":"Austin",
    "78705":"Austin","78708":"Austin","78709":"Austin","78710":"Austin",
    "78711":"Austin","78712":"Austin","78713":"Austin","78714":"Austin",
    "78715":"Austin","78716":"Austin","78717":"Austin","78718":"Austin",
    "78719":"Austin","78720":"Austin","78721":"Austin","78722":"Austin",
    "78723":"Austin","78724":"Austin","78725":"Austin","78726":"Austin",
    "78727":"Austin","78728":"Austin","78729":"Austin","78730":"Austin",
    "78731":"Austin","78732":"Austin","78733":"Austin","78734":"Austin",
    "78735":"Austin","78736":"Austin","78737":"Austin","78738":"Austin",
    "78739":"Austin","78741":"Austin","78742":"Austin","78744":"Austin",
    "78745":"Austin","78746":"Austin","78747":"Austin","78748":"Austin",
    "78749":"Austin","78750":"Austin","78751":"Austin","78752":"Austin",
    "78753":"Austin","78754":"Austin","78755":"Austin","78756":"Austin",
    "78757":"Austin","78758":"Austin","78759":"Austin",
    // Portland OR
    "97201":"Portland","97202":"Portland","97203":"Portland","97204":"Portland",
    "97205":"Portland","97206":"Portland","97207":"Portland","97208":"Portland",
    "97209":"Portland","97210":"Portland","97211":"Portland","97212":"Portland",
    "97213":"Portland","97214":"Portland","97215":"Portland","97216":"Portland",
    "97217":"Portland","97218":"Portland","97219":"Portland","97220":"Portland",
    "97221":"Portland","97222":"Portland","97223":"Portland","97224":"Portland",
    "97225":"Portland","97227":"Portland","97228":"Portland","97229":"Portland",
    "97230":"Portland","97231":"Portland","97232":"Portland","97233":"Portland",
    "97236":"Portland","97238":"Portland","97239":"Portland","97240":"Portland",
    "97242":"Portland","97256":"Portland","97258":"Portland","97266":"Portland",
    "97267":"Portland","97268":"Portland","97269":"Portland","97280":"Portland",
    "97281":"Portland","97282":"Portland","97283":"Portland","97286":"Portland",
    "97290":"Portland","97291":"Portland","97292":"Portland","97293":"Portland",
    "97294":"Portland","97296":"Portland","97298":"Portland",
    // Tampa
    "33601":"Tampa","33602":"Tampa","33603":"Tampa","33604":"Tampa",
    "33605":"Tampa","33606":"Tampa","33607":"Tampa","33608":"Tampa",
    "33609":"Tampa","33610":"Tampa","33611":"Tampa","33612":"Tampa",
    "33613":"Tampa","33614":"Tampa","33615":"Tampa","33616":"Tampa",
    "33617":"Tampa","33618":"Tampa","33619":"Tampa","33620":"Tampa",
    "33621":"Tampa","33622":"Tampa","33623":"Tampa","33624":"Tampa",
    "33625":"Tampa","33626":"Tampa","33629":"Tampa","33630":"Tampa",
    "33631":"Tampa","33633":"Tampa","33634":"Tampa","33635":"Tampa",
    "33637":"Tampa","33646":"Tampa","33647":"Tampa","33650":"Tampa",
    "33651":"Tampa","33655":"Tampa","33660":"Tampa","33661":"Tampa",
    "33662":"Tampa","33663":"Tampa","33664":"Tampa","33672":"Tampa",
    "33673":"Tampa","33674":"Tampa","33675":"Tampa","33677":"Tampa",
    "33679":"Tampa","33680":"Tampa","33681":"Tampa","33682":"Tampa",
    "33684":"Tampa","33685":"Tampa","33686":"Tampa","33687":"Tampa",
    "33688":"Tampa","33689":"Tampa","33694":"Tampa",
    // Orlando
    "32801":"Orlando","32802":"Orlando","32803":"Orlando","32804":"Orlando",
    "32805":"Orlando","32806":"Orlando","32807":"Orlando","32808":"Orlando",
    "32809":"Orlando","32810":"Orlando","32811":"Orlando","32812":"Orlando",
    "32814":"Orlando","32815":"Orlando","32816":"Orlando","32817":"Orlando",
    "32818":"Orlando","32819":"Orlando","32820":"Orlando","32821":"Orlando",
    "32822":"Orlando","32824":"Orlando","32825":"Orlando","32826":"Orlando",
    "32827":"Orlando","32828":"Orlando","32829":"Orlando","32830":"Orlando",
    "32831":"Orlando","32832":"Orlando","32833":"Orlando","32834":"Orlando",
    "32835":"Orlando","32836":"Orlando","32837":"Orlando","32839":"Orlando",
    // San Diego
    "92101":"San Diego","92102":"San Diego","92103":"San Diego","92104":"San Diego",
    "92105":"San Diego","92106":"San Diego","92107":"San Diego","92108":"San Diego",
    "92109":"San Diego","92110":"San Diego","92111":"San Diego","92112":"San Diego",
    "92113":"San Diego","92114":"San Diego","92115":"San Diego","92116":"San Diego",
    "92117":"San Diego","92118":"San Diego","92119":"San Diego","92120":"San Diego",
    "92121":"San Diego","92122":"San Diego","92123":"San Diego","92124":"San Diego",
    "92126":"San Diego","92127":"San Diego","92128":"San Diego","92129":"San Diego",
    "92130":"San Diego","92131":"San Diego","92132":"San Diego","92134":"San Diego",
    "92135":"San Diego","92136":"San Diego","92137":"San Diego","92138":"San Diego",
    "92139":"San Diego","92140":"San Diego","92142":"San Diego","92143":"San Diego",
    "92145":"San Diego","92147":"San Diego","92149":"San Diego","92150":"San Diego",
    "92152":"San Diego","92153":"San Diego","92154":"San Diego","92155":"San Diego",
    "92158":"San Diego","92159":"San Diego","92160":"San Diego","92161":"San Diego",
    "92163":"San Diego","92165":"San Diego","92166":"San Diego","92167":"San Diego",
    "92168":"San Diego","92169":"San Diego","92170":"San Diego","92171":"San Diego",
    "92172":"San Diego","92173":"San Diego","92174":"San Diego","92175":"San Diego",
    "92176":"San Diego","92177":"San Diego","92178":"San Diego","92179":"San Diego",
    "92182":"San Diego","92184":"San Diego","92186":"San Diego","92187":"San Diego",
    "92190":"San Diego","92191":"San Diego","92192":"San Diego","92193":"San Diego",
    "92194":"San Diego","92195":"San Diego","92196":"San Diego","92197":"San Diego",
    "92198":"San Diego","92199":"San Diego",
    // Charlotte
    "28201":"Charlotte","28202":"Charlotte","28203":"Charlotte","28204":"Charlotte",
    "28205":"Charlotte","28206":"Charlotte","28207":"Charlotte","28208":"Charlotte",
    "28209":"Charlotte","28210":"Charlotte","28211":"Charlotte","28212":"Charlotte",
    "28213":"Charlotte","28214":"Charlotte","28215":"Charlotte","28216":"Charlotte",
    "28217":"Charlotte","28218":"Charlotte","28219":"Charlotte","28220":"Charlotte",
    "28221":"Charlotte","28222":"Charlotte","28223":"Charlotte","28224":"Charlotte",
    "28226":"Charlotte","28227":"Charlotte","28228":"Charlotte","28229":"Charlotte",
    "28230":"Charlotte","28231":"Charlotte","28232":"Charlotte","28233":"Charlotte",
    "28234":"Charlotte","28235":"Charlotte","28236":"Charlotte","28237":"Charlotte",
    "28241":"Charlotte","28242":"Charlotte","28243":"Charlotte","28244":"Charlotte",
    "28246":"Charlotte","28247":"Charlotte","28250":"Charlotte","28253":"Charlotte",
    "28254":"Charlotte","28255":"Charlotte","28256":"Charlotte","28258":"Charlotte",
    "28260":"Charlotte","28262":"Charlotte","28263":"Charlotte","28265":"Charlotte",
    "28266":"Charlotte","28269":"Charlotte","28270":"Charlotte","28271":"Charlotte",
    "28272":"Charlotte","28273":"Charlotte","28274":"Charlotte","28275":"Charlotte",
    "28277":"Charlotte","28278":"Charlotte","28280":"Charlotte","28281":"Charlotte",
    "28282":"Charlotte","28284":"Charlotte","28285":"Charlotte","28287":"Charlotte",
    "28288":"Charlotte","28289":"Charlotte","28290":"Charlotte","28296":"Charlotte",
    "28297":"Charlotte","28299":"Charlotte",
    // Boston
    "02101":"Boston","02102":"Boston","02103":"Boston","02104":"Boston",
    "02105":"Boston","02106":"Boston","02107":"Boston","02108":"Boston",
    "02109":"Boston","02110":"Boston","02111":"Boston","02112":"Boston",
    "02113":"Boston","02114":"Boston","02115":"Boston","02116":"Boston",
    "02117":"Boston","02118":"Boston","02119":"Boston","02120":"Boston",
    "02121":"Boston","02122":"Boston","02123":"Boston","02124":"Boston",
    "02125":"Boston","02126":"Boston","02127":"Boston","02128":"Boston",
    "02129":"Boston","02130":"Boston","02131":"Boston","02132":"Boston",
    "02133":"Boston","02134":"Boston","02135":"Boston","02136":"Boston",
    "02137":"Boston","02163":"Boston","02196":"Boston","02199":"Boston",
    "02201":"Boston","02203":"Boston","02204":"Boston","02205":"Boston",
    "02206":"Boston","02207":"Boston","02208":"Boston","02209":"Boston",
    "02210":"Boston","02211":"Boston","02212":"Boston","02215":"Boston",
    "02217":"Boston","02222":"Boston","02241":"Boston","02266":"Boston",
    "02283":"Boston","02284":"Boston","02293":"Boston","02295":"Boston",
    "02297":"Boston","02298":"Boston",
    // Philadelphia
    "19101":"Philadelphia","19102":"Philadelphia","19103":"Philadelphia",
    "19104":"Philadelphia","19105":"Philadelphia","19106":"Philadelphia",
    "19107":"Philadelphia","19108":"Philadelphia","19109":"Philadelphia",
    "19110":"Philadelphia","19111":"Philadelphia","19112":"Philadelphia",
    "19113":"Philadelphia","19114":"Philadelphia","19115":"Philadelphia",
    "19116":"Philadelphia","19118":"Philadelphia","19119":"Philadelphia",
    "19120":"Philadelphia","19121":"Philadelphia","19122":"Philadelphia",
    "19123":"Philadelphia","19124":"Philadelphia","19125":"Philadelphia",
    "19126":"Philadelphia","19127":"Philadelphia","19128":"Philadelphia",
    "19129":"Philadelphia","19130":"Philadelphia","19131":"Philadelphia",
    "19132":"Philadelphia","19133":"Philadelphia","19134":"Philadelphia",
    "19135":"Philadelphia","19136":"Philadelphia","19137":"Philadelphia",
    "19138":"Philadelphia","19139":"Philadelphia","19140":"Philadelphia",
    "19141":"Philadelphia","19142":"Philadelphia","19143":"Philadelphia",
    "19144":"Philadelphia","19145":"Philadelphia","19146":"Philadelphia",
    "19147":"Philadelphia","19148":"Philadelphia","19149":"Philadelphia",
    "19150":"Philadelphia","19151":"Philadelphia","19152":"Philadelphia",
    "19153":"Philadelphia","19154":"Philadelphia",
    // Minneapolis
    "55401":"Minneapolis","55402":"Minneapolis","55403":"Minneapolis",
    "55404":"Minneapolis","55405":"Minneapolis","55406":"Minneapolis",
    "55407":"Minneapolis","55408":"Minneapolis","55409":"Minneapolis",
    "55410":"Minneapolis","55411":"Minneapolis","55412":"Minneapolis",
    "55413":"Minneapolis","55414":"Minneapolis","55415":"Minneapolis",
    "55416":"Minneapolis","55417":"Minneapolis","55418":"Minneapolis",
    "55419":"Minneapolis","55420":"Minneapolis","55421":"Minneapolis",
    "55422":"Minneapolis","55423":"Minneapolis","55424":"Minneapolis",
    "55425":"Minneapolis","55426":"Minneapolis","55427":"Minneapolis",
    "55428":"Minneapolis","55429":"Minneapolis","55430":"Minneapolis",
    "55431":"Minneapolis","55432":"Minneapolis","55433":"Minneapolis",
    "55434":"Minneapolis","55435":"Minneapolis","55436":"Minneapolis",
    "55437":"Minneapolis","55438":"Minneapolis","55439":"Minneapolis",
    "55440":"Minneapolis","55441":"Minneapolis","55442":"Minneapolis",
    "55443":"Minneapolis","55444":"Minneapolis","55445":"Minneapolis",
    "55446":"Minneapolis","55447":"Minneapolis","55448":"Minneapolis",
    "55449":"Minneapolis","55450":"Minneapolis","55454":"Minneapolis",
    "55455":"Minneapolis","55458":"Minneapolis","55459":"Minneapolis",
    "55460":"Minneapolis","55467":"Minneapolis","55470":"Minneapolis",
    "55472":"Minneapolis","55473":"Minneapolis","55474":"Minneapolis",
    "55478":"Minneapolis","55479":"Minneapolis","55480":"Minneapolis",
    "55483":"Minneapolis","55484":"Minneapolis","55485":"Minneapolis",
    "55486":"Minneapolis","55487":"Minneapolis","55488":"Minneapolis",
    // Salt Lake City
    "84101":"Salt Lake City","84102":"Salt Lake City","84103":"Salt Lake City",
    "84104":"Salt Lake City","84105":"Salt Lake City","84106":"Salt Lake City",
    "84107":"Salt Lake City","84108":"Salt Lake City","84109":"Salt Lake City",
    "84110":"Salt Lake City","84111":"Salt Lake City","84112":"Salt Lake City",
    "84113":"Salt Lake City","84114":"Salt Lake City","84115":"Salt Lake City",
    "84116":"Salt Lake City","84117":"Salt Lake City","84118":"Salt Lake City",
    "84119":"Salt Lake City","84120":"Salt Lake City","84121":"Salt Lake City",
    "84122":"Salt Lake City","84123":"Salt Lake City","84124":"Salt Lake City",
    "84125":"Salt Lake City","84126":"Salt Lake City","84127":"Salt Lake City",
    "84128":"Salt Lake City","84129":"Salt Lake City","84130":"Salt Lake City",
    "84131":"Salt Lake City","84132":"Salt Lake City","84133":"Salt Lake City",
    "84134":"Salt Lake City","84136":"Salt Lake City","84138":"Salt Lake City",
    "84139":"Salt Lake City","84141":"Salt Lake City","84143":"Salt Lake City",
    "84144":"Salt Lake City","84145":"Salt Lake City","84147":"Salt Lake City",
    "84148":"Salt Lake City","84150":"Salt Lake City","84151":"Salt Lake City",
    "84152":"Salt Lake City","84157":"Salt Lake City","84158":"Salt Lake City",
    "84165":"Salt Lake City","84170":"Salt Lake City","84171":"Salt Lake City",
    "84172":"Salt Lake City","84173":"Salt Lake City","84174":"Salt Lake City",
    "84175":"Salt Lake City","84176":"Salt Lake City","84177":"Salt Lake City",
    "84178":"Salt Lake City","84179":"Salt Lake City","84180":"Salt Lake City",
    "84184":"Salt Lake City","84189":"Salt Lake City","84190":"Salt Lake City",
    "84199":"Salt Lake City",
    // Pittsburgh
    "15201":"Pittsburgh","15202":"Pittsburgh","15203":"Pittsburgh","15204":"Pittsburgh",
    "15205":"Pittsburgh","15206":"Pittsburgh","15207":"Pittsburgh","15208":"Pittsburgh",
    "15209":"Pittsburgh","15210":"Pittsburgh","15211":"Pittsburgh","15212":"Pittsburgh",
    "15213":"Pittsburgh","15214":"Pittsburgh","15215":"Pittsburgh","15216":"Pittsburgh",
    "15217":"Pittsburgh","15218":"Pittsburgh","15219":"Pittsburgh","15220":"Pittsburgh",
    "15221":"Pittsburgh","15222":"Pittsburgh","15223":"Pittsburgh","15224":"Pittsburgh",
    "15225":"Pittsburgh","15226":"Pittsburgh","15227":"Pittsburgh","15228":"Pittsburgh",
    "15229":"Pittsburgh","15230":"Pittsburgh","15231":"Pittsburgh","15232":"Pittsburgh",
    "15233":"Pittsburgh","15234":"Pittsburgh","15235":"Pittsburgh","15236":"Pittsburgh",
    "15237":"Pittsburgh","15238":"Pittsburgh","15239":"Pittsburgh","15240":"Pittsburgh",
    "15241":"Pittsburgh","15242":"Pittsburgh","15243":"Pittsburgh","15244":"Pittsburgh",
    "15250":"Pittsburgh","15251":"Pittsburgh","15252":"Pittsburgh","15253":"Pittsburgh",
    "15254":"Pittsburgh","15255":"Pittsburgh","15257":"Pittsburgh","15258":"Pittsburgh",
    "15259":"Pittsburgh","15260":"Pittsburgh","15261":"Pittsburgh","15262":"Pittsburgh",
    "15264":"Pittsburgh","15265":"Pittsburgh","15267":"Pittsburgh","15268":"Pittsburgh",
    "15270":"Pittsburgh","15272":"Pittsburgh","15274":"Pittsburgh","15275":"Pittsburgh",
    "15276":"Pittsburgh","15277":"Pittsburgh","15278":"Pittsburgh","15279":"Pittsburgh",
    "15281":"Pittsburgh","15282":"Pittsburgh","15283":"Pittsburgh","15285":"Pittsburgh",
    "15286":"Pittsburgh","15289":"Pittsburgh","15290":"Pittsburgh","15295":"Pittsburgh",
    // Franklin PA and surrounding areas
    "16301":"Oil City","16302":"Oil City","16311":"Clarion County",
    "16312":"Mercer County","16313":"Venango County","16314":"Meadville",
    "16316":"Crawford County","16317":"Venango County","16319":"Venango County",
    "16321":"Venango County","16322":"Venango County","16323":"Franklin",
    "16324":"Venango County","16326":"Venango County","16327":"Meadville",
    "16328":"Crawford County","16329":"Venango County","16331":"Clarion County",
    "16332":"Clarion County","16333":"Elk County","16334":"Clarion County",
    "16335":"Meadville","16340":"Venango County","16341":"Venango County",
    "16342":"Venango County","16343":"Venango County","16344":"Venango County",
    "16345":"Potter County","16346":"Venango County","16347":"Venango County",
    "16348":"Warren County","16350":"Warren County","16351":"Warren County",
    "16352":"Warren County","16353":"Warren County","16354":"Mercer County",
    "16360":"Crawford County","16361":"Clarion County","16362":"Venango County",
    "16364":"Venango County","16365":"Warren","16366":"Warren County",
    "16367":"Warren County","16368":"Warren County","16369":"Warren County",
    "16370":"Warren County","16371":"Warren County","16372":"Venango County",
    "16373":"Clarion County","16374":"Venango County","16375":"Mercer County",
    // More Pennsylvania
    "15001":"Aliquippa","15003":"Ambridge","15005":"Baden","15007":"Bairdford",
    "15009":"Beaver","15010":"Beaver Falls","15012":"Belle Vernon",
    "15014":"Brackenridge","15015":"Bradfordwoods","15017":"Bridgeville",
    "15018":"Buena Vista","15019":"Bulger","15020":"Bunola","15021":"California",
    "15022":"Charleroi","15024":"Cheswick","15025":"Clairton","15026":"Clinton",
    "15027":"Conway","15028":"Coulters","15030":"Creighton","15031":"Cuddy",
    "15032":"Curtisville","15033":"Donora","15034":"Dravosburg","15035":"East McKeesport",
    "15037":"Elizabeth","15038":"Elrama","15042":"Freedom","15043":"Georgetown",
    "15044":"Gibsonia","15045":"Glassport","15046":"Coraopolis","15047":"Greenock",
    "15049":"Harwick","15050":"Hookstown","15051":"Indianola","15052":"Industry",
    "15053":"Joffre","15054":"Langeloth","15055":"Lawrence","15056":"Leetsdale",
    "15057":"McDonald","15059":"Midland","15060":"Midway","15061":"Monaca",
    "15062":"Monessen","15063":"Monongahela","15064":"Morgan","15065":"Natrona Heights",
    "15066":"New Brighton","15067":"New Eagle","15068":"New Kensington",
    "15069":"New Kensington","15071":"Oakdale","15072":"Pricedale",
    "15074":"Rochester","15075":"Rural Ridge","15076":"Russellton",
    "15077":"Shippingport","15078":"Slovan","15081":"South Heights",
    "15082":"Strabane","15083":"Sutersville","15084":"Tarentum",
    "15085":"Trafford","15086":"Warrendale","15087":"Webster",
    "15088":"West Elizabeth","15089":"West Newton","15090":"Wexford",
    "15091":"Wildwood","15095":"Warrendale","15096":"Warrendale",
    "15101":"Allison Park","15102":"Bethel Park","15104":"Braddock",
    "15106":"Carnegie","15108":"Coraopolis","15110":"Duquesne",
    "15112":"East Pittsburgh","15116":"Glenshaw","15120":"Homestead",
    "15121":"Jefferson Hills","15122":"West Mifflin","15123":"West Mifflin",
    "15126":"Imperial","15127":"Ingomar","15129":"South Park Township",
    "15130":"McKeesport","15131":"McKeesport","15132":"McKeesport",
    "15133":"McKeesport","15134":"McKeesport","15135":"McKeesport",
    "15136":"McKees Rocks","15137":"North Versailles","15139":"Oakmont",
    "15140":"Pitcairn","15142":"Presto","15143":"Sewickley",
    "15144":"Springdale","15145":"Turtle Creek","15146":"Monroeville",
    "15147":"Verona","15148":"Wilmerding",
    // San Antonio
    "78201":"San Antonio","78202":"San Antonio","78203":"San Antonio",
    "78204":"San Antonio","78205":"San Antonio","78206":"San Antonio",
    "78207":"San Antonio","78208":"San Antonio","78209":"San Antonio",
    "78210":"San Antonio","78211":"San Antonio","78212":"San Antonio",
    "78213":"San Antonio","78214":"San Antonio","78215":"San Antonio",
    "78216":"San Antonio","78217":"San Antonio","78218":"San Antonio",
    "78219":"San Antonio","78220":"San Antonio","78221":"San Antonio",
    "78222":"San Antonio","78223":"San Antonio","78224":"San Antonio",
    "78225":"San Antonio","78226":"San Antonio","78227":"San Antonio",
    "78228":"San Antonio","78229":"San Antonio","78230":"San Antonio",
    "78231":"San Antonio","78232":"San Antonio","78233":"San Antonio",
    "78234":"San Antonio","78235":"San Antonio","78236":"San Antonio",
    "78237":"San Antonio","78238":"San Antonio","78239":"San Antonio",
    "78240":"San Antonio","78241":"San Antonio","78242":"San Antonio",
    "78243":"San Antonio","78244":"San Antonio","78245":"San Antonio",
    "78246":"San Antonio","78247":"San Antonio","78248":"San Antonio",
    "78249":"San Antonio","78250":"San Antonio","78251":"San Antonio",
    "78252":"San Antonio","78253":"San Antonio","78254":"San Antonio",
    "78255":"San Antonio","78256":"San Antonio","78257":"San Antonio",
    "78258":"San Antonio","78259":"San Antonio","78260":"San Antonio",
    "78261":"San Antonio","78263":"San Antonio","78264":"San Antonio",
    "78265":"San Antonio","78266":"San Antonio","78268":"San Antonio",
    "78269":"San Antonio","78270":"San Antonio","78278":"San Antonio",
    "78279":"San Antonio","78280":"San Antonio","78283":"San Antonio",
    "78284":"San Antonio","78285":"San Antonio","78288":"San Antonio",
    "78289":"San Antonio","78291":"San Antonio","78292":"San Antonio",
    "78293":"San Antonio","78294":"San Antonio","78295":"San Antonio",
    "78296":"San Antonio","78297":"San Antonio","78298":"San Antonio",
    "78299":"San Antonio",
    // Kansas City
    "64101":"Kansas City","64102":"Kansas City","64105":"Kansas City",
    "64106":"Kansas City","64108":"Kansas City","64109":"Kansas City",
    "64110":"Kansas City","64111":"Kansas City","64112":"Kansas City",
    "64113":"Kansas City","64114":"Kansas City","64116":"Kansas City",
    "64117":"Kansas City","64118":"Kansas City","64119":"Kansas City",
    "64120":"Kansas City","64121":"Kansas City","64123":"Kansas City",
    "64124":"Kansas City","64125":"Kansas City","64126":"Kansas City",
    "64127":"Kansas City","64128":"Kansas City","64129":"Kansas City",
    "64130":"Kansas City","64131":"Kansas City","64132":"Kansas City",
    "64133":"Kansas City","64134":"Kansas City","64136":"Kansas City",
    "64137":"Kansas City","64138":"Kansas City","64139":"Kansas City",
    "64141":"Kansas City","64144":"Kansas City","64145":"Kansas City",
    "64146":"Kansas City","64147":"Kansas City","64148":"Kansas City",
    "64149":"Kansas City","64150":"Kansas City","64151":"Kansas City",
    "64152":"Kansas City","64153":"Kansas City","64154":"Kansas City",
    "64155":"Kansas City","64156":"Kansas City","64157":"Kansas City",
    "64158":"Kansas City","64161":"Kansas City","64162":"Kansas City",
    "64163":"Kansas City","64164":"Kansas City","64165":"Kansas City",
    "64166":"Kansas City","64167":"Kansas City","64168":"Kansas City",
    "64170":"Kansas City","64171":"Kansas City","64179":"Kansas City",
    "64180":"Kansas City","64184":"Kansas City","64185":"Kansas City",
    "64187":"Kansas City","64188":"Kansas City","64190":"Kansas City",
    "64191":"Kansas City","64192":"Kansas City","64193":"Kansas City",
    "64194":"Kansas City","64195":"Kansas City","64196":"Kansas City",
    "64197":"Kansas City","64198":"Kansas City","64199":"Kansas City",
    // Columbus OH
    "43201":"Columbus","43202":"Columbus","43203":"Columbus","43204":"Columbus",
    "43205":"Columbus","43206":"Columbus","43207":"Columbus","43209":"Columbus",
    "43210":"Columbus","43211":"Columbus","43212":"Columbus","43213":"Columbus",
    "43214":"Columbus","43215":"Columbus","43216":"Columbus","43217":"Columbus",
    "43218":"Columbus","43219":"Columbus","43220":"Columbus","43221":"Columbus",
    "43222":"Columbus","43223":"Columbus","43224":"Columbus","43226":"Columbus",
    "43227":"Columbus","43228":"Columbus","43229":"Columbus","43230":"Columbus",
    "43231":"Columbus","43232":"Columbus","43234":"Columbus","43235":"Columbus",
    "43236":"Columbus","43240":"Columbus","43251":"Columbus","43260":"Columbus",
    "43266":"Columbus","43268":"Columbus","43270":"Columbus","43271":"Columbus",
    "43272":"Columbus","43279":"Columbus","43287":"Columbus","43291":"Columbus",
    // Memphis
    "38101":"Memphis","38103":"Memphis","38104":"Memphis","38105":"Memphis",
    "38106":"Memphis","38107":"Memphis","38108":"Memphis","38109":"Memphis",
    "38110":"Memphis","38111":"Memphis","38112":"Memphis","38113":"Memphis",
    "38114":"Memphis","38115":"Memphis","38116":"Memphis","38117":"Memphis",
    "38118":"Memphis","38119":"Memphis","38120":"Memphis","38122":"Memphis",
    "38124":"Memphis","38125":"Memphis","38126":"Memphis","38127":"Memphis",
    "38128":"Memphis","38130":"Memphis","38131":"Memphis","38132":"Memphis",
    "38133":"Memphis","38134":"Memphis","38135":"Memphis","38136":"Memphis",
    "38137":"Memphis","38138":"Memphis","38139":"Memphis","38141":"Memphis",
    "38145":"Memphis","38147":"Memphis","38148":"Memphis","38150":"Memphis",
    "38151":"Memphis","38152":"Memphis","38157":"Memphis","38159":"Memphis",
    "38161":"Memphis","38163":"Memphis","38166":"Memphis","38167":"Memphis",
    "38168":"Memphis","38173":"Memphis","38174":"Memphis","38175":"Memphis",
    "38177":"Memphis","38181":"Memphis","38182":"Memphis","38183":"Memphis",
    "38184":"Memphis","38186":"Memphis","38187":"Memphis","38188":"Memphis",
    "38190":"Memphis","38193":"Memphis","38194":"Memphis","38197":"Memphis",
    // Raleigh
    "27601":"Raleigh","27602":"Raleigh","27603":"Raleigh","27604":"Raleigh",
    "27605":"Raleigh","27606":"Raleigh","27607":"Raleigh","27608":"Raleigh",
    "27609":"Raleigh","27610":"Raleigh","27611":"Raleigh","27612":"Raleigh",
    "27613":"Raleigh","27614":"Raleigh","27615":"Raleigh","27616":"Raleigh",
    "27617":"Raleigh","27619":"Raleigh","27620":"Raleigh","27621":"Raleigh",
    "27622":"Raleigh","27623":"Raleigh","27624":"Raleigh","27625":"Raleigh",
    "27626":"Raleigh","27627":"Raleigh","27628":"Raleigh","27629":"Raleigh",
    "27634":"Raleigh","27635":"Raleigh","27636":"Raleigh","27640":"Raleigh",
    "27650":"Raleigh","27656":"Raleigh","27658":"Raleigh","27661":"Raleigh",
    "27668":"Raleigh","27675":"Raleigh","27676":"Raleigh","27690":"Raleigh",
    "27695":"Raleigh","27697":"Raleigh","27698":"Raleigh","27699":"Raleigh",
    // Milwaukee
    "53201":"Milwaukee","53202":"Milwaukee","53203":"Milwaukee","53204":"Milwaukee",
    "53205":"Milwaukee","53206":"Milwaukee","53207":"Milwaukee","53208":"Milwaukee",
    "53209":"Milwaukee","53210":"Milwaukee","53211":"Milwaukee","53212":"Milwaukee",
    "53213":"Milwaukee","53214":"Milwaukee","53215":"Milwaukee","53216":"Milwaukee",
    "53217":"Milwaukee","53218":"Milwaukee","53219":"Milwaukee","53220":"Milwaukee",
    "53221":"Milwaukee","53222":"Milwaukee","53223":"Milwaukee","53224":"Milwaukee",
    "53225":"Milwaukee","53226":"Milwaukee","53227":"Milwaukee","53228":"Milwaukee",
    "53233":"Milwaukee","53234":"Milwaukee","53237":"Milwaukee","53259":"Milwaukee",
    "53263":"Milwaukee","53267":"Milwaukee","53268":"Milwaukee","53274":"Milwaukee",
    "53278":"Milwaukee","53288":"Milwaukee","53290":"Milwaukee","53293":"Milwaukee",
    "53295":"Milwaukee",
    // Jacksonville FL
    "32201":"Jacksonville","32202":"Jacksonville","32203":"Jacksonville",
    "32204":"Jacksonville","32205":"Jacksonville","32206":"Jacksonville",
    "32207":"Jacksonville","32208":"Jacksonville","32209":"Jacksonville",
    "32210":"Jacksonville","32211":"Jacksonville","32212":"Jacksonville",
    "32214":"Jacksonville","32215":"Jacksonville","32216":"Jacksonville",
    "32217":"Jacksonville","32218":"Jacksonville","32219":"Jacksonville",
    "32220":"Jacksonville","32221":"Jacksonville","32222":"Jacksonville",
    "32223":"Jacksonville","32224":"Jacksonville","32225":"Jacksonville",
    "32226":"Jacksonville","32227":"Jacksonville","32228":"Jacksonville",
    "32229":"Jacksonville","32230":"Jacksonville","32231":"Jacksonville",
    "32232":"Jacksonville","32234":"Jacksonville","32235":"Jacksonville",
    "32236":"Jacksonville","32237":"Jacksonville","32238":"Jacksonville",
    "32239":"Jacksonville","32240":"Jacksonville","32241":"Jacksonville",
    "32244":"Jacksonville","32245":"Jacksonville","32246":"Jacksonville",
    "32247":"Jacksonville","32250":"Jacksonville Beach","32254":"Jacksonville",
    "32255":"Jacksonville","32256":"Jacksonville","32257":"Jacksonville",
    "32258":"Jacksonville","32259":"Jacksonville","32260":"Jacksonville",
    "32266":"Jacksonville Beach","32277":"Jacksonville",
  };

  if (ZIP_CITY[zip]) return ZIP_CITY[zip];

  // Fallback to state-level detection for unknown ZIPs
  const z = parseInt(zip);
  if (z>=35000&&z<=36999) return "Alabama";
  if (z>=99500&&z<=99999) return "Alaska";
  if (z>=85000&&z<=86999) return "Arizona";
  if (z>=71600&&z<=72999) return "Arkansas";
  if (z>=90000&&z<=96699) return "California";
  if (z>=80000&&z<=81999) return "Colorado";
  if (z>=6000&&z<=6999) return "Connecticut";
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
  if (z>=3900&&z<=4999) return "Maine";
  if (z>=20600&&z<=21999) return "Maryland";
  if (z>=1000&&z<=2799) return "Massachusetts";
  if (z>=48000&&z<=49999) return "Michigan";
  if (z>=55000&&z<=56999) return "Minnesota";
  if (z>=38600&&z<=39999) return "Mississippi";
  if (z>=63000&&z<=65999) return "Missouri";
  if (z>=59000&&z<=59999) return "Montana";
  if (z>=68000&&z<=69999) return "Nebraska";
  if (z>=88900&&z<=89999) return "Nevada";
  if (z>=3000&&z<=3899) return "New Hampshire";
  if (z>=7000&&z<=8999) return "New Jersey";
  if (z>=87000&&z<=88499) return "New Mexico";
  if (z>=10000&&z<=14999) return "New York";
  if (z>=27000&&z<=28999) return "North Carolina";
  if (z>=58000&&z<=58999) return "North Dakota";
  if (z>=43000&&z<=45999) return "Ohio";
  if (z>=73000&&z<=74999) return "Oklahoma";
  if (z>=97000&&z<=97999) return "Oregon";
  if (z>=15000&&z<=19699) return "Pennsylvania";
  if (z>=2800&&z<=2999) return "Rhode Island";
  if (z>=29000&&z<=29999) return "South Carolina";
  if (z>=57000&&z<=57999) return "South Dakota";
  if (z>=37000&&z<=38599) return "Tennessee";
  if (z>=75000&&z<=79999) return "Texas";
  if (z>=84000&&z<=84999) return "Utah";
  if (z>=5000&&z<=5999) return "Vermont";
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
