// lib/serpapi.js
import { fetchJSON } from "./utils.js";

export async function getSerpResults(query, location, apiKey) {
  const serpURL =
    `https://serpapi.com/search.json` +
    `?engine=google&q=${encodeURIComponent(query)}` +
    `&location=${encodeURIComponent(location)}` +
    `&num=20&hl=en&gl=us&api_key=${apiKey}`;
  return await fetchJSON(serpURL);
}
