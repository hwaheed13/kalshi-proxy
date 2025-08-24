// api/nws-current-temp.js
export default async function handler(req, res) {
  // CORS (match your other proxy routes)
  const origin = req.headers.origin || "https://waheedweather.dewdropventures.com";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Strong anti-cache (avoid stale at the edge)
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("CDN-Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();

  const station = (req.query.station || "KNYC").toUpperCase(); // Central Park by default

  try {
    const url = `https://api.weather.gov/stations/${encodeURIComponent(station)}/observations/latest`;
    const resp = await fetch(url, {
      headers: {
        Accept: "application/geo+json, application/json",
        "User-Agent": "waheedweather-dash (contact: you@example.com)",
        // Optional: if you want to send your personal token from env:
        // token: process.env.NWS_API_KEY
      }
    });

    if (!resp.ok) {
      return res.status(502).json({ error: "NWS upstream error", status: resp.status });
    }

    const j = await resp.json();
    const p = j?.properties;
    const cVal = p?.temperature?.value; // °C (can be null)

    if (cVal == null || !Number.isFinite(cVal)) {
      return res.status(204).end(); // no current temperature available
    }

    const fVal = cVal * 9/5 + 32;

    return res.status(200).json({
      station,
      currentF: Number(fVal.toFixed(1)), // e.g., 78.3
      atISO: p?.timestamp || null        // ISO time of this obs
    });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "Upstream error", details: String(e) });
  }
}
