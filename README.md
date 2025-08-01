# Local SEO Competitor Agent

**Local SEO Competitor Agent** is a lightweight, privacy-conscious tool for scraping localized Google SERP results (via SerpApi), filtering out low-value listicles/directories/socials, extracting on-page SEO data (title, meta description, first H1, word count, response time), and presenting competitors in a dark-mode dashboard. It preserves original SERP ranking, supports save/load of searches in the browser, and hides the API key via a serverless proxy.

## Features

* Query by **keyword + location** using SerpApi (localized Google search)
* **Blacklist filtering** to exclude directories, listicles, social pages (via `blacklist.txt`)
* Extract per-result SEO metadata:

  * Final URL / Permalink
  * Brand (from SerpApi `source`)
  * SERP rank
  * Title and meta description (cleaned/truncated)
  * First H1 (normalized)
  * Word count
  * Response time
* Dark-only modern UI (no `prefers-color-scheme` fallback)
* Save & load previous search state in `localStorage`
* Refresh button, safe rendering (HTML escaping), and logs (toggleable)
* Modular backend: SerpApi wrapper, scraping logic, utilities, and blacklist lookup

## Quick Start (Local Development)

### Prerequisites

* Node.js >= 18
* SerpApi API key
* (Optional) Vercel CLI for local emulation/deployment

### Setup

```sh
git clone https://github.com/sam-thencan/serp-proxy.git
cd serp-proxy
```

Ensure your `package.json` includes the module type, e.g.:

```json
{
  "type": "module",
  ...
}
```

Create environment file:

```env
# .env.local
SERPAPI_KEY=your_serpapi_key_here
```

### Run Locally

Using Vercel emulation:

```sh
vercel dev
```

Then open the app in the browser (usually `http://localhost:3000`), enter a keyword and location, and click **Run Search**.

## Deployment

Deploy to Vercel (or any serverless host that supports ES modules and environment vars):

```sh
vercel # or vercel --prod
```

Set the required environment variable in Vercel dashboard or via CLI:

```sh
vercel env add SERPAPI_KEY production
```

## API Endpoints

### `POST /api/run-search`

Body:

```json
{
  "q": "plumber",
  "location": "Bend, Oregon, United States"
}
```

Returns:

* `results`: cleaned array with fields including `rank`, `brand`, `permalink`, `title`, `metaDescription`, `h1`, `wordCount`, `responseTimeMs`, etc.
* `logs`: raw payloads (`serp_raw`, `scraped_raw`, `cleaned`) for debugging.

### `GET /api/proxy-locations?q=...`

Returns location suggestions (with commas spaced) from SerpApi via the proxy, keeping the API key server-side.

## Blacklist Filtering

The file `lib/blacklist.txt` (or wherever the helper expects it) contains hosts to exclude from scraping (e.g., listicles, review directories, social platforms). One host per line:

Example entries:

```
yelp.com
facebook.com
reddit.com
angie.com
...
```

The backend utility `hostIsBlacklisted` compares each result’s hostname (normalized, strip `www.`) against the blacklist and filters out matches before further scraping.

## Save / Load Search Behavior

* Uses `localStorage` (key like `serpSearchCache_v1`) to persist the last full search (query + location + results).
* On load: if cached search exists, UI shows **Load Search**.
* After a new search: button switches to **Save Search**; clicking stores it (does not auto-save).
* Loading restores keyword, location, and results table.

## Project Structure

```
.
├── public/
│   ├── index.html        # Frontend entrypoint (renamed title to Local SEO Competitor Agent)
│   ├── styles.css       # Always-dark UI stylesheet
│   └── app.js           # Frontend logic (search, render, save/load)
├── api/
│   ├── run-search.js    # Main handler: SerpApi call, blacklist filter, scraping, cleaning
│   └── proxy-locations.js # Location autocomplete proxy
├── lib/
│   ├── scrape.js        # SEO scraping logic (title, H1, etc. + block detection)
│   ├── serpapi.js       # SerpApi wrapper (fetching SERP JSON)
│   ├── utils.js         # Helpers: cleanText, chunk, domainFromUrl, fetchJSON, blacklist loader
│   ├── blacklist.txt    # Hosts to filter out
│   └── index.js         # Barrel exports (e.g., getSerpResults, scrapeSEO, utilities)
├── .env.local           # Environment vars (not committed)
├── package.json         # Module config (should include "type": "module")
└── README.md            # This file
```

## Local Testing Tips

* Bypass the UI and test the API directly:

```sh
curl -X POST http://localhost:3000/api/run-search \
  -H "Content-Type: application/json" \
  -d '{"q":"plumber","location":"Bend, Oregon, United States"}'
```

* To avoid consuming SerpApi quota during iterative dev:

  * Capture a successful `serpJSON` + cleaned result to a local JSON fixture.
  * Temporarily stub or branch in `api/run-search.js` to use the fixture when a query param like `?mock=1` is present.

## Example Usage

1. Open the app.
2. Enter `"plumber"` as Keyword.
3. Type `"Bend, Oregon, United States"` in Location and select the suggestion.
4. Click **Run Search**.
5. Review competitor data (rank, brand, title, meta, H1, speed).
6. Click **Save Search** to persist; later use **Load Search** to restore.

## Security & Reliability Notes

* **API Key Protection**: All SerpApi requests go through serverless functions; the key is never exposed client-side.
* **Blacklist Filtering**: Keeps noise out of results by removing known low-value domains.
* **Blocked Detection**: Scraper detects ModSecurity / "Not Acceptable" responses and surfaces those as blocked in logs.
* **Output Sanitization**: Titles, metas, and H1s are HTML-escaped before rendering to prevent injection.

## Future Improvements

* Persistent backend cache (e.g., Redis, Vercel KV) for repeated queries.
* Export (CSV/JSON) of results.
* UI configuration of blacklist/whitelist.
* Authentication for sharing saved searches.
* More granular retry/backoff for fetch failures.
* Multi-page SERP support with rate-limited pagination.

## Commit Suggestion

```sh
git add public/index.html README.md
git commit -m "chore: rename to Local SEO Competitor Agent and add comprehensive README"
```