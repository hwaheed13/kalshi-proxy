// /api/kalshi.js
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*"); // or your domain
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { date } = req.query || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Missing or bad ?date=YYYY-MM-DD" });
  }

  // Try BOTH possible event tickers (some data shows "HIGHNY", we also used "KXHIGHNY")
  const tickers = toKalshiTickers(date);
  const base = "https://api.elections.kalshi.com/trade-api/v2";

  try {
    let info = null, usedTicker = null;

    for (const eventTicker of tickers) {
      // 1) events?with_nested_markets=true
      let r = await fetch(`${base}/events/${encodeURIComponent(eventTicker)}?with_nested_markets=true`,
        { headers: { Accept: "application/json" } });
      if (r.ok) {
        const j = await r.json();
        info = winnerToInfo(pickWinner(j?.event?.markets)) || valueFromEvent(j?.event);
        if (info) { usedTicker = eventTicker; break; }
      }

      // 2) markets?event_ticker=
      r = await fetch(`${base}/markets?event_ticker=${encodeURIComponent(eventTicker)}`,
        { headers: { Accept: "application/json" } });
      if (r.ok) {
        const j = await r.json();
        info = winnerToInfo(pickWinner(j?.markets));
        if (info) { usedTicker = eventTicker; break; }
      }

      // 3) series fallback (settled only)
      r = await fetch(`${base}/markets?series_ticker=KXHIGHNY&status=settled`,
        { headers: { Accept: "application/json" } });
      if (r.ok) {
        const j = await r.json();
        const mkts = (j?.markets || []).filter(m => m.event_ticker === eventTicker);
        info = winnerToInfo(pickWinner(mkts));
        if (info) { usedTicker = eventTicker; break; }
      }
    }

    // edge cache
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");

    if (!info) return res.status(204).end();
    return res.status(200).json({
      ...info,
      eventTicker: usedTicker,
      url: "https://kalshi.com/markets/kxhighny"
    });
  } catch (e) {
    console.error(e);
    // still return CORS headers with errors
    return res.status(502).json({ error: "Upstream error", details: String(e) });
  }
}

function toKalshiTickers(dateISO) {
  const [Y, M, D] = dateISO.split("-");
  const yy = Y.slice(-2);
  const mon = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][Number(M)-1];
  // Try both variants
  return [
    `KXHIGHNY-${yy}${mon}${D}`,
    `HIGHNY-${yy}${mon}${D}`,
  ];
}

function pickWinner(markets){
  if (!Array.isArray(markets)) return null;
  return markets.find(m => m.result === "yes")
      || markets.find(m => m.settlement_value != null)
      || markets.find(m => (m.status||"").toLowerCase()==="finalized" || (m.status||"").toLowerCase()==="settled")
      || null;
}

function winnerToInfo(w){
  if (!w) return null;
  const label = w.subtitle || w.title || w.ticker || "Settled";
  const exactTemp =
    w.expiration_value != null ? Number(w.expiration_value) :
    w.settlement_value != null ? Number(w.settlement_value) : null;
  return { label, exactTemp };
}

// Some /events/ responses carry the event-level settlement_value.
function valueFromEvent(ev){
  if (!ev) return null;
  if (ev.settlement_value != null) {
    return { label: `${ev.settlement_value} °F`, exactTemp: Number(ev.settlement_value) };
  }
  return null;
}
