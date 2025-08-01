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

  // 1. Query SerpAPI
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

  // 2. Scrape SEO for each URL (batching)
  const batches = chunk(links, 5);
  const scrapedRaw = [];
  for (const batch of batches) {
    const settled = await Promise.allSettled(batch.map(scrapeSEO));
    settled.forEach(p => {
      if (p.status === "fulfilled") scrapedRaw.push(p.value);
      else scrapedRaw.push({ error: p.reason?.message || "scrape failure" });
    });
  }

  // 3. Clean results
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
      h1: cleanText(r.h1Raw, 200),
      wordCount: r.wordCount,
    };
  });

  res.json({
    query: q,
    location,
    logs: {
      serp_raw: serpJSON,
      scraped_raw: scrapedRaw,
      cleaned,
    },
    results: cleaned,
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

  // Title
  const titleRaw = match1(/<title[^>]*>([\s\S]*?)<\/title>/i, html);

  // Meta description
  const metaDescriptionRaw = match1(
    /<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i,
    html
  );

  // H1 (capture entire content, strip nested tags)
  const h1Block = match1(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html);
  let h1Raw = null;
  if (h1Block) {
    h1Raw = decodeEntities(
      h1Block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    );
  }

  // Word count
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

// Decode common HTML entities
function decodeEntities(str = "") {
  return str.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x"
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return String.fromCharCode(code);
    }
    const map = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    return map[entity.toLowerCase()] || match;
  });
}

function cleanText(text = "", maxLength = null) {
  if (!text) return "";
  let t = text.replace(/[\r\n]+/g, " ").trim(); // just collapse whitespace
  if (maxLength && t.length > maxLength) {
    return t.slice(0, maxLength - 1).trim() + "…";
  }
  return t;
}

export { scrapeSEO };


