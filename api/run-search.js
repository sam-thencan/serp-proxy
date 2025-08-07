// api/run-search.js
import {
  getSerpResults,
  scrapeSEO,
  chunk,
  cleanText,
  domainFromUrl,
  hostIsBlacklisted,
} from "../lib/index.js"; // barrel exporting serpapi, scrape, utils

export default async function handler(req, res) {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] API Request started`);
  
  if (req.method !== "POST") {
    console.log("❌ Invalid method:", req.method);
    return res.status(405).json({ error: "POST only" });
  }

  let body;
  try {
    body = await readBody(req);
    console.log("✅ Request body parsed:", { q: body.q, location: body.location });
  } catch (e) {
    console.error("❌ Failed to parse request body:", e.message);
    return res.status(400).json({ error: "invalid JSON" });
  }

  const { q, location } = body;
  if (!q || !location) {
    console.error("❌ Missing required parameters:", { q: !!q, location: !!location });
    return res.status(400).json({ error: "missing q or location" });
  }

  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    console.error("❌ SERPAPI_KEY not configured");
    return res.status(500).json({ error: "SERPAPI_KEY not set" });
  }
  
  console.log("🔑 SERPAPI_KEY found, proceeding with search...");

  // 1. SERP API
  let serpJSON, serpTime = 0;
  try {
    console.log("🔍 Starting SerpAPI request...");
    const serpStart = Date.now();
    serpJSON = await getSerpResults(q, location, apiKey);
    serpTime = Date.now() - serpStart;
    console.log(`✅ SerpAPI completed in ${serpTime}ms, got ${serpJSON.organic_results?.length || 0} results`);
  } catch (e) {
    console.error("❌ SerpAPI fetch failed:", e.message);
    const elapsed = Date.now() - startTime;
    console.log(`⏱️ Total time before SerpAPI failure: ${elapsed}ms`);
    return res.status(502).json({ error: "SerpAPI fetch failed", detail: e.message });
  }

  // prepare list with brand/permalink metadata and SERP rank
  const rawResults = (serpJSON.organic_results || []).slice(0, 20);
  console.log(`📋 Processing ${rawResults.length} raw results for blacklist filtering...`);
  
  const filterStart = Date.now();
  let filterTime = 0;
  const toScrapeWithMeta = await Promise.all(
    rawResults.map(async (r, idx) => {
      const link = typeof r.link === "string" ? r.link : null;
      const brand = r.source ? r.source : domainFromUrl(link || "");
      const rank = idx + 1;
      let domain = "";
      try {
        domain = new URL(link).hostname.replace(/^www\./i, "");
      } catch {}
      const blacklisted = await hostIsBlacklisted(domain);
      if (blacklisted) {
        console.log(`🚫 Blacklisted: ${domain} (rank ${rank})`);
      }
      return {
        link,
        brand,
        rank,
        blacklisted,
      };
    })
  );
  
  filterTime = Date.now() - filterStart;
  console.log(`✅ Blacklist filtering completed in ${filterTime}ms`);

  // Prepare both filtered and unfiltered lists
  const allToScrape = toScrapeWithMeta
    .filter((o) => o.link)
    .map((o) => ({ link: o.link, brand: o.brand, rank: o.rank, isBlacklisted: o.blacklisted }));
  
  const toScrape = allToScrape.filter((o) => !o.isBlacklisted);

  console.log(`🎯 ${toScrape.length} URLs to scrape after filtering (removed ${rawResults.length - toScrape.length} blacklisted)`);

  // 2. Scrape SEO for each URL (batching)
  const batches = chunk(toScrape, 3); // Reduced batch size for better reliability
  const scrapedRaw = [];
  console.log(`🔄 Starting scraping in ${batches.length} batches of 3...`);
  
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchStart = Date.now();
    console.log(`📦 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} URLs)...`);
    
    const settled = await Promise.allSettled(batch.map((o) => scrapeSEO(o.link)));
    
    settled.forEach((p, i) => {
      const orig = batch[i];
      if (p.status === "fulfilled") {
        const result = p.value;
        console.log(`✅ Scraped: ${orig.brand} (${result.responseTimeMs}ms)`);
        scrapedRaw.push({
          ...result,
          brand: orig.brand || domainFromUrl(result.finalUrl),
          permalink: result.finalUrl,
          rank: orig.rank,
        });
      } else {
        console.error(`❌ Scrape failed: ${orig.brand} - ${p.reason?.message}`);
        scrapedRaw.push({
          finalUrl: orig.link,
          brand: orig.brand || domainFromUrl(orig.link),
          permalink: orig.link,
          rank: orig.rank,
          error: p.reason?.message || "scrape failure",
        });
      }
    });
    
    const batchTime = Date.now() - batchStart;
    console.log(`✅ Batch ${batchIndex + 1} completed in ${batchTime}ms`);
    
    // Check if we're approaching timeout (45s warning for 60s limit)
    const elapsed = Date.now() - startTime;
    if (elapsed > 45000) {
      console.warn(`⚠️ Approaching timeout limit at ${elapsed}ms, stopping early`);
      break;
    }
    
    // Add small delay between batches to prevent overwhelming
    await new Promise(r => setTimeout(r, 100));
  }

  // 3. Cleaned version (preserve brand/permalink/rank)
  const cleaned = scrapedRaw.map((r) => {
    if (r.error) return { ...r }; // propagate errors
    return {
      finalUrl: r.finalUrl,
      permalink: r.permalink,
      brand: r.brand,
      rank: r.rank,
      responseTimeMs: r.responseTimeMs,
      titleRaw: r.titleRaw,
      title: cleanText(r.titleRaw, 120),
      metaDescriptionRaw: r.metaDescriptionRaw,
      metaDescription: cleanText(r.metaDescriptionRaw, 160),
      h1Raw: r.h1Raw,
      h1: cleanText(r.h1Raw, 100),
      wordCount: r.wordCount,
      isBlacklisted: false,
    };
  });

  // Add blacklisted entries (with minimal data)
  const blacklistedEntries = allToScrape
    .filter(o => o.isBlacklisted)
    .map(o => ({
      finalUrl: o.link,
      permalink: o.link,
      brand: o.brand,
      rank: o.rank,
      title: `${o.brand} (Filtered: Listicle/Directory)`,
      metaDescription: "This result was filtered as a listicle, directory, or social media page",
      h1: "",
      wordCount: 0,
      responseTimeMs: 0,
      isBlacklisted: true,
    }));

  const allResults = [...cleaned, ...blacklistedEntries].sort((a, b) => a.rank - b.rank);

  // Final timing and response
  const totalTime = Date.now() - startTime;
  console.log(`🎉 Search completed successfully in ${totalTime}ms`);
  console.log(`📊 Final stats: ${cleaned.length} results processed, ${cleaned.filter(r => !r.error).length} successful scrapes`);

  // Return both logs and cleaned results
  res.json({
    query: q,
    location,
    timing: {
      totalMs: totalTime,
      serpMs: serpTime || 0,
      filterMs: filterTime || 0,
    },
    logs: {
      serp_raw: serpJSON,
      scraped_raw: scrapedRaw,
      cleaned,
    },
    results: allResults,
    stats: {
      total: allResults.length,
      scraped: cleaned.length,
      blacklisted: blacklistedEntries.length,
      successful: cleaned.filter(r => !r.error).length,
    },
  });
}

/* Helpers */
async function readBody(req) {
  const buffers = [];
  for await (const chunk of req) buffers.push(chunk);
  return JSON.parse(Buffer.concat(buffers).toString() || "{}");
}
