import { getSerpResults, scrapeSEO, domainFromUrl, hostIsBlacklisted, cleanText } from "../lib/index.js";

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const q = String(req.query.q || '').trim();
  const location = String(req.query.location || '').trim();
  if (!q || !location) return res.status(400).json({ error: 'missing q or location' });
  if (!process.env.SERPAPI_KEY) return res.status(500).json({ error: 'SERPAPI_KEY not set' });

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const write = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const startTime = Date.now();
  const apiKey = process.env.SERPAPI_KEY;

  try {
    // 1) SERP
    const serp = await getSerpResults(q, location, apiKey);
    const rawResults = (serp.organic_results || []).slice(0, 20);

    // 2) Mark blacklisted and prepare queue
    const prepared = [];
    for (let i = 0; i < rawResults.length; i++) {
      const r = rawResults[i];
      const link = typeof r.link === 'string' ? r.link : null;
      const brand = r.source ? r.source : domainFromUrl(link || '');
      const rank = i + 1;
      let domain = '';
      try { domain = new URL(link).hostname.replace(/^www\./i, ''); } catch {}
      const blacklisted = await hostIsBlacklisted(domain);
      prepared.push({ link, brand, rank, blacklisted });
    }

    const toScrape = prepared.filter(x => x.link && !x.blacklisted);
    const blacklisted = prepared.filter(x => x.blacklisted).map(x => ({
      rank: x.rank,
      brand: x.brand,
      permalink: x.link,
      isBlacklisted: true,
      title: `${x.brand} (Directory/Listicle)`,
      metaDescription: "Excluded from competitor view. Toggle 'Show Listicles' to include.",
      h1: '',
      wordCount: 0,
      responseTimeMs: 0,
    }));

    // Send blacklisted immediately so UI can render ranks
    for (const b of blacklisted) write('result', b);

    // 3) Scrape with small pool, stream each result
    const poolSize = 4;
    let index = 0;
    let active = 0;
    let success = 0;

    const launch = async () => {
      while (active < poolSize && index < toScrape.length) {
        const site = toScrape[index++];
        active++;
        (async () => {
          const elapsed = Date.now() - startTime;
          if (elapsed > 59000) return; // safety
          try {
            // fast attempt then 10s retry
            let result = await scrapeSEO(site.link, { fetchTimeoutMs: 6000, textTimeoutMs: 3000 });
            if (result?.error) {
              result = await scrapeSEO(site.link, { fetchTimeoutMs: 10000, textTimeoutMs: 5000 });
            }
            if (!result.error) success++;
            write('result', normalize(site, result));
          } catch (e) {
            write('result', { rank: site.rank, brand: site.brand, permalink: site.link, error: e.message });
          } finally {
            active--;
            if (index < toScrape.length && Date.now() - startTime < 59000) launch();
            else if (active === 0) finish();
          }
        })();
      }
    };

    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 10000);

    const finish = () => {
      clearInterval(keepAlive);
      write('done', {
        total: prepared.length,
        scraped: toScrape.length,
        blacklisted: blacklisted.length,
        successful: success,
        totalMs: Date.now() - startTime,
      });
      res.end();
    };

    launch();
  } catch (e) {
    write('error', { error: e.message });
    res.end();
  }
}

function normalize(site, r) {
  if (r.error) return { rank: site.rank, brand: site.brand, permalink: site.link, error: r.error };
  return {
    rank: site.rank,
    brand: site.brand || domainFromUrl(r.finalUrl),
    permalink: r.finalUrl,
    responseTimeMs: r.responseTimeMs,
    title: cleanText(r.titleRaw, 120),
    metaDescription: cleanText(r.metaDescriptionRaw, 160),
    h1: cleanText(r.h1Raw, 100),
    wordCount: r.wordCount,
    isBlacklisted: false,
  };
}


