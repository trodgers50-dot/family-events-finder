// api/events.js — Vercel Serverless Proxy
// Sits between your app and Ticketmaster/Eventbrite to bypass CORS

const TM_KEY = process.env.TM_KEY;
const EB_KEY = process.env.EB_KEY;

export default async function handler(req, res) {
  // Allow requests from any origin (required for browser access)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { zip } = req.query;

  if (!zip || zip.length !== 5) {
    return res.status(400).json({ error: "Valid 5-digit ZIP code required" });
  }

  const results = { ticketmaster: [], eventbrite: [], errors: [] };

  // ── Ticketmaster ──────────────────────────────────────────────────────────
  try {
    const tmUrl = `https://app.ticketmaster.com/discovery/v2/events.json` +
      `?apikey=${TM_KEY}` +
      `&postalCode=${zip}` +
      `&countryCode=US` +
      `&radius=25` +
      `&unit=miles` +
      `&size=20` +
      `&sort=date,asc`;

    const tmRes = await fetch(tmUrl);
    const tmData = await tmRes.json();

    if (tmData.fault) throw new Error(tmData.fault.faultstring);

    results.ticketmaster = (tmData._embedded?.events || []).map(tm => {
      const venue = tm._embedded?.venues?.[0];
      const date = tm.dates?.start?.localDate || "";
      const type = classifyTM(tm);
      return {
        id: "tm_" + tm.id,
        name: tm.name,
        type,
        emoji: TYPE_EMOJI[type] || "📅",
        startDate: date,
        endDate: date,
        location: venue?.name || "See event page",
        address: [venue?.address?.line1, venue?.city?.name, venue?.state?.stateCode].filter(Boolean).join(", "),
        lat: parseFloat(venue?.location?.latitude || 0),
        lng: parseFloat(venue?.location?.longitude || 0),
        description: tm.info || tm.pleaseNote || "",
        familyRating: type === "Family" || type === "Kids" ? 5 : type === "Festival" ? 4 : 3,
        cost: tm.priceRanges ? `$${Math.round(tm.priceRanges[0].min)}+` : "See site",
        isFree: false,
        url: tm.url,
        source: "Ticketmaster",
        subEvents: (tm._embedded?.attractions || []).slice(0, 4).map(a => ({
          time: tm.dates?.start?.localTime?.slice(0, 5) || "TBD",
          name: a.name,
          day: date ? new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "TBD",
        })),
      };
    });
  } catch (e) {
    results.errors.push("Ticketmaster: " + e.message);
  }

  // ── Eventbrite ────────────────────────────────────────────────────────────
  try {
    const ebUrl = `https://www.eventbriteapi.com/v3/events/search/?token=${EB_KEY}&location.address=${zip}&location.within=25mi&expand=venue&sort_by=date`; +
      `?token=${EB_KEY}` +
      `&location.address=${zip}` +
      `&location.within=25mi` +
      `&expand=venue` +
      `&sort_by=date`;

    const ebRes = await fetch(ebUrl);
    const ebData = await ebRes.json();

    if (ebData.error) throw new Error(ebData.error_description || ebData.error);

    results.eventbrite = (ebData.events || []).slice(0, 20).map(eb => {
      const venue = eb.venue;
      const date = eb.start?.local?.split("T")[0] || "";
      const startTime = eb.start?.local?.split("T")[1]?.slice(0, 5) || "";
      const endTime = eb.end?.local?.split("T")[1]?.slice(0, 5) || "";
      const isFree = eb.is_free === true;
      const type = classifyEB(eb);
      const dayLabel = date
        ? new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
        : "TBD";
      return {
        id: "eb_" + eb.id,
        name: eb.name?.text || "Untitled Event",
        type,
        emoji: TYPE_EMOJI[type] || "📅",
        startDate: date,
        endDate: date,
        location: venue?.name || "See event page",
        address: venue?.address?.localized_address_display || "",
        lat: parseFloat(venue?.latitude || 0),
        lng: parseFloat(venue?.longitude || 0),
        description: (eb.description?.text || "").slice(0, 300),
        familyRating: type === "Family" || type === "Market" ? 5 : type === "Community" ? 4 : 3,
        cost: isFree ? "Free" : eb.ticket_availability?.minimum_ticket_price
          ? `$${Math.round(eb.ticket_availability.minimum_ticket_price.major_value)}+`
          : "See site",
        isFree,
        url: eb.url,
        source: "Eventbrite",
        subEvents: startTime
          ? [
              { time: startTime, name: "Event starts", day: dayLabel },
              ...(endTime ? [{ time: endTime, name: "Event ends", day: dayLabel }] : []),
            ]
          : [],
      };
    });
  } catch (e) {
    results.errors.push("Eventbrite: " + e.message);
  }

  // Merge and sort by date
  const all = [...results.ticketmaster, ...results.eventbrite].sort((a, b) => {
    if (!a.startDate) return 1;
    if (!b.startDate) return -1;
    return a.startDate.localeCompare(b.startDate);
  });

  return res.status(200).json({ events: all, errors: results.errors });
}

// ── Classifiers ───────────────────────────────────────────────────────────────
function classifyTM(e) {
  const seg = e.classifications?.[0]?.segment?.name || "";
  const genre = e.classifications?.[0]?.genre?.name || "";
  const n = (e.name || "").toLowerCase();
  if (seg === "Sports") return "Sports";
  if (seg === "Music") return "Music";
  if (seg === "Arts & Theatre") return "Arts";
  if (genre === "Family" || n.includes("family") || n.includes("kid") || n.includes("children")) return "Family";
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
  if (c.includes("community") || c.includes("neighborhood") || c.includes("volunteer")) return "Community";
  if (c.includes("art") || c.includes("craft") || c.includes("music") || c.includes("concert")) return "Arts";
  return "Community";
}

const TYPE_EMOJI = {
  Festival:"🎪", Market:"🌽", Cultural:"🎨", Carnival:"🎡",
  Kids:"🧒", Music:"🎵", Sports:"🏆", Arts:"🎭", Family:"👨‍👩‍👧‍👦",
  Food:"🍽️", Community:"🤝", Brewery:"🍺", Other:"📅",
};
