// api/run-search.js
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return res.status(400).json({ error: "invalid JSON" });
  }

  const { q, location } = body;
  if (!q || !location) return res.status(400).json({ error: "missing q or location" });

  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return res.status(500).json({ error: "SERPAPI_KEY not set" });

  // 1. SERP API
  const serpURL = `https://serpapi.com/search.json` +
    `?engine=google&q=${encodeURIComponent(q)}` +
    `&location=${encodeURIComponent(location)}` +
    `&num=20&hl=en&gl=us&api_key=${apiKey}`;
  let serpJSON;
  try {
    serpJSON = await fetchJSON(serpURL);
  } catch (e) {
    return res.status(502).json({ error: "SerpAPI fetch failed", detail: e.message });
  }

  const links = (serpJSON.organic_results || [])
    .filter(r => typeof r.link === "string")
    .slice(0, 20)
    .map(r => r.link);

  // 2. Scrape SEO for each URL (batching to avoid too many simultaneous)
  const batches = chunk(links, 5);
  const scrapedRaw = [];
  for (const batch of batches) {
    const settled = await Promise.allSettled(batch.map(scrapeSEO));
    settled.forEach(p => {
      if (p.status === "fulfilled") scrapedRaw.push(p.value);
      else {
        scrapedRaw.push({ error: p.reason?.message || "scrape failure" });
      }
    });
  }

  // 3. Cleaned version
  const cleaned = scrapedRaw.map(r => {
    if (r.error) return { ...r }; // propagate errors
    return {
      finalUrl: r.finalUrl,
      responseTimeMs: r.responseTimeMs,
      titleRaw: r.titleRaw,
      title: cleanText(r.titleRaw, 120),
      metaDescriptionRaw: r.metaDescriptionRaw,
      metaDescription: cleanText(r.metaDescriptionRaw, 160),
      h1Raw: r.h1Raw,
      h1: cleanText(r.h1Raw, 100),
      wordCount: r.wordCount,
    };
  });

  // Return both logs and cleaned results for table
  res.json({
    query: q,
    location,
    logs: {
      serp_raw: serpJSON,
      scraped_raw: scrapedRaw,
      cleaned,
    },
    results: cleaned, // for backwards compatibility / easy rendering
  });
}

/* Helpers */

async function readBody(req) {
  const buffers = [];
  for await (const chunk of req) buffers.push(chunk);
  return JSON.parse(Buffer.concat(buffers).toString() || "{}");
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function scrapeSEO(url) {
  const start = Date.now();
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const responseTimeMs = Date.now() - start;
  const html = await r.text();

  const titleRaw = match1(/<title[^>]*>([^<]*)<\/title>/i, html);
  const metaDescriptionRaw = match1(
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i,
    html
  );
  const h1Raw = match1(/<h1[^>]*>([^<]*)<\/h1>/i, html);

  // word count from visible text
  const textOnly = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const wordCount = (textOnly.match(/\b\w+\b/g) || []).length;

  return {
    finalUrl: r.url,
    responseTimeMs,
    titleRaw,
    metaDescriptionRaw,
    h1Raw,
    wordCount,
  };
}

const match1 = (re, str) => {
  const m = re.exec(str);
  return m && m[1] ? m[1].trim() : null;
};

function cleanText(text = "", maxLength = null) {
  if (!text) return "";
  let t = text.replace(/\|/g, "&#124;"); // neutralize pipes
  t = t.replace(/[\r\n]+/g, " ").trim(); // collapse line breaks
  if (maxLength && t.length > maxLength) {
    return t.slice(0, maxLength - 1).trim() + "…";
  }
  return t;
}
