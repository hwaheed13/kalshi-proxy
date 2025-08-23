// /api/kalshi.js  (Node runtime)
export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end(); // preflight ok

  const { date } = req.query || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json(res, 400, { error: "Missing or bad ?date=YYYY-MM-DD" });
  }

  const base = "https://api.elections.kalshi.com/trade-api/v2";
  const tickers = makeTickers(date); // tries HIGHNY-… then KXHIGHNY-…

  try {
    let info = null;

    // 1) /events/:ticker?with_nested_markets=true
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

    // 2) /markets?event_ticker=…
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

    if (!info) return empty(res, 204); // no content yet (still CORS headers)
    return json(res, 200, {
      ...info,
      url: "https://kalshi.com/markets/kxhighny",
    });
  } catch (err) {
    console.error(err);
    return json(res, 502, { error: "Upstream error", details: String(err) });
  }
}

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, status, obj) {
  setCORS(res);
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

function empty(res, status = 204) {
  setCORS(res);
  res.status(status).end();
}

function makeTickers(dateISO) {
  const [Y, M, D] = dateISO.split("-");
  const yy = Y.slice(-2);
  const mon = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][Number(M)-1];
  return [
    `HIGHNY-${yy}${mon}${D}`,   // you observed this live
    `KXHIGHNY-${yy}${mon}${D}`, // our older variant
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
