 // api/events.js — Vercel Serverless Proxy
const TM_KEY = process.env.TM_KEY;
const EB_KEY = process.env.EB_KEY;

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

  // ── Ticketmaster ────────────────────────────────────────────────────────────
  try {
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${TM_KEY}&postalCode=${zip}&countryCode=US&radius=25&unit=miles&size=20&sort=date,asc&classificationName=family,festival,music,arts,sports`;
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
        lat: parseFloat(venue?.location?.latitude || 0),
        lng: parseFloat(venue?.location?.longitude || 0),
        description: tm.info || tm.pleaseNote || "",
        familyRating: type === "Family" || type === "Kids" ? 5 : 4,
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

  // ── Eventbrite ──────────────────────────────────────────────────────────────
  try {
    const url = `https://www.eventbriteapi.com/v3/events/search/?token=${EB_KEY}&location.address=${zip}&location.within=25mi&expand=venue&sort_by=date&start_date.keyword=this_week`;
    const r = await fetch(url);
    const d = await r.json();
    if (d.error) throw new Error(d.error_description || d.error);
    const events = (d.events || []).slice(0, 15).map(eb => {
      const venue = eb.venue;
      const date = eb.start?.local?.split("T")[0] || "";
      const startTime = eb.start?.local?.split("T")[1]?.slice(0, 5) || "";
      const endTime = eb.end?.local?.split("T")[1]?.slice(0, 5) || "";
      const isFree = eb.is_free === true;
      const type = classifyEB(eb);
      const dayLabel = date ? new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }) : "TBD";
      return {
        id: "eb_" + eb.id,
        name: eb.name?.text || "Untitled Event",
        type,
        startDate: date,
        endDate: date,
        location: venue?.name || "See event page",
        address: venue?.address?.localized_address_display || "",
        lat: parseFloat(venue?.latitude || 0),
        lng: parseFloat(venue?.longitude || 0),
        description: (eb.description?.text || "").slice(0, 300),
        familyRating: type === "Family" || type === "Market" ? 5 : 4,
        cost: isFree ? "Free" : eb.ticket_availability?.minimum_ticket_price ? `$${Math.round(eb.ticket_availability.minimum_ticket_price.major_value)}+` : "See site",
        url: eb.url,
        source: "Eventbrite",
        subEvents: startTime ? [
          { time: startTime, name: "Event starts", day: dayLabel },
          ...(endTime ? [{ time: endTime, name: "Event ends", day: dayLabel }] : []),
        ] : [],
      };
    });
    results.events.push(...events);
  } catch (e) {
    results.errors.push("Eventbrite: " + e.message);
  }

  // Sort by date
  results.events.sort((a, b) => {
    if (!a.startDate) return 1;
    if (!b.startDate) return -1;
    return a.startDate.localeCompare(b.startDate);
  });

  return res.status(200).json(results);
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

function classifyEB(e) {
  const n = (e.name?.text || "").toLowerCase();
  const d = (e.description?.text || "").toLowerCase();
  const c = n + " " + d;
  if (c.includes("brewery") || c.includes("brewing") || c.includes("beer")) return "Brewery";
  if (c.includes("farmer") || c.includes("market") || c.includes("produce")) return "Market";
  if (c.includes("food") || c.includes("taste") || c.includes("culinary")) return "Food";
  if (c.includes("kid") || c.includes("children") || c.includes("family") || c.includes("toddler")) return "Family";
  if (c.includes("festival") || c.includes("fest")) return "Festival";
  if (c.includes("carnival") || c.includes("fair")) return "Carnival";
  if (c.includes("art") || c.includes("craft") || c.includes("music") || c.includes("concert")) return "Arts";
  return "Community";
}
