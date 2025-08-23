// /api/kalshi
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { date } = req.query || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Missing or bad ?date=YYYY-MM-DD" });
  }

  try {
    // Try HIGHNY first, then fallback to KXHIGHNY for older days (or vice versa if needed)
    const info = await getEventSettlementInfo(date, "HIGHNY") 
               || await getEventSettlementInfo(date, "KXHIGHNY");

    // cache a bit at the edge
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");

    if (!info) return res.status(204).end(); // no content yet
    return res.status(200).json(info);
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: "Upstream error", details: String(err) });
  }
}

async function getEventSettlementInfo(dateISO, prefix) {
  const base = "https://api.elections.kalshi.com/trade-api/v2";
  const eventTicker = toKalshiEventTicker(dateISO, prefix);

  // Always try the event endpoint first; it often includes settlement at the event level
  const r = await fetch(`${base}/events/${encodeURIComponent(eventTicker)}?with_nested_markets=true`, {
    headers: { Accept: "application/json" },
  });

  if (!r.ok) return null;
  const j = await r.json();
  const ev = j?.event;
  if (!ev) return null;

  // If event has settlement_value, use it directly
  if (ev.status && ev.status.toLowerCase() === "settled" && ev.settlement_value != null) {
    return {
      label: (ev.settlement_value_dollars || `${ev.settlement_value} °F`).toString(),
      exactTemp: Number(ev.settlement_value),
      eventTicker,
      url: "https://kalshi.com/markets/kxhighny",
    };
  }

  // Otherwise, look for a settled/yes market as a fallback
  const winner = pickWinner(ev.markets);
  if (winner) {
    return {
      label: winner.subtitle || winner.title || winner.ticker || "Settled",
      exactTemp: toNumberOrNull(winner.expiration_value ?? winner.settlement_value),
      eventTicker,
      url: "https://kalshi.com/markets/kxhighny",
    };
  }

  return null;
}

function toKalshiEventTicker(dateISO, prefix) {
  const [Y, M, D] = dateISO.split("-");
  const yy = Y.slice(-2);
  const mon = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][Number(M)-1];
  return `${prefix}-${yy}${mon}${D}`;
}

function pickWinner(markets) {
  if (!Array.isArray(markets)) return null;
  return (
    markets.find(m => m.result === "yes") ||
    markets.find(m => m.settlement_value != null) ||
    markets.find(m => (m.status || "").toLowerCase() === "finalized" || (m.status || "").toLowerCase() === "settled")
  ) || null;
}

function toNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
