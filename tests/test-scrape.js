import { scrapeSEO } from "../lib/scrape.js";

(async () => {
  const urls = [
    "https://plumbingbend.com/",
    "https://seversonplumbers.com/",
  ];

  for (const url of urls) {
    console.log(`Testing ${url}`);
    const result = await scrapeSEO(url);
    console.log(JSON.stringify(result, null, 2));
  }
})();
