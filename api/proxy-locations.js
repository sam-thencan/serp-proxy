export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "missing q parameter" });

  const key = process.env.SERPAPI_KEY;
  if (!key) return res.status(500).json({ error: "SERPAPI_KEY not configured" });

  try {
    const apiUrl = `https://serpapi.com/locations.json?q=${encodeURIComponent(q)}&limit=10&api_key=${encodeURIComponent(key)}`;
    const r = await fetch(apiUrl);
    const body = await r.text();
    res.status(r.status).setHeader("Content-Type", "application/json").send(body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
