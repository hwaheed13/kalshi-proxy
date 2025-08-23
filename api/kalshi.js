// /api/kalshi.js
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    const { path = "", ...rest } = req.query;
    const qs = new URLSearchParams(rest).toString();
    const target =
      "https://api.elections.kalshi.com/trade-api/v2" +
      String(path || "") +
      (qs ? (String(path || "").includes("?") ? "&" : "?") + qs : "");

    const upstream = await fetch(target, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const bodyText = await upstream.text();

    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*"); // re-assert CORS
    res.send(bodyText);
  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(502).json({ error: "Proxy fetch failed", detail: String(err) });
  }
}
