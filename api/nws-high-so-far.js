// api/nws-high-so-far.js
export default async function handler(req, res) {
  // CORS — same style as your other kalshi-proxy routes
  const origin = req.headers.origin || "https://waheedweather.dewdropventures.com";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  const station = (req.query.station || "KNYC").toUpperCase(); // Central Park
  try {
    // Build NYC-local start/end for "today" and convert to UTC ISO
    const tz = "America/New_York";
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(now);
    const get = t => parts.find(p => p.type === t)?.value;
    const yyyy = +get("year"), mm = +get("month"), dd = +get("day");
    const toUtcIso = (y,m,d,H,M,S) => new Date(Date.UTC(y, m-1, d, H, M, S)).toISOString();
    const startISO = toUtcIso(yyyy, mm, dd, 0, 0, 0);
    const endISO   = toUtcIso(yyyy, mm, dd, 23, 59, 59);

    const url = `https://api.weather.gov/stations/${encodeURIComponent(station)}/observations` +
                `?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}&limit=500`;

    const r = await fetch(url, {
      headers: {
        Accept: "application/geo+json, application/json",
        "User-Agent": "waheedweather-dash (contact: you@example.com)"
        // If you want to send your token server-side later, add:
        // , token: process.env.NWS_API_KEY
      }
    });
    if (!r.ok) return res.status(502).json({ error: "NWS upstream error" });

    const j = await r.json();
    const feats = Array.isArray(j?.features) ? j.features : [];
    let bestF = null, bestTs = null;
    for (const f of feats) {
      const c = f?.properties?.temperature?.value; // °C
      const ts = f?.properties?.timestamp;
      if (c == null || !Number.isFinite(c)) continue;
      const F = c * 9/5 + 32;
      if (bestF == null || F > bestF) { bestF = F; bestTs = ts; }
    }
    if (bestF == null) return res.status(204).end();

    res.status(200).json({
      station,
      highF: Math.round(bestF * 10) / 10,
      atISO: bestTs,
      count: feats.length
    });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "Upstream error", details: String(e) });
  }
}
