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

export async function scrapeSEO(url) {
  const start = Date.now();
  console.log(`🔗 Starting scrape: ${url}`);
  let response;
  try {
    // Add 8-second timeout per site
    response = await timeout(fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Upgrade-Insecure-Requests": "1",
      },
          }), 8000); // 8-second timeout
    } catch (e) {
      console.error(`❌ Fetch failed for ${url}: ${e.message}`);
      return { finalUrl: url, error: `fetch failed: ${e.message}` };
    }

  let responseTimeMs = Date.now() - start;
  let html = await timeout(response.text(), 5000); // 5-second timeout for text extraction

  const blockedDetector = (htmlText, status) => {
    if (status === 406) return true;
    if (/<title[^>]*>\s*Not Acceptable!<\/title>/i.test(htmlText)) return true;
    if (htmlText.includes("Mod_Security") || htmlText.includes("Not Acceptable!")) return true;
    return false;
  };

  // Retry once if blocked
  if (blockedDetector(html, response.status)) {
    console.log(`🔄 Blocked detected for ${url}, retrying with different headers...`);
    await new Promise((r) => setTimeout(r, 150));
    try {
      const retryResp = await timeout(fetch(url, {
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
      }), 8000); // 8-second timeout for retry too
      responseTimeMs = Date.now() - start;
      html = await timeout(retryResp.text(), 5000); // 5-second timeout for retry text extraction
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
