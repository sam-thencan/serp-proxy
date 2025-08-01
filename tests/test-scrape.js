import { scrapeSEO } from "../api/run-search.js"; // adjust path if needed

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
