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
    const openish = markets.filter(m => {
  const s = String(m.status || "").toLowerCase();
  return s === "open" || s === "trading" || s === "active";
});
const open = openish.length ? openish : markets;
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
 * Stable implied YES probability for LIVE view.
 * Uses best bid/ask (or order_book bids/asks) — NEVER last_price.
 * Returns 0..1 or null.
 */
function impliedYesProb(m) {
  // Pull top-of-book from explicit fields or from order_book
  const bidRaw = numOrNull(m.yes_bid)
    ?? pathNum(m, ["order_book", "yes", "best_bid", "price"])
    ?? pathNum(m, ["order_book", "bids", 0, "price"]);

  const askRaw = numOrNull(m.yes_ask)
    ?? pathNum(m, ["order_book", "yes", "best_ask", "price"])
    ?? pathNum(m, ["order_book", "asks", 0, "price"]);

  // Normalize (Kalshi sometimes returns cents)
  const norm = v => (v > 1 && v <= 100 ? v / 100 : v);
  const b = bidRaw != null ? norm(bidRaw) : null;
  const a = askRaw != null ? norm(askRaw) : null;

  const in01 = v => v != null && Number.isFinite(v) && v >= 0 && v <= 1;

  // Best case: both sides — use midpoint
  if (in01(b) && in01(a) && a >= b) return (a + b) / 2;

  // One-sided: use what we have (still better than last trade)
  if (in01(b) && a == null) return b;   // lower bound
  if (in01(a) && b == null) return a;   // upper bound

  // Otherwise: we don't have a reliable live signal
  return null;
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
