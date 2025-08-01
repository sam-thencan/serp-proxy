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
  const serpURL =
    `https://serpapi.com/search.json` +
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

  // 3. Cleaned + brand/permalink
  const cleaned = scrapedRaw.map((r, i) => {
    if (r.error) return { ...r };

    const serpResult = (serpJSON.organic_results || [])[i] || {};

    // Brand: prefer source, fallback to domain
    let brand = serpResult.source;
    if (!brand && r.finalUrl) {
      try {
        brand = new URL(r.finalUrl).hostname.replace(/^www\./, "");
      } catch {
        brand = "";
      }
    }

    return {
      brand,
      permalink: r.finalUrl,
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

/* ---------- helpers ---------- */

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
  let r;
  try {
    r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  } catch (e) {
    return { finalUrl: url, error: `fetch failed: ${e.message}` };
  }
  const responseTimeMs = Date.now() - start;
  const html = await r.text();

  // Title (capture everything inside title)
  const titleRaw = match1(/<title[^>]*>([\s\S]*?)<\/title>/i, html);

  // Meta description (two common orderings)
  let metaDescriptionRaw = null;
  const desc1 = /<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i.exec(html);
  const desc2 = /<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["'][^>]*>/i.exec(html);
  if (desc1) metaDescriptionRaw = desc1[1].trim();
  else if (desc2) metaDescriptionRaw = desc2[1].trim();

  // H1: capture entire inner HTML, strip nested tags
  let h1Raw = null;
  const h1Block = match1(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html);
  if (h1Block) {
    h1Raw = decodeEntities(
      h1Block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    );
  }

  // Word count from visible text
  const textOnly = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const wordCount = (textOnly.match(/\b\w+\b/g) || []).length;

  return {
    finalUrl: r?.url || url,
    responseTimeMs,
    titleRaw: titleRaw ? decodeEntities(titleRaw) : null,
    metaDescriptionRaw: metaDescriptionRaw ? decodeEntities(metaDescriptionRaw) : null,
    h1Raw,
    wordCount,
  };
}

const match1 = (re, str) => {
  const m = re.exec(str);
  return m && m[1] ? m[1].trim() : null;
};

// Basic entity decoder for common cases
function decodeEntities(str = "") {
  return str.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const code =
        entity[1].toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return String.fromCharCode(code);
    }
    const table = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    return table[entity.toLowerCase()] || match;
  });
}

function cleanText(text = "", maxLength = null) {
  if (!text) return "";
  let t = text.replace(/[\r\n]+/g, " ").trim(); // collapse whitespace
  if (maxLength && t.length > maxLength) {
    return t.slice(0, maxLength - 1).trim() + "…";
  }
  return t;
}


export { scrapeSEO };


