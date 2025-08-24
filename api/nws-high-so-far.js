// api/nws-high-so-far.js
export default async function handler(req, res) {
  const origin = req.headers.origin || "https://waheedweather.dewdropventures.com";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // Strong anti-cache for edges
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("CDN-Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  const station = (req.query.station || "KNYC").toUpperCase();
  const tz = "America/New_York";

  // Helper: NYC local date string
  const toNYDate = (d) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(d);
    const get = t => parts.find(p => p.type === t)?.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  };

  // Helper: treat only near top-of-hour obs as “official-ish” hourly
  const isTopOfHourish = (iso) => {
    const d = new Date(iso);
    // convert to NY clock for minute check
    const ny = new Date(d.toLocaleString("en-US", { timeZone: tz }));
    const m = ny.getMinutes();
    // NWS hourly often lands ~:51; accept a small window around the hour
    return (m >= 45 && m <= 59) || (m >= 0 && m <= 6);
  };

  try {
    // Newest→oldest; 200 obs ~ 2–3 days
    const url = `https://api.weather.gov/stations/${encodeURIComponent(station)}/observations?limit=200`;
    const r = await fetch(url, {
      headers: {
        Accept: "application/geo+json, application/json",
        "User-Agent": "waheedweather-dash (contact: you@example.com)"
        // token: process.env.NWS_API_KEY // optional
      }
    });
    if (!r.ok) return res.status(502).json({ error: "NWS upstream error", status: r.status });

    const j = await r.json();
    const feats = Array.isArray(j?.features) ? j.features : [];
    if (!feats.length) return res.status(204).end();

    const todayNY = toNYDate(new Date());

    let bestF = null, bestTs = null, countToday = 0, countTop = 0;

    for (const f of feats) {
      const ts = f?.properties?.timestamp;
      if (!ts) continue;

      // keep only today's NYC obs
      if (toNYDate(new Date(ts)) !== todayNY) continue;
      countToday++;

      // keep only near top-of-hour obs (filters out specials)
      if (!isTopOfHourish(ts)) continue;
      countTop++;

      const c = f?.properties?.temperature?.value; // °C
      if (c == null || !Number.isFinite(c)) continue;

      const F = c * 9/5 + 32;
      if (bestF == null || F > bestF) { bestF = F; bestTs = ts; }
    }

    if (bestF == null) {
      // fallback: if no top-of-hour obs yet today, allow any obs from today
      for (const f of feats) {
        const ts = f?.properties?.timestamp;
        if (!ts) continue;
        if (toNYDate(new Date(ts)) !== todayNY) continue;
        const c = f?.properties?.temperature?.value;
        if (c == null || !Number.isFinite(c)) continue;
        const F = c * 9/5 + 32;
        if (bestF == null || F > bestF) { bestF = F; bestTs = ts; }
      }
    }

    if (bestF == null) return res.status(204).end();

    res.status(200).json({
      station,
      highF: Math.round(bestF * 10) / 10,
      atISO: bestTs,          // ISO of the hourly obs that set the high
      countToday,
      countTop                 // how many top-of-hour obs we considered
    });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "Upstream error", details: String(e) });
  }
}
