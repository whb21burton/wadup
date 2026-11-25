// pages/api/tm.js — Ticketmaster proxy (server-side, no CORS issues)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!process.env.TM_KEY) return res.status(503).json({ error: 'Ticketmaster is not configured' });

  const params = new URLSearchParams(req.query);
  params.set('apikey', process.env.TM_KEY);

  try {
    const tmRes = await fetch(
      `https://app.ticketmaster.com/discovery/v2/events.json?${params}`
    );
    const data = await tmRes.json();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
