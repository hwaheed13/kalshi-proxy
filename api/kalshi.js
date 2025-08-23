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

  const base = "https://api.elections.kalshi.com/trade-api/v2";
  const tickers = makeTickers(date); // tries both HIGHNY and KXHIGHNY

  try {
    let info = null;

    // 1) events?with_nested_markets=true
    for (const t of tickers) {
      const r0 = await fetch(`${base}/events/${encodeURIComponent(t)}?with_nested_markets=true`, {
        headers: { Accept: "application/json" },
      });
      if (r0.ok) {
        const j0 = await r0.json();
        info = winnerToInfo(pickWinner(j0?.event?.markets));
        if (info) { info.eventTicker = t; break; }
      }
    }

    // 2) markets?event_ticker=
    if (!info) {
      for (const t of tickers) {
        const r1 = await fetch(`${base}/markets?event_ticker=${encodeURIComponent(t)}`, {
          headers: { Accept: "application/json" },
        });
        if (r1.ok) {
          const j1 = await r1.json();
          info = winnerToInfo(pickWinner(j1?.markets));
          if (info) { info.eventTicker = t; break; }
        }
      }
    }

    // 3) series fallback
    if (!info) {
      const r2 = await fetch(`${base}/markets?series_ticker=KXHIGHNY&status=settled`, {
        headers: { Accept: "application/json" },
      });
      if (r2.ok) {
        const j2 = await r2.json();
        for (const t of tickers) {
          const mkts = (j2?.markets || []).filter(m => m.event_ticker === t);
          const w = pickWinner(mkts);
          if (w) { info = winnerToInfo(w); info.eventTicker = t; break; }
        }
      }
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");

    if (!info) return res.status(204).end(); // nothing settled for that date
    return res.status(200).json({
      ...info,
      url: "https://kalshi.com/markets/kxhighny",
    });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: "Upstream error", details: String(err) });
  }
}

function makeTickers(dateISO) {
  const [Y, M, D] = dateISO.split("-");
  const yy = Y.slice(-2);
  const mon = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][Number(M)-1];
  return [
    `HIGHNY-${yy}${mon}${D}`,   // variant you saw in the API
    `KXHIGHNY-${yy}${mon}${D}`, // previous variant we were using
  ];
}

function pickWinner(markets) {
  if (!Array.isArray(markets)) return null;
  return (
    markets.find(m => m.result === "yes") ||
    markets.find(m => m.settlement_value != null) ||
    markets.find(m => (m.status || "").toLowerCase() === "finalized" || (m.status || "").toLowerCase() === "settled")
  ) || null;
}

function winnerToInfo(w) {
  if (!w) return null;
  const label = w.subtitle || w.title || w.ticker || "Settled";
  const exactTemp =
    w.expiration_value != null ? Number(w.expiration_value) :
    w.settlement_value != null ? Number(w.settlement_value) :
    null;
  return { label, exactTemp };
}
