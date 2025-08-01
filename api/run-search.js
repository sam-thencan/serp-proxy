// api/run-search.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { q, location } = await readBody(req);
  if (!q || !location) {
    return res.status(400).json({ error: "missing q or location" });
  }

  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "SERPAPI_KEY not set" });
  }

  /* 1️⃣ query SerpAPI */
  const serpURL = `https://serpapi.com/search.json` +
    `?engine=google&q=${encodeURIComponent(q)}` +
    `&location=${encodeURIComponent(location)}` +
    `&num=20&hl=en&gl=us&api_key=${apiKey}`;
  const serpJSON = await fetchJSON(serpURL);
  const links = (serpJSON.organic_results || []).slice(0, 20).map(r => r.link);

  /* 2️⃣ scrape SEO for each URL (5-at-a-time) */
  const batches = chunk(links, 5);
  const results = [];
  for (const batch of batches) {
    const scraped = await Promise.allSettled(batch.map(scrapeSEO));
    scraped.forEach(r => r.status === "fulfilled" && results.push(r.value));
  }

  res.json({ query: q, location, results });
}

/* ---------- helpers ---------- */

async function readBody(req) {
  const buffers = [];
  for await (const chunk of req) buffers.push(chunk);
  return JSON.parse(Buffer.concat(buffers).toString() || "{}");
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`SerpAPI HTTP ${r.status}`);
  return r.json();
}

function chunk(arr, n) {
  return arr.reduce((acc, _, i) =>
    (i % n ? acc : [...acc, arr.slice(i, i + n)]), []);
}

async function scrapeSEO(url) {
  const start = Date.now();
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const responseTimeMs = Date.now() - start;
  const html = await r.text();

  const title   =   match1(/<title[^>]*>([^<]*)<\/title>/i, html);
  const desc    =   match1(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i, html);
  const h1      =   match1(/<h1[^>]*>([^<]*)<\/h1>/i, html);
  const textOnly = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const wordCount = (textOnly.match(/\b\w+\b/g) || []).length;

  return { finalUrl: r.url, responseTimeMs, title, metaDescription: desc,
           h1, wordCount };
}

const match1 = (re, str) => (re.exec(str) || [])[1] || null;
