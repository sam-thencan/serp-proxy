// lib/blacklist.js
import fs from "fs/promises";
import path from "path";

/** Cache so we don't re-read on every request in the same cold start */
let cachedSet = null;

async function loadBlacklist() {
  if (cachedSet) return cachedSet;
  try {
    const filePath = path.resolve(process.cwd(), "blacklist.txt");
    const raw = await fs.readFile(filePath, "utf-8");
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith("#"));
    cachedSet = new Set(lines);
    return cachedSet;
  } catch (e) {
    // If missing or unreadable, fall back to empty set (log for visibility)
    console.warn("Could not load blacklist.txt:", e.message);
    cachedSet = new Set();
    return cachedSet;
  }
}

/**
 * Returns true if the given hostname is blacklisted.
 * Matches exact or subdomain (e.g., old.reddit.com matches reddit.com)
 */
export async function hostIsBlacklisted(hostname) {
  if (!hostname) return false;
  const blacklist = await loadBlacklist();
  const h = hostname.toLowerCase().replace(/^www\./, "");
  for (const banned of blacklist) {
    if (h === banned) return true;
    if (h.endsWith("." + banned)) return true;
  }
  return false;
}
