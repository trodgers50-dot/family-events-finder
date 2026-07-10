export default async function handler(req, res) {
  const { lat, lng, radius } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: "Missing lat/lng" });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server missing API key" });
  }

  const searchRadius = radius || 25000; // meters (~15 miles)
  const types = ["park", "tourist_attraction", "restaurant", "bar", "museum", "campground"];

  try {
    const requests = types.map(type => {
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${searchRadius}&type=${type}&key=${apiKey}`;
      return fetch(url).then(r => r.json()).then(data => ({ type, data }));
    });

    const responses = await Promise.all(requests);
    const results = [];

    responses.forEach(({ type, data }) => {
      if (data.results) {
        results.push(...data.results.map(p => ({
          id: p.place_id,
          name: p.name,
          type,
          address: p.vicinity || "",
          rating: p.rating || null,
          userRatingsTotal: p.user_ratings_total || 0,
          lat: p.geometry?.location?.lat || null,
          lng: p.geometry?.location?.lng || null,
          photo: p.photos?.[0]
            ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photoreference=${p.photos[0].photo_reference}&key=${apiKey}`
            : null,
          openNow: p.opening_hours?.open_now ?? null,
          priceLevel: p.price_level ?? null,
        })));
      }
    });

    const seen = new Set();
    const deduped = results.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    res.status(200).json({ places: deduped.slice(0, 20) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
