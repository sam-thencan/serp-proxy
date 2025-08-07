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

  // Limit to top 12 results to ensure we complete within timeout
  const limitedToScrape = toScrape.slice(0, 12);
  console.log(`🎯 ${limitedToScrape.length} URLs to scrape after filtering (removed ${rawResults.length - toScrape.length} blacklisted, limited to top 12)`);

  // 2. Scrape SEO for all URLs in parallel with race conditions
  console.log(`
🔄 Starting parallel scraping:
  Total URLs: ${limitedToScrape.length}
  Memory: ${JSON.stringify(process.memoryUsage(), null, 2)}
  Time elapsed: ${Date.now() - startTime}ms
`);
  const scrapeStart = Date.now();
  const scrapedRaw = [];
  
  // Create a promise for each URL that includes a timeout
  const scrapePromises = limitedToScrape.map(async (site) => {
    const siteStart = Date.now();
    try {
      // Race between the scrape and a 15-second timeout
      const result = await Promise.race([
        scrapeSEO(site.link),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Site took too long")), 15000)
        )
      ]);
      
      console.log(`✅ Scraped: ${site.brand} (${Date.now() - siteStart}ms)`);
      return {
        ...result,
        brand: site.brand || domainFromUrl(result.finalUrl),
        permalink: result.finalUrl,
        rank: site.rank,
      };
    } catch (error) {
      console.error(`❌ Scrape failed: ${site.brand} - ${error.message}`);
      return {
        finalUrl: site.link,
        brand: site.brand || domainFromUrl(site.link),
        permalink: site.link,
        rank: site.rank,
        error: error.message || "scrape failure",
      };
    }
  });

  // Wait for all scrapes to complete or timeout
  console.log(`⏳ Waiting for scrapes to complete (35s timeout)...`);
  const results = await Promise.race([
    Promise.all(scrapePromises),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Global timeout")), 35000)
    )
  ]).catch(error => {
    const elapsed = Date.now() - scrapeStart;
    console.warn(`⚠️ Global timeout reached:
    Error: ${error.message}
    Time elapsed: ${elapsed}ms
    Memory: ${JSON.stringify(process.memoryUsage(), null, 2)}
    `);
    return scrapePromises.map(p => p.catch(e => e)); // Return partial results
  });

  // Add successful results to scrapedRaw
  results.forEach(result => {
    if (result instanceof Error) {
      console.error(`❌ Failed to get result: ${result.message}`);
    } else {
      scrapedRaw.push(result);
    }
  });

  const scrapeTime = Date.now() - scrapeStart;
  console.log(`
✅ Parallel scraping completed:
  Time taken: ${scrapeTime}ms
  Total time: ${Date.now() - startTime}ms
  Success rate: ${scrapedRaw.filter(r => !r.error).length}/${limitedToScrape.length}
  Memory: ${JSON.stringify(process.memoryUsage(), null, 2)}
`);

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
