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
    .filter((r) => typeof r.link === "string")
    .slice(0, 20)
    .map((r) => r.link);

  // 2. Scrape SEO for each URL (batching to avoid too many simultaneous)
  const batches = chunk(links, 5);
  const scrapedRaw = [];
  for (const batch of batches) {
    const settled = await Promise.allSettled(batch.map(scrapeSEO));
    settled.forEach((p) => {
      if (p.status === "fulfilled") scrapedRaw.push(p.value);
      else {
        scrapedRaw.push({ finalUrl: null, error: p.reason?.message || "scrape failure" });
      }
    });
  }

  // 3. Cleaned version
  const cleaned = scrapedRaw.map((r) => {
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
  let response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Upgrade-Insecure-Requests": "1",
      },
    });
  } catch (e) {
    return { finalUrl: url, error: `fetch failed: ${e.message}` };
  }

  let responseTimeMs = Date.now() - start;
  let html = await response.text();

  const blockedDetector = (htmlText, status) => {
    if (status === 406) return true;
    if (/<title[^>]*>\s*Not Acceptable!<\/title>/i.test(htmlText)) return true;
    if (htmlText.includes("Mod_Security") || htmlText.includes("Not Acceptable!")) return true;
    return false;
  };

  // Retry once if blocked
  if (blockedDetector(html, response.status)) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      const retryResp = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          "Upgrade-Insecure-Requests": "1",
          Referer: "https://www.google.com/",
        },
      });
      responseTimeMs = Date.now() - start;
      html = await retryResp.text();
      if (blockedDetector(html, retryResp.status)) {
        return {
          finalUrl: retryResp.url || url,
          responseTimeMs,
          error: "Blocked by site (ModSecurity / Not Acceptable)",
        };
      }
      response = retryResp;
    } catch (e) {
      return { finalUrl: url, responseTimeMs, error: `retry fetch failed: ${e.message}` };
    }
  }

  // Title
  const titleRaw = match1(/<title[^>]*>([\s\S]*?)<\/title>/i, html);

  // Meta description
  let metaDescriptionRaw = null;
  const desc1 = /<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i.exec(html);
  const desc2 = /<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["'][^>]*>/i.exec(html);
  if (desc1) metaDescriptionRaw = desc1[1].trim();
  else if (desc2) metaDescriptionRaw = desc2[1].trim();

  // First H1 only
  let h1Raw = null;
  const h1Block = match1(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html);
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
    finalUrl: response.url || url,
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

function decodeEntities(str) {
  return str.replace(/&#(\d+);/g, (m, dec) => String.fromCharCode(dec))
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
}

function cleanText(text = "", maxLength = null) {
  if (!text) return "";
  let t = text.replace(/[\r\n]+/g, " ").trim();
  if (maxLength && t.length > maxLength) {
    return t.slice(0, maxLength - 1).trim() + "…";
  }
  return t;
}

export { scrapeSEO };


