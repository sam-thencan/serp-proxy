// api/retry-scrape.js
import { scrapeSEO, cleanText, domainFromUrl } from "../lib/index.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return res.status(400).json({ error: "invalid JSON" });
  }

  const url = body?.url;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "missing url" });
  }

  try {
    const result = await scrapeSEO(url, {
      fetchTimeoutMs: 30000, // allow up to 30s for slower sites
      textTimeoutMs: 8000,
      retryFetchTimeoutMs: 30000,
      retryTextTimeoutMs: 8000,
    });

    if (result.error) {
      return res.status(200).json({ result });
    }

    const cleaned = {
      finalUrl: result.finalUrl,
      permalink: result.finalUrl,
      brand: domainFromUrl(result.finalUrl),
      rank: null,
      responseTimeMs: result.responseTimeMs,
      titleRaw: result.titleRaw,
      title: cleanText(result.titleRaw, 120),
      metaDescriptionRaw: result.metaDescriptionRaw,
      metaDescription: cleanText(result.metaDescriptionRaw, 160),
      h1Raw: result.h1Raw,
      h1: cleanText(result.h1Raw, 100),
      wordCount: result.wordCount,
    };

    res.status(200).json({ result: cleaned });
  } catch (e) {
    res.status(200).json({ result: { finalUrl: url, error: e.message } });
  }
}

async function readBody(req) {
  const buffers = [];
  for await (const chunk of req) buffers.push(chunk);
  return JSON.parse(Buffer.concat(buffers).toString() || "{}");
}


