// lib/serpapi.js
import { fetchJSON } from "./utils.js";

export async function getSerpResults(query, location, apiKey) {
  const serpURL =
    `https://serpapi.com/search.json` +
    `?engine=google&q=${encodeURIComponent(query)}` +
    `&location=${encodeURIComponent(location)}` +
    `&num=20&hl=en&gl=us&api_key=${apiKey}`;
  
  console.log(`🌐 SerpAPI URL: ${serpURL.replace(apiKey, '***HIDDEN***')}`);
  
  try {
    const result = await fetchJSON(serpURL);
    console.log(`📈 SerpAPI response: ${result.organic_results?.length || 0} organic results`);
    if (result.error) {
      console.error(`❌ SerpAPI returned error:`, result.error);
      throw new Error(`SerpAPI error: ${result.error}`);
    }
    return result;
  } catch (error) {
    console.error(`❌ SerpAPI fetch failed:`, error.message);
    throw error;
  }
}
