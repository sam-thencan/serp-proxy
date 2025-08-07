// lib/scrape.js
import { match1, decodeEntities } from "./utils.js";

// Helper to timeout a promise after specified ms
const timeout = (promise, ms) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
  return Promise.race([
    promise,
    timeoutPromise
  ]).finally(() => clearTimeout(timeoutId));
};

const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

export async function scrapeSEO(url, options = {}) {
  const {
    fetchTimeoutMs = 6000,
    textTimeoutMs = 3000,
    retryFetchTimeoutMs = fetchTimeoutMs,
    retryTextTimeoutMs = textTimeoutMs,
  } = options;
  const start = Date.now();
  const memory = process.memoryUsage();
  console.log(`🔍 [${new Date().toISOString()}] Starting scrape:
  URL: ${url}
  Memory: ${formatBytes(memory.heapUsed)} / ${formatBytes(memory.heapTotal)}
  RSS: ${formatBytes(memory.rss)}`);
  
  let response;
  const defaultHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: "https://www.google.com/",
    "Upgrade-Insecure-Requests": "1",
    // Chrome client hints (some WAFs look for these)
    "sec-ch-ua": '"Chromium";v="114", "Not.A/Brand";v="24", "Google Chrome";v="114"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
  };
  try {
    // Timed fetch per site
    const fetchStart = Date.now();
    response = await timeout(fetch(url, { headers: defaultHeaders }), fetchTimeoutMs);
    } catch (e) {
      const fetchTime = Date.now() - fetchStart;
      console.error(`❌ Fetch failed for ${url}:
      Error: ${e.message}
      Time taken: ${fetchTime}ms`);
      return { finalUrl: url, error: `fetch failed: ${e.message}`, fetchTimeMs: fetchTime };
    }

  let responseTimeMs = Date.now() - start;
  
  // Log response details
  const contentLength = response.headers.get('content-length');
  const contentType = response.headers.get('content-type');
  console.log(`📥 Response received:
    Status: ${response.status} ${response.statusText}
    URL: ${response.url}
    Type: ${contentType}
    Size: ${contentLength ? formatBytes(parseInt(contentLength)) : 'unknown'}
    Time: ${responseTimeMs}ms`);

  // Extract text with timeout
  const textStart = Date.now();
  console.log(`📄 Starting text extraction...`);
  let html = await timeout(response.text(), textTimeoutMs);
  const textTime = Date.now() - textStart;
  console.log(`✅ Text extracted in ${textTime}ms (${formatBytes(html.length)} of text)`);

  const blockedDetector = (htmlText, status) => {
    if (status === 406 || status === 403) return true;
    if (/<title[^>]*>\s*Not Acceptable!<\/title>/i.test(htmlText)) return true;
    if (/Access Denied|Access denied|Request unsuccessful|Akamai|Incapsula|Cloudflare|Please enable cookies/i.test(htmlText)) return true;
    if (htmlText.includes("Mod_Security") || htmlText.includes("Not Acceptable!")) return true;
    return false;
  };

  // Retry once if blocked
  if (blockedDetector(html, response.status)) {
    console.log(`🔄 Blocked detected for ${url}, retrying with different headers...`);
    await new Promise((r) => setTimeout(r, 150));
    try {
      // Alternate persona (Safari on macOS) for retry
      const safariHeaders = {
        ...defaultHeaders,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15",
        "sec-ch-ua": '"Not/A)Brand";v="99", "Safari";v="16"',
        "sec-ch-ua-platform": '"macOS"',
      };
      const retryResp = await timeout(fetch(url, { headers: safariHeaders }), retryFetchTimeoutMs);
      responseTimeMs = Date.now() - start;
      html = await timeout(retryResp.text(), retryTextTimeoutMs);
      if (blockedDetector(html, retryResp.status)) {
        console.warn(`🚫 Still blocked after retry for ${url}`);
        return {
          finalUrl: retryResp.url || url,
          responseTimeMs,
          error: "Blocked by site (ModSecurity / Not Acceptable)",
        };
      }
      console.log(`✅ Retry successful for ${url}`);
      response = retryResp;
    } catch (e) {
      console.error(`❌ Retry failed for ${url}: ${e.message}`);
      return { finalUrl: url, responseTimeMs, error: `retry fetch failed: ${e.message}` };
    }
  }

  // Parse metadata with timing
  console.log(`🔎 Extracting metadata...`);
  const parseStart = Date.now();

  // Title
  const titleStart = Date.now();
  const titleRaw = match1(/<title[^>]*>([\s\S]*?)<\/title>/i, html);
  console.log(`  📑 Title extracted in ${Date.now() - titleStart}ms: ${titleRaw ? titleRaw.slice(0, 50) + '...' : 'not found'}`);

  // Meta description
  const metaStart = Date.now();
  let metaDescriptionRaw = null;
  const desc1 = /<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i.exec(html);
  const desc2 = /<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["'][^>]*>/i.exec(html);
  if (desc1) metaDescriptionRaw = desc1[1].trim();
  else if (desc2) metaDescriptionRaw = desc2[1].trim();
  console.log(`  📝 Meta description extracted in ${Date.now() - metaStart}ms: ${metaDescriptionRaw ? metaDescriptionRaw.slice(0, 50) + '...' : 'not found'}`);

  // First H1 only
  const h1Start = Date.now();
  let h1Raw = null;
  const h1Block = match1(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html);
  if (h1Block) {
    h1Raw = decodeEntities(
      h1Block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    );
  }
  console.log(`  📌 H1 extracted in ${Date.now() - h1Start}ms: ${h1Raw ? h1Raw.slice(0, 50) + '...' : 'not found'}`);

  // Word count
  const wordStart = Date.now();
  const textOnly = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const wordCount = (textOnly.match(/\b\w+\b/g) || []).length;
  console.log(`  📊 Word count calculated in ${Date.now() - wordStart}ms: ${wordCount} words`);
  
  const totalParseTime = Date.now() - parseStart;
  console.log(`✅ All metadata extracted in ${totalParseTime}ms`);

  return {
    finalUrl: response.url || url,
    responseTimeMs,
    titleRaw: titleRaw ? decodeEntities(titleRaw) : null,
    metaDescriptionRaw: metaDescriptionRaw ? decodeEntities(metaDescriptionRaw) : null,
    h1Raw,
    wordCount,
  };
}
