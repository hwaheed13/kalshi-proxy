// api/kalshi-live.js
export default async function handler(req, res) {
  // --- CORS (match your other route)
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();

  const { date } = req.query || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Missing or bad ?date=YYYY-MM-DD" });
  }

  const base = "https://api.elections.kalshi.com/trade-api/v2";
  const eventTicker = toKalshiEventTicker(date);

  try {
    // Get all markets for the event (open + others)
    const r = await fetch(
      `${base}/markets?event_ticker=${encodeURIComponent(eventTicker)}`,
      { headers: { Accept: "application/json" } }
    );
    if (!r.ok) return res.status(502).json({ error: "Upstream error" });
    const j = await r.json();
    const markets = Array.isArray(j?.markets) ? j.markets : [];

    // We only want *live* (open) markets to infer the leader
    const open = markets.filter(m => String(m.status || "").toLowerCase() === "open");
    if (!open.length) return res.status(204).end(); // nothing live to infer

    // Pick the market with highest implied YES probability
    let best = null;
    for (const m of open) {
      const prob = impliedYesProb(m); // 0..1 or null
      if (prob == null) continue;
      if (!best || prob > best.prob) {
        best = {
          prob,
          label: m.subtitle || m.title || m.ticker || "Range",
          ticker: m.ticker
        };
      }
    }

    if (!best) return res.status(204).end();

    return res.status(200).json({
      eventTicker,
      leadingLabel: best.label,
      leadingProb: Math.round(best.prob * 100) / 100, // 0..1 (e.g. 0.63)
      url: "https://kalshi.com/markets/kxhighny"
    });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: "Upstream error", details: String(err) });
  }
}

function toKalshiEventTicker(dateISO) {
  const [Y, M, D] = dateISO.split("-");
  const yy = Y.slice(-2);
  const mon = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][Number(M)-1];
  return `KXHIGHNY-${yy}${mon}${D}`;
}

/**
 * Try to infer YES probability from common fields.
 * Falls back to mid(bid, ask) if present. Returns 0..1 or null.
 */
function impliedYesProb(m) {
  // Common price-ish fields we’ve seen in Kalshi payloads.
  const candidates = [
    m.last_price,
    m.last_trade_price,
    m.yes_price,
    m.last_trade,     // sometimes present
    m.close_price
  ].map(n => numOrNull(n)).filter(n => n != null);

  let p = candidates.length ? candidates[0] : null;

  // Attempt orderbook mid if available (field names are defensive guesses)
  if (p == null && m.order_book) {
    const bestBid = pathNum(m, ["order_book","yes","best_bid","price"]) ?? pathNum(m, ["order_book","bids",0,"price"]);
    const bestAsk = pathNum(m, ["order_book","yes","best_ask","price"]) ?? pathNum(m, ["order_book","asks",0,"price"]);
    if (bestBid != null && bestAsk != null) {
      p = (bestBid + bestAsk) / 2;
    } else if (bestBid != null) {
      p = bestBid;
    } else if (bestAsk != null) {
      p = bestAsk;
    }
  }

  if (p == null) return null;

  // Kalshi prices are typically in dollars 0..1 for NO/YES contracts.
  // If your feed is in cents, normalize:
  if (p > 1 && p <= 100) p = p / 100;

  if (p < 0 || p > 1) return null;
  return p;
}

function numOrNull(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function pathNum(obj, path) {
  let cur = obj;
  for (const k of path) {
    if (!cur || typeof cur !== "object" || !(k in cur)) return null;
    cur = cur[k];
  }
  return numOrNull(cur);
}
