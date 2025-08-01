// api/run-search.js
import {
  getSerpResults,
  scrapeSEO,
  chunk,
  cleanText,
  domainFromUrl,
} from '../lib/index.js';

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
  let serpJSON;
  try {
    serpJSON = await getSerpResults(q, location, apiKey);
  } catch (e) {
    return res.status(502).json({ error: "SerpAPI fetch failed", detail: e.message });
  }

  // prepare list with brand/permalink metadata
  const toScrape = (serpJSON.organic_results || [])
    .filter((r) => typeof r.link === "string")
    .slice(0, 20)
    .map((r) => ({
      link: r.link,
      brand: r.title ? r.title.trim() : domainFromUrl(r.link),
    }));

  // 2. Scrape SEO for each URL (batching)
  const batches = chunk(toScrape, 5);
  const scrapedRaw = [];
  for (const batch of batches) {
    const settled = await Promise.allSettled(batch.map((o) => scrapeSEO(o.link)));
    settled.forEach((p, i) => {
      const orig = batch[i];
      if (p.status === "fulfilled") {
        const result = p.value;
        scrapedRaw.push({
          ...result,
          brand: orig.brand || domainFromUrl(result.finalUrl),
          permalink: result.finalUrl,
        });
      } else {
        scrapedRaw.push({
          finalUrl: orig.link,
          brand: orig.brand || domainFromUrl(orig.link),
          permalink: orig.link,
          error: p.reason?.message || "scrape failure",
        });
      }
    });
  }

  // 3. Cleaned version (preserve brand/permalink)
  const cleaned = scrapedRaw.map((r) => {
    if (r.error) return { ...r }; // propagate errors
    return {
      finalUrl: r.finalUrl,
      permalink: r.permalink,
      brand: r.brand,
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

  // Return both logs and cleaned results
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
