// lib/scrape.js
import { match1, decodeEntities } from "./utils.js";

export async function scrapeSEO(url) {
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
